/**
 * Operator review endpoints for Tier 2 ambiguous NRS matches.
 *
 * The NRS importer persists ambiguous matches into `nrs_ambiguous_review`
 * (status='pending') when its scorer can't pick a single MLCC code. An
 * operator visits these via the admin UI, picks the right candidate (or
 * skips), and the resolve action writes a permanent `upc_mappings` row
 * with confidence_source='operator_review'.
 *
 * Auth: `X-Admin-Token` header matches `LK_ADMIN_TOKEN` env. When the env
 * is unset (dev), the routes are open — same convention as nrs-import.routes.js.
 *
 * Routes:
 *   GET  /admin/nrs-review/pending?limit&offset
 *   POST /admin/nrs-review/:reviewId/resolve   { mlccCode, confirmedBy? }
 *   POST /admin/nrs-review/:reviewId/skip      { reason? }
 */
import express from "express";
import supabase from "../config/supabase.js";
import { upsertUpcMapping } from "../lib/upc-mappings.js";

const router = express.Router();

function assertAdminToken(req, res) {
  const expected = process.env.LK_ADMIN_TOKEN?.trim();
  if (!expected) return true;
  const got = String(req.headers["x-admin-token"] ?? "").trim();
  if (got !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

router.get("/nrs-review/pending", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
  const { data, error, count } = await supabase
    .from("nrs_ambiguous_review")
    .select("id, upc, nrs_name, size_ml, top_candidates, created_at", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ ok: false, error: error.message });

  // Enrich top_candidates with full MLCC metadata so operators can see
  // size, price, category, distributor at a glance — without it you can't
  // tell variants apart and have to guess between "OLE SMOKY COOKIES &
  // CREAM" code 32902 and 32903. Single batched lookup keeps it cheap.
  const items = Array.isArray(data) ? data : [];
  const codes = new Set();
  for (const row of items) {
    const cands = Array.isArray(row.top_candidates) ? row.top_candidates : [];
    for (const c of cands) {
      if (c && typeof c.code === "string") codes.add(c.code);
    }
  }
  const codeList = [...codes];
  /** @type {Map<string, Record<string, unknown>>} */
  const metaByCode = new Map();
  if (codeList.length > 0) {
    const { data: meta, error: metaErr } = await supabase
      .from("mlcc_items")
      .select(
        "code, name, size_ml, bottle_size_label, ada_name, category, licensee_price, base_price",
      )
      .in("code", codeList);
    if (!metaErr && Array.isArray(meta)) {
      for (const m of meta) {
        if (m?.code) metaByCode.set(String(m.code), m);
      }
    }
    // If metaErr we silently fall back to bare candidates — UI still works.
  }

  const enrichedItems = items.map((row) => {
    const cands = Array.isArray(row.top_candidates) ? row.top_candidates : [];
    const top_candidates = cands.map((c) => {
      const m = c?.code ? metaByCode.get(String(c.code)) : null;
      return {
        code: c.code,
        name: c.name,
        score: c.score,
        size_ml: m?.size_ml ?? null,
        bottle_size_label: m?.bottle_size_label ?? null,
        ada_name: m?.ada_name ?? null,
        category: m?.category ?? null,
        licensee_price: m?.licensee_price ?? null,
        base_price: m?.base_price ?? null,
      };
    });
    return { ...row, top_candidates };
  });

  return res.json({ ok: true, items: enrichedItems, total: count ?? 0, limit, offset });
});

router.post("/nrs-review/:reviewId/resolve", express.json(), async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  const { reviewId } = req.params;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const mlccCode = typeof body.mlccCode === "string" ? body.mlccCode.trim() : "";
  const confirmedBy =
    typeof body.confirmedBy === "string" && body.confirmedBy.trim()
      ? body.confirmedBy.trim()
      : "operator_review";
  if (!mlccCode) {
    return res.status(400).json({ ok: false, error: "mlccCode required" });
  }

  // Verify the picked MLCC code is real before we write a permanent mapping.
  const { data: mlccItem, error: mlccErr } = await supabase
    .from("mlcc_items")
    .select("code, name")
    .eq("code", mlccCode)
    // code is not unique alone (code+ada_number is) — pin to lowest ADA so a
    // multi-distributor SKU can't 500 .maybeSingle().
    .order("ada_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (mlccErr) return res.status(500).json({ ok: false, error: mlccErr.message });
  if (!mlccItem) {
    return res.status(400).json({ ok: false, error: "mlcc_code_not_found" });
  }

  // Fetch the review row to get its UPC + guard against double-resolve.
  const { data: review, error: rErr } = await supabase
    .from("nrs_ambiguous_review")
    .select("id, upc, status")
    .eq("id", reviewId)
    .maybeSingle();
  if (rErr) return res.status(500).json({ ok: false, error: rErr.message });
  if (!review) return res.status(404).json({ ok: false, error: "review_not_found" });
  if (review.status !== "pending") {
    return res.status(409).json({
      ok: false,
      error: "review_not_pending",
      status: review.status,
    });
  }

  // Write the authoritative mapping. Reuses the same helper that the scanner
  // search-pick flow + UpcCandidatePicker confirm flow use, so we share the
  // scan_count / flag_count semantics and the confidence_source convention.
  const written = await upsertUpcMapping(supabase, {
    upc: review.upc,
    mlccCode,
    confidenceSource: "operator_review",
    confirmedBy,
  });
  if (!written) {
    return res.status(500).json({ ok: false, error: "mapping_write_failed" });
  }

  // Mark the review row resolved.
  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("nrs_ambiguous_review")
    .update({
      status: "resolved",
      resolved_to_mlcc_code: mlccCode,
      resolved_by: confirmedBy,
      resolved_at: now,
      updated_at: now,
    })
    .eq("id", reviewId);
  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  return res.json({ ok: true, upc: review.upc, mlccCode, mlccName: mlccItem.name });
});

router.post("/nrs-review/:reviewId/skip", express.json(), async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  const { reviewId } = req.params;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const now = new Date().toISOString();

  const { data: review, error: rErr } = await supabase
    .from("nrs_ambiguous_review")
    .select("id, status")
    .eq("id", reviewId)
    .maybeSingle();
  if (rErr) return res.status(500).json({ ok: false, error: rErr.message });
  if (!review) return res.status(404).json({ ok: false, error: "review_not_found" });
  if (review.status !== "pending") {
    return res.status(409).json({
      ok: false,
      error: "review_not_pending",
      status: review.status,
    });
  }

  const { error: updErr } = await supabase
    .from("nrs_ambiguous_review")
    .update({
      status: "skipped",
      skipped_reason: reason || null,
      skipped_at: now,
      updated_at: now,
    })
    .eq("id", reviewId);
  if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

  return res.json({ ok: true });
});

export default router;
