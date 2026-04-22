/**
 * Persist UPC match decisions to `upc_match_audit` and support user flagging.
 */
import { Sentry } from "../lib/sentry.js";

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{
 *   upc: string;
 *   upcBrand: string | null;
 *   upcProductName: string | null;
 *   upcProductNameRaw: string | null;
 *   matchedMlccCode: string | null;
 *   matchMode: string;
 *   confidenceScore: number | null;
 *   confidenceWarning: string | null;
 *   scoringBreakdown: object | null;
 *   allCandidateScores: unknown;
 *   cached: boolean;
 * }} params
 * @returns {Promise<{ ok: boolean; id: string | null }>}
 */
export async function logUpcMatchAudit(supabase, params) {
  try {
    const { data, error } = await supabase
      .from("upc_match_audit")
      .insert({
        upc: params.upc,
        upc_brand: params.upcBrand,
        upc_product_name: params.upcProductName,
        upc_product_name_raw: params.upcProductNameRaw,
        matched_mlcc_code: params.matchedMlccCode,
        match_mode: params.matchMode,
        confidence_score: params.confidenceScore,
        confidence_warning: params.confidenceWarning,
        scoring_breakdown: params.scoringBreakdown,
        all_candidate_scores: params.allCandidateScores,
        cached: params.cached,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[upc_match_audit] insert failed", error.message);
      if (typeof Sentry?.captureException === "function") {
        Sentry.captureException(error);
      }
      return { ok: false, id: null };
    }
    return { ok: true, id: data?.id ? String(data.id) : null };
  } catch (e) {
    console.error("[upc_match_audit] insert exception", e);
    if (typeof Sentry?.captureException === "function") {
      Sentry.captureException(e);
    }
    return { ok: false, id: null };
  }
}

/**
 * Fire-and-forget audit write; never throws to caller.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Parameters<typeof logUpcMatchAudit>[1]} params
 */
export function queueUpcMatchAudit(supabase, params) {
  void logUpcMatchAudit(supabase, params).then((r) => {
    if (process.env.DEBUG_UPC_FILTER === "1") {
      console.log("[upc_match_audit][DEBUG_UPC_FILTER]", JSON.stringify({ queued: true, ok: r.ok, id: r.id }));
    }
  });
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} upc
 * @param {string} reason
 * @returns {Promise<{ ok: boolean; clearedMlccCode?: string; error?: string }>}
 */
export async function flagUpcMatchAsIncorrect(supabase, upc, reason) {
  const u = String(upc ?? "").trim();
  const r = String(reason ?? "").trim() || "user_flag";
  if (!u) {
    return { ok: false, error: "upc_required" };
  }
  try {
    const { data: rows, error: selErr } = await supabase
      .from("upc_match_audit")
      .select("id, matched_mlcc_code")
      .eq("upc", u)
      .order("created_at", { ascending: false })
      .limit(1);

    if (selErr) {
      return { ok: false, error: selErr.message };
    }
    const row = rows?.[0];
    if (!row?.id) {
      return { ok: false, error: "no_audit_row" };
    }

    const { error: upErr } = await supabase
      .from("upc_match_audit")
      .update({
        flagged_incorrect: true,
        flagged_at: new Date().toISOString(),
        flagged_reason: r,
      })
      .eq("id", row.id);

    if (upErr) {
      return { ok: false, error: upErr.message };
    }

    let clearedMlccCode = row.matched_mlcc_code != null ? String(row.matched_mlcc_code) : undefined;
    const { error: clearErr } = await supabase.from("mlcc_items").update({ upc: null }).eq("upc", u);
    if (clearErr) {
      return { ok: false, error: clearErr.message };
    }

    if (process.env.DEBUG_UPC_FILTER === "1") {
      console.log(
        "[upc_match_audit][DEBUG_UPC_FILTER]",
        JSON.stringify({ flag: true, upc: u, reason: r, clearedMlccCode }),
      );
    }

    return { ok: true, clearedMlccCode };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (typeof Sentry?.captureException === "function") {
      Sentry.captureException(e);
    }
    return { ok: false, error: msg };
  }
}
