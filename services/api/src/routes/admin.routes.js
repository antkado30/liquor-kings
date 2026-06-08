/**
 * Admin JSON APIs (service-role server only).
 *
 * Env (documented for operators):
 * - LK_ADMIN_TOKEN — when set, GET /admin/* requires header `X-Admin-Token` to match exactly; when unset, routes are open (dev).
 */
import express from "express";
import supabase from "../config/supabase.js";

const router = express.Router();

if (!process.env.LK_ADMIN_TOKEN?.trim()) {
  console.warn("[admin] LK_ADMIN_TOKEN is not set; /admin/upc-audit and /admin/telemetry allow unauthenticated access (dev mode)");
}

/** @param {import("express").Request} req */
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

router.get("/upc-mappings", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const sources = ["user_confirmed", "auto_high_score", "bulk_seed", "manual_admin"];
    const [totalRes, ...countRes] = await Promise.all([
      supabase.from("upc_mappings").select("*", { count: "exact", head: true }),
      ...sources.map((s) =>
        supabase.from("upc_mappings").select("*", { count: "exact", head: true }).eq("confidence_source", s),
      ),
    ]);
    if (totalRes.error) {
      return res.status(500).json({ ok: false, error: totalRes.error.message });
    }
    for (const c of countRes) {
      if (c.error) {
        return res.status(500).json({ ok: false, error: c.error.message });
      }
    }
    const by_source = {
      user_confirmed: countRes[0].count ?? 0,
      auto_high_score: countRes[1].count ?? 0,
      bulk_seed: countRes[2].count ?? 0,
      manual_admin: countRes[3].count ?? 0,
    };

    const { data: recentRows, error: recErr } = await supabase
      .from("upc_mappings")
      .select("upc, mlcc_code, confidence_source, confirmed_at, scan_count, flag_count")
      .order("confirmed_at", { ascending: false })
      .limit(50);
    if (recErr) {
      return res.status(500).json({ ok: false, error: recErr.message });
    }
    const codes = [...new Set((recentRows ?? []).map((r) => String(r?.mlcc_code ?? "").trim()).filter(Boolean))];
    /** @type {Map<string, string>} */
    const nameByCode = new Map();
    if (codes.length) {
      const { data: items, error: itemErr } = await supabase
        .from("mlcc_items")
        .select("code, name")
        .in("code", codes);
      if (itemErr) {
        return res.status(500).json({ ok: false, error: itemErr.message });
      }
      for (const it of items ?? []) {
        const c = String(it?.code ?? "").trim();
        if (c) nameByCode.set(c, String(it?.name ?? ""));
      }
    }
    const recent = (recentRows ?? []).map((r) => ({
      upc: r.upc,
      mlcc_code: r.mlcc_code,
      mlcc_name: nameByCode.get(String(r.mlcc_code ?? "")) ?? null,
      confidence_source: r.confidence_source,
      confirmed_at: r.confirmed_at,
      scan_count: r.scan_count,
      flag_count: r.flag_count,
    }));

    return res.json({
      ok: true,
      total_mappings: totalRes.count ?? 0,
      by_source,
      recent,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/upc-audit", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    let limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    let offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const flaggedOnly = String(req.query.flagged_only ?? "false").toLowerCase() === "true";
    const minConf = req.query.min_confidence != null ? Number.parseInt(String(req.query.min_confidence), 10) : null;
    const maxConf = req.query.max_confidence != null ? Number.parseInt(String(req.query.max_confidence), 10) : null;
    const matchMode =
      typeof req.query.match_mode === "string" && req.query.match_mode.trim()
        ? req.query.match_mode.trim()
        : null;
    const upcFilter = typeof req.query.upc === "string" && req.query.upc.trim() ? req.query.upc.trim() : null;
    const startDate = typeof req.query.start_date === "string" ? req.query.start_date.trim() : "";
    const endDate = typeof req.query.end_date === "string" ? req.query.end_date.trim() : "";

    let q = supabase.from("upc_match_audit").select("*", { count: "exact" });
    if (flaggedOnly) q = q.eq("flagged_incorrect", true);
    if (upcFilter) q = q.eq("upc", upcFilter);
    if (matchMode) q = q.eq("match_mode", matchMode);
    if (Number.isFinite(minConf)) q = q.gte("confidence_score", minConf);
    if (Number.isFinite(maxConf)) q = q.lte("confidence_score", maxConf);
    if (startDate) q = q.gte("created_at", `${startDate}T00:00:00.000Z`);
    if (endDate) q = q.lte("created_at", `${endDate}T23:59:59.999Z`);

    const { data: rows, error, count } = await q
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({
      ok: true,
      total: count ?? 0,
      rows: rows ?? [],
      limit,
      offset,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/upc-audit/suspicious", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const [{ data: rows, error }, { data: flaggedRows, error: flaggedError }] = await Promise.all([
      supabase
        .from("upc_match_audit")
        .select("*")
        .eq("match_mode", "confident")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("upc_match_audit")
        .select("upc,created_at,flagged_incorrect")
        .eq("flagged_incorrect", true)
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
    if (flaggedError) {
      return res.status(500).json({ ok: false, error: flaggedError.message });
    }
    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    /** @type {Map<string, string[]>} */
    const flaggedByUpc = new Map();
    for (const flagged of flaggedRows ?? []) {
      const key = String(flagged?.upc ?? "").trim();
      const at = String(flagged?.created_at ?? "").trim();
      if (!key || !at) continue;
      const arr = flaggedByUpc.get(key) ?? [];
      arr.push(at);
      flaggedByUpc.set(key, arr);
    }

    const latestByUpc = new Map();
    for (const row of rows ?? []) {
      const upc = String(row?.upc ?? "").trim();
      if (upc && !latestByUpc.has(upc)) latestByUpc.set(upc, row);
    }

    const suspicious = [];
    for (const row of latestByUpc.values()) {
      const breakdown =
        row?.scoring_breakdown && typeof row.scoring_breakdown === "object" ? row.scoring_breakdown : {};
      const nameSim = Number(breakdown?.nameSimilarityScore ?? 0);
      const confidence = Number(row?.confidence_score ?? 0);
      const reasonsSummary = JSON.stringify(row?.all_candidate_scores ?? []);
      const hasMarkerConflict = /marker conflict/i.test(reasonsSummary);
      const flaggedTimes = flaggedByUpc.get(String(row?.upc ?? "").trim()) ?? [];
      const flaggedLater = Boolean(
        row?.cached &&
          flaggedTimes.some((flaggedAt) => new Date(flaggedAt).getTime() > new Date(String(row?.created_at ?? "")).getTime()),
      );

      const isSuspicious = nameSim < 4 || confidence < 80 || hasMarkerConflict || flaggedLater;
      if (!isSuspicious) continue;

      const { data: cachedRow } = await supabase
        .from("mlcc_items")
        .select("id,name")
        .eq("upc", row.upc)
        .eq("code", row.matched_mlcc_code)
        .maybeSingle();

      suspicious.push({
        audit_id: row.id,
        upc: row.upc,
        upc_product_name: row.upc_product_name,
        matched_mlcc_code: row.matched_mlcc_code,
        matched_mlcc_name: cachedRow?.name ?? null,
        confidence_score: row.confidence_score,
        reasons_summary: reasonsSummary,
        created_at: row.created_at,
        currently_cached: Boolean(cachedRow?.id),
      });
    }

    return res.json({
      ok: true,
      total: suspicious.length,
      suspicious_mappings: suspicious,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/telemetry", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const now = new Date();
    const generated_at = now.toISOString();
    const startUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const sevenAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    const [
      todayRes,
      weekRes,
      confRes,
      ambRes,
      noRes,
      avgConfRes,
      lowConfRes,
      flaggedRes,
      flagged7Res,
      topScannedRes,
      noMatchRowsRes,
    ] = await Promise.all([
      supabase
        .from("upc_match_audit")
        .select("*", { count: "exact", head: true })
        .gte("created_at", startUtcDay),
      supabase.from("upc_match_audit").select("*", { count: "exact", head: true }).gte("created_at", sevenAgo),
      supabase.from("upc_match_audit").select("*", { count: "exact", head: true }).eq("match_mode", "confident"),
      supabase.from("upc_match_audit").select("*", { count: "exact", head: true }).eq("match_mode", "ambiguous"),
      supabase.from("upc_match_audit").select("*", { count: "exact", head: true }).eq("match_mode", "no_match"),
      supabase.from("upc_match_audit").select("confidence_score").eq("match_mode", "confident").limit(5000),
      supabase
        .from("upc_match_audit")
        .select("*", { count: "exact", head: true })
        .eq("match_mode", "no_match")
        .eq("confidence_warning", "low_confidence_match"),
      supabase.from("upc_match_audit").select("*", { count: "exact", head: true }).eq("flagged_incorrect", true),
      supabase
        .from("upc_match_audit")
        .select("*", { count: "exact", head: true })
        .eq("flagged_incorrect", true)
        .gte("flagged_at", sevenAgo),
      supabase
        .from("mlcc_items")
        .select("code, name, scan_count, last_scanned_at")
        .order("scan_count", { ascending: false, nullsFirst: false })
        .limit(10),
      supabase
        .from("upc_match_audit")
        .select("upc, upc_product_name, created_at")
        .eq("match_mode", "no_match")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const errs = [
      todayRes.error,
      weekRes.error,
      confRes.error,
      ambRes.error,
      noRes.error,
      avgConfRes.error,
      lowConfRes.error,
      flaggedRes.error,
      flagged7Res.error,
      topScannedRes.error,
      noMatchRowsRes.error,
    ].filter(Boolean);
    if (errs.length) {
      return res.status(500).json({ ok: false, error: String(errs[0]?.message ?? errs[0]) });
    }

    const scores = (avgConfRes.data ?? [])
      .map((r) => r.confidence_score)
      .filter((n) => n != null && Number.isFinite(Number(n)));
    const avg_confident_score =
      scores.length > 0 ? Math.round((scores.reduce((a, b) => a + Number(b), 0) / scores.length) * 100) / 100 : null;

    /** @type {Map<string, { upc: string; count: number; most_recent_upc_product_name: string | null }>} */
    const failMap = new Map();
    for (const r of noMatchRowsRes.data ?? []) {
      const u = String(r.upc ?? "");
      if (!u) continue;
      const cur = failMap.get(u);
      if (!cur) {
        failMap.set(u, {
          upc: u,
          count: 1,
          most_recent_upc_product_name: r.upc_product_name != null ? String(r.upc_product_name) : null,
        });
      } else {
        cur.count += 1;
      }
    }
    const failed_upcs = [...failMap.values()]
      .sort((a, b) => b.count - a.count || a.upc.localeCompare(b.upc))
      .slice(0, 10);

    return res.json({
      ok: true,
      generated_at,
      scans: {
        today: todayRes.count ?? 0,
        last_7_days: weekRes.count ?? 0,
        by_match_mode: {
          confident: confRes.count ?? 0,
          ambiguous: ambRes.count ?? 0,
          no_match: noRes.count ?? 0,
        },
      },
      confidence: {
        avg_confident_score,
        below_threshold_count: lowConfRes.count ?? 0,
      },
      flagged: {
        total: flaggedRes.count ?? 0,
        last_7_days: flagged7Res.count ?? 0,
      },
      top_scanned: topScannedRes.data ?? [],
      failed_upcs,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/* ============================================================
 * Catalog image curation (task #69, 2026-06-04).
 *
 * Tony's self-serve admin tool for setting mlcc_items.image_url
 * one SKU at a time. Replaces the dead-end programmatic backfill
 * (UPCitemdb sparse + rate-limited; see project_upcitemdb_unviable).
 *
 * Endpoints:
 *   GET  /admin/catalog/uncovered  — paginated SKUs missing images,
 *                                    on-shelf rows first.
 *   PUT  /admin/catalog/:code/image — set image_url for all rows with
 *                                     that MLCC code. Body: { image_url }.
 *   DELETE /admin/catalog/:code/image — clear image_url back to null
 *                                       (in case of a bad paste).
 * ============================================================ */

const IMAGE_URL_MAX_LEN = 2000;

function isValidImageUrl(u) {
  if (typeof u !== "string") return false;
  const t = u.trim();
  if (!t || t.length > IMAGE_URL_MAX_LEN) return false;
  try {
    const parsed = new URL(t);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * GET /admin/catalog/uncovered
 *
 * Lists active mlcc_items with image_url IS NULL. Rows whose `code`
 * appears in any `bottles` row (i.e. on someone's shelf — the
 * "actually scanned" pool) are returned first so curating effort
 * goes where it matters. Within each bucket, we order by name ASC
 * for predictable scroll.
 *
 * Query params:
 *   - limit:  1..100, default 30
 *   - offset: default 0
 *   - q:      optional ILIKE search on name
 *   - on_shelf_only=true: restrict to SKUs in bottles table
 *
 * Response:
 *   { ok, total, on_shelf_total, rows: [{ code, name, bottle_size_ml,
 *     bottle_size_label, ada_name, category, on_shelf }] }
 */
router.get("/catalog/uncovered", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    let limit = Number.parseInt(String(req.query.limit ?? "30"), 10);
    let offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 30;
    if (limit > 100) limit = 100;
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const onShelfOnly =
      String(req.query.on_shelf_only ?? "").toLowerCase() === "true";

    // First gather all on-shelf MLCC codes (from bottles across all stores).
    // For LK's V1 scale this is fine — bottles has ~hundreds of rows.
    const { data: shelfRows, error: shelfErr } = await supabase
      .from("bottles")
      .select("mlcc_code")
      .eq("is_active", true);
    if (shelfErr) {
      return res.status(500).json({ ok: false, error: shelfErr.message });
    }
    const onShelfCodes = new Set(
      (shelfRows ?? [])
        .map((r) => String(r?.mlcc_code ?? "").trim())
        .filter(Boolean),
    );

    // Two queries: on-shelf first, then off-shelf (or only on-shelf if filtered).
    const baseSelect = (q1) => {
      let s = supabase
        .from("mlcc_items")
        .select(
          "code, name, bottle_size_ml, bottle_size_label, ada_name, category",
          { count: "exact" },
        )
        .is("image_url", null)
        .eq("is_active", true);
      if (q) s = s.ilike("name", `%${q}%`);
      return q1 ? s : s;
    };

    let rows = [];
    let total = 0;
    let onShelfTotal = 0;

    if (onShelfOnly) {
      const codes = [...onShelfCodes];
      onShelfTotal = codes.length;
      if (codes.length === 0) {
        return res.json({
          ok: true,
          total: 0,
          on_shelf_total: 0,
          rows: [],
          limit,
          offset,
        });
      }
      const { data, error, count } = await baseSelect()
        .in("code", codes)
        .order("name", { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
      rows = (data ?? []).map((r) => ({ ...r, on_shelf: true }));
      total = count ?? 0;
    } else {
      // First page block: on-shelf rows. Then off-shelf fills the rest.
      const codes = [...onShelfCodes];
      let shelfData = [];
      let shelfCount = 0;
      if (codes.length > 0) {
        const r = await baseSelect()
          .in("code", codes)
          .order("name", { ascending: true })
          .range(0, 1000); // pull all on-shelf at once; small set
        if (r.error) {
          return res.status(500).json({ ok: false, error: r.error.message });
        }
        shelfData = r.data ?? [];
        shelfCount = shelfData.length;
      }
      onShelfTotal = shelfCount;

      const offShelfStart = Math.max(0, offset - shelfCount);
      const offShelfLimit = limit - Math.max(0, Math.min(limit, shelfCount - offset));

      let offShelfData = [];
      let offShelfTotal = 0;
      if (offShelfLimit > 0) {
        let off = supabase
          .from("mlcc_items")
          .select(
            "code, name, bottle_size_ml, bottle_size_label, ada_name, category",
            { count: "exact" },
          )
          .is("image_url", null)
          .eq("is_active", true);
        if (codes.length > 0) {
          off = off.not("code", "in", `(${codes.map((c) => `"${c}"`).join(",")})`);
        }
        if (q) off = off.ilike("name", `%${q}%`);
        const r = await off
          .order("name", { ascending: true })
          .range(offShelfStart, offShelfStart + offShelfLimit - 1);
        if (r.error) {
          return res.status(500).json({ ok: false, error: r.error.message });
        }
        offShelfData = r.data ?? [];
        offShelfTotal = r.count ?? 0;
      }

      const shelfSlice = shelfData
        .slice(offset, offset + limit)
        .map((r) => ({ ...r, on_shelf: true }));
      const offSlice = offShelfData.map((r) => ({ ...r, on_shelf: false }));
      rows = [...shelfSlice, ...offSlice].slice(0, limit);
      total = shelfCount + offShelfTotal;
    }

    return res.json({
      ok: true,
      total,
      on_shelf_total: onShelfTotal,
      rows,
      limit,
      offset,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * PUT /admin/catalog/:code/image
 * Body: { image_url: string }
 *
 * Updates image_url + image_source='manual' + image_updated_at=now()
 * on every mlcc_items row with the matching code (across ADAs).
 * Validates URL is http(s) and under 2000 chars.
 */
router.put("/catalog/:code/image", express.json(), async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const code = String(req.params.code ?? "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "code_required" });
    }
    const imageUrl = String(req.body?.image_url ?? "").trim();
    if (!isValidImageUrl(imageUrl)) {
      return res.status(400).json({ ok: false, error: "invalid_url" });
    }

    const { data, error } = await supabase
      .from("mlcc_items")
      .update({
        image_url: imageUrl,
        image_source: "manual",
        image_updated_at: new Date().toISOString(),
      })
      .eq("code", code)
      .select("id");
    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    return res.json({ ok: true, updated: (data ?? []).length });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * DELETE /admin/catalog/:code/image — clears image_url back to null.
 */
router.delete("/catalog/:code/image", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const code = String(req.params.code ?? "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "code_required" });
    }
    const { data, error } = await supabase
      .from("mlcc_items")
      .update({
        image_url: null,
        image_source: null,
        image_updated_at: new Date().toISOString(),
      })
      .eq("code", code)
      .select("id");
    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    return res.json({ ok: true, updated: (data ?? []).length });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

/* ============================================================
 * LK Founder Console (task #81, 2026-06-06).
 *
 * "Tony's god view." Returns the company-wide aggregate state in
 * one shot so the founder dashboard can paint with a single fetch:
 *   - Stores: total / new today / new this week / new this month
 *   - Users: total auth users with at least one store_user row
 *   - Runs: last 24h successful runs, failed runs by failure_type
 *   - Confirmations: last 7 days submit count + gross spend across
 *     all stores (LK platform GMV)
 *   - Recent stores list (newest 10 with signup date + first activity)
 *   - Recent errors (10 most recent failed runs with the error message)
 *   - Estimated MRR (active store count × $119)
 *
 * Auth: same LK_ADMIN_TOKEN gate as other /admin/* endpoints. No
 * authenticated user can hit this — bearer must match the secret.
 * ============================================================ */
/**
 * GET /admin/health — one-call system health for the "ready for hundreds of
 * stores" reliability bar (2026-06-07). Answers "is everything OK right now?"
 * so failures don't go unnoticed:
 *   - worker liveness via STUCK runs (status=running with a stale/absent
 *     heartbeat — the same >15min threshold the orphan reaper uses)
 *   - queue backlog (queued count) — a growing queue = workers can't keep up
 *   - 24h failure rate + recent failures with store names
 *
 * `status` is a single rollup: "ok" | "degraded". Designed to be polled by a
 * scheduled check that pings Tony the moment it flips to "degraded" — no
 * dashboard-watching required.
 */
router.get("/health", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const staleCutoff = new Date(now.getTime() - 15 * 60 * 1000); // reaper threshold

    const countSafe = async (build) => {
      try {
        const q = build(
          supabase.from("execution_runs").select("*", { count: "exact", head: true }),
        );
        const { count, error } = await q;
        if (error) return 0;
        return count ?? 0;
      } catch {
        return 0;
      }
    };

    const [queued, running, stuck, total24h, failed24h, succeeded24h] =
      await Promise.all([
        countSafe((q) => q.eq("status", "queued")),
        countSafe((q) => q.eq("status", "running")),
        // Stuck = running but heartbeat is stale, OR never heartbeat'd and old.
        countSafe((q) =>
          q
            .eq("status", "running")
            .or(
              `heartbeat_at.lt.${staleCutoff.toISOString()},and(heartbeat_at.is.null,created_at.lt.${staleCutoff.toISOString()})`,
            ),
        ),
        countSafe((q) => q.gte("created_at", last24h.toISOString())),
        countSafe((q) =>
          q.gte("created_at", last24h.toISOString()).eq("status", "failed"),
        ),
        countSafe((q) =>
          q.gte("created_at", last24h.toISOString()).eq("status", "succeeded"),
        ),
      ]);

    const failureRate = total24h > 0 ? failed24h / total24h : 0;

    // Recent failures (last 5) with store names so an alert can name the store.
    const { data: recentFailures } = await supabase
      .from("execution_runs")
      .select("id, store_id, failure_type, error_message, finished_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(5);
    const failStoreIds = [
      ...new Set((recentFailures ?? []).map((f) => f.store_id).filter(Boolean)),
    ];
    let nameById = new Map();
    if (failStoreIds.length > 0) {
      const { data: storeRows } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", failStoreIds);
      nameById = new Map((storeRows ?? []).map((s) => [s.id, s.store_name]));
    }
    const failures = (recentFailures ?? []).map((f) => ({
      ...f,
      store_name: nameById.get(f.store_id) ?? "unknown",
    }));

    // Rollup. Degraded if any run is wedged, or the failure rate is high on a
    // meaningful sample, or the queue is backing up badly.
    const reasons = [];
    if (stuck > 0) reasons.push(`${stuck} stuck run(s)`);
    if (total24h >= 5 && failureRate > 0.5)
      reasons.push(`high failure rate (${Math.round(failureRate * 100)}% of last 24h)`);
    if (queued >= 25) reasons.push(`queue backlog (${queued} queued)`);
    const status = reasons.length > 0 ? "degraded" : "ok";

    return res.json({
      ok: true,
      status,
      reasons,
      checks: {
        queued,
        running,
        stuck,
        runs24h: total24h,
        failed24h,
        succeeded24h,
        failureRatePct: Math.round(failureRate * 100),
      },
      recentFailures: failures,
      generatedAt: now.toISOString(),
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/founder-console", async (req, res) => {
  if (!assertAdminToken(req, res)) return;
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(now.getTime() - 7 * 86_400_000);
    const monthStart = new Date(now.getTime() - 30 * 86_400_000);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    /*
     * Run a bunch of count queries in parallel. Supabase / PostgREST
     * `head:true` + `count:'exact'` returns the count without the
     * rows — cheap. We tolerate individual query failures so a
     * broken table doesn't blackhole the whole dashboard.
     */
    const countSafe = async (table, build) => {
      try {
        const q = build(supabase.from(table).select("*", { count: "exact", head: true }));
        const { count, error } = await q;
        if (error) return { ok: false, error: error.message };
        return { ok: true, count: count ?? 0 };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    };

    const [
      totalStores,
      newStoresToday,
      newStoresWeek,
      newStoresMonth,
      activeStores,
      totalUsers,
      runsLast24hAll,
      runsLast24hFailed,
      confsLast7d,
    ] = await Promise.all([
      countSafe("stores", (q) => q),
      countSafe("stores", (q) => q.gte("created_at", todayStart.toISOString())),
      countSafe("stores", (q) => q.gte("created_at", weekStart.toISOString())),
      countSafe("stores", (q) => q.gte("created_at", monthStart.toISOString())),
      countSafe("stores", (q) => q.eq("is_active", true)),
      countSafe("store_users", (q) => q.eq("is_active", true)),
      countSafe("execution_runs", (q) => q.gte("created_at", last24h.toISOString())),
      countSafe("execution_runs", (q) =>
        q.gte("created_at", last24h.toISOString()).eq("status", "failed"),
      ),
      countSafe("milo_order_confirmations", (q) =>
        q.gte("placed_at", weekStart.toISOString()),
      ),
    ]);

    /*
     * Recent stores (last 10). We want the newest signups for the
     * "watch the funnel" panel. Joining store_users client-side to
     * count owners per store (simpler than a Postgres JOIN here).
     */
    const { data: recentStores } = await supabase
      .from("stores")
      .select(
        "id, store_name, liquor_license, mlcc_username, is_active, created_at, mlcc_credentials_last_verified_at",
      )
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(10);

    /*
     * Recent failures (last 10) — the "something needs my attention"
     * list. Includes the store_name so Tony can click straight through.
     */
    const { data: recentFailures } = await supabase
      .from("execution_runs")
      .select(
        "id, store_id, status, failure_type, error_message, finished_at, worker_notes",
      )
      .eq("status", "failed")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(10);

    // Hydrate store names for the failures list in one query.
    const failureStoreIds = [
      ...new Set(
        (recentFailures ?? [])
          .map((f) => f.store_id)
          .filter(Boolean),
      ),
    ];
    let storeNameById = new Map();
    if (failureStoreIds.length > 0) {
      const { data: storeRows } = await supabase
        .from("stores")
        .select("id, store_name")
        .in("id", failureStoreIds);
      storeNameById = new Map(
        (storeRows ?? []).map((s) => [s.id, s.store_name]),
      );
    }
    const failuresEnriched = (recentFailures ?? []).map((f) => ({
      ...f,
      store_name: storeNameById.get(f.store_id) ?? "unknown",
    }));

    /*
     * Platform GMV last 7 days — the headline LK number. Sum of
     * net_total across every confirmation submitted in the window.
     */
    const { data: confRows } = await supabase
      .from("milo_order_confirmations")
      .select("net_total, store_id")
      .gte("placed_at", weekStart.toISOString());
    const gmvLast7d =
      Math.round(
        (confRows ?? []).reduce(
          (acc, r) => acc + (Number(r.net_total) || 0),
          0,
        ) * 100,
      ) / 100;
    const activeStoresLast7d = new Set(
      (confRows ?? []).map((r) => r.store_id).filter(Boolean),
    ).size;

    /*
     * Estimated MRR. For now: active_store_count × $119. Real value
     * comes from Stripe once billing is wired (#future). This is the
     * "if everyone paid today" upper bound for the founder's pricing
     * sanity check.
     */
    const PRICE_PER_STORE_USD = 119;
    const estimatedMrr = (activeStores.count ?? 0) * PRICE_PER_STORE_USD;

    return res.json({
      ok: true,
      generated_at: now.toISOString(),
      stores: {
        total: totalStores.count ?? 0,
        active: activeStores.count ?? 0,
        new_today: newStoresToday.count ?? 0,
        new_this_week: newStoresWeek.count ?? 0,
        new_this_month: newStoresMonth.count ?? 0,
      },
      users: {
        active: totalUsers.count ?? 0,
      },
      runs: {
        last_24h_total: runsLast24hAll.count ?? 0,
        last_24h_failed: runsLast24hFailed.count ?? 0,
        success_rate_pct:
          (runsLast24hAll.count ?? 0) === 0
            ? null
            : Math.round(
                ((runsLast24hAll.count - runsLast24hFailed.count) /
                  runsLast24hAll.count) *
                  10000,
              ) / 100,
      },
      activity: {
        confirmations_last_7d: confsLast7d.count ?? 0,
        gmv_last_7d_usd: gmvLast7d,
        active_stores_last_7d: activeStoresLast7d,
      },
      financials: {
        estimated_mrr_usd: estimatedMrr,
        price_per_store_usd: PRICE_PER_STORE_USD,
      },
      recent_stores: recentStores ?? [],
      recent_failures: failuresEnriched,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
