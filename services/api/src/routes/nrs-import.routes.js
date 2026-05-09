/**
 * NRS POS export bulk-import endpoint.
 *
 * POST /admin/nrs-import
 *
 * Auth: X-Admin-Token (matches LK_ADMIN_TOKEN env if set; open in dev when unset).
 *
 * Body modes:
 *   - Content-Type: text/csv  → request body IS the raw CSV text
 *   - Content-Type: application/json  → body is { csvText: string, dryRun?: boolean }
 *
 * Query params:
 *   - dryRun=true  → don't write upc_mappings; just report what WOULD happen
 *
 * Response: NRS import report (parse stats, matching counts, write outcomes,
 * sample of unmatched UPCs for the operator to investigate).
 *
 * Phase 2A: Tier 1 direct UPC matches only. Tier 2 (fuzzy name+size+brand)
 * lands in a follow-up phase with its own review UI.
 */
import express from "express";
import supabase from "../config/supabase.js";
import { runNrsImport } from "../services/nrs-import.service.js";

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

// Raw text body parser, large enough for typical retail catalog exports.
// 25mb covers ~150,000 rows. The mounted JSON parser at app level handles JSON.
const textParser = express.text({ limit: "25mb", type: ["text/csv", "text/plain"] });

router.post("/nrs-import", textParser, async (req, res) => {
  if (!assertAdminToken(req, res)) return;

  const dryRunQuery = String(req.query.dryRun ?? "").toLowerCase() === "true";

  let csvText = "";
  let dryRunFromBody = false;
  if (typeof req.body === "string") {
    csvText = req.body;
  } else if (req.body && typeof req.body === "object") {
    csvText = typeof req.body.csvText === "string" ? req.body.csvText : "";
    dryRunFromBody = req.body.dryRun === true;
  }

  if (!csvText || csvText.length < 50) {
    return res.status(400).json({
      ok: false,
      error: "request body must be CSV text (Content-Type: text/csv) or JSON { csvText, dryRun }",
      receivedBytes: csvText.length,
    });
  }

  const dryRun = dryRunQuery || dryRunFromBody;

  try {
    const result = await runNrsImport(supabase, csvText, { dryRun });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, dryRun, ...result.report });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
