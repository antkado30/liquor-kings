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

export default router;
