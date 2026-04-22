/**
 * Authoritative UPC → MLCC code mappings (`public.upc_mappings`).
 * @typedef {import("@supabase/supabase-js").SupabaseClient} SupabaseClient
 */

import { Sentry } from "./sentry.js";

/**
 * @param {SupabaseClient} supabase
 * @param {string} upc
 * @returns {Promise<{ mlccCode: string; confidenceSource: string; scanCount: number; flagCount: number } | null>}
 */
export async function getUpcMapping(supabase, upc) {
  const u = String(upc ?? "").trim();
  if (!u) return null;
  try {
    const { data, error } = await supabase
      .from("upc_mappings")
      .select("mlcc_code, confidence_source, scan_count, flag_count")
      .eq("upc", u)
      .maybeSingle();
    if (error) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(error);
      return null;
    }
    if (!data?.mlcc_code) return null;
    return {
      mlccCode: String(data.mlcc_code),
      confidenceSource: String(data.confidence_source ?? ""),
      scanCount: Number.isFinite(Number(data.scan_count)) ? Number(data.scan_count) : 0,
      flagCount: Number.isFinite(Number(data.flag_count)) ? Number(data.flag_count) : 0,
    };
  } catch (e) {
    if (typeof Sentry?.captureException === "function") Sentry.captureException(e);
    return null;
  }
}

/**
 * Upsert mapping for a UPC (one row per UPC). Preserves scan_count and notes on update; resets flag_count.
 * @param {SupabaseClient} supabase
 * @param {{ upc: string; mlccCode: string; confidenceSource: string; confirmedBy?: string | null }} params
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function upsertUpcMapping(supabase, { upc, mlccCode, confidenceSource, confirmedBy }) {
  const u = String(upc ?? "").trim();
  const code = String(mlccCode ?? "").trim();
  const src = String(confidenceSource ?? "").trim();
  if (!u || !code || !src) return null;
  const now = new Date().toISOString();
  const by =
    confirmedBy != null && String(confirmedBy).trim() !== "" ? String(confirmedBy).trim() : null;
  try {
    const { data: ex, error: selErr } = await supabase
      .from("upc_mappings")
      .select("id, scan_count, notes")
      .eq("upc", u)
      .maybeSingle();
    if (selErr) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(selErr);
      return null;
    }
    const patch = {
      mlcc_code: code,
      confidence_source: src,
      confirmed_by: by,
      confirmed_at: now,
      updated_at: now,
      flag_count: 0,
    };
    if (ex?.id) {
      const scanCount = Number.isFinite(Number(ex.scan_count)) ? Number(ex.scan_count) : 0;
      const { data, error } = await supabase
        .from("upc_mappings")
        .update({ ...patch, scan_count: scanCount, notes: ex.notes ?? null })
        .eq("upc", u)
        .select()
        .maybeSingle();
      if (error) {
        if (typeof Sentry?.captureException === "function") Sentry.captureException(error);
        return null;
      }
      return data && typeof data === "object" ? { ...data } : null;
    }
    const { data, error } = await supabase
      .from("upc_mappings")
      .insert({
        upc: u,
        ...patch,
        scan_count: 0,
        notes: null,
      })
      .select()
      .maybeSingle();
    if (error) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(error);
      return null;
    }
    return data && typeof data === "object" ? { ...data } : null;
  } catch (e) {
    if (typeof Sentry?.captureException === "function") Sentry.captureException(e);
    return null;
  }
}

/**
 * Increment authoritative mapping scan counter (fire-and-forget safe).
 * @param {SupabaseClient} supabase
 * @param {string} upc
 * @returns {Promise<{ ok: boolean }>}
 */
export async function incrementUpcMappingScanCount(supabase, upc) {
  const u = String(upc ?? "").trim();
  if (!u) return { ok: false };
  try {
    const { data: row, error: selErr } = await supabase
      .from("upc_mappings")
      .select("scan_count")
      .eq("upc", u)
      .maybeSingle();
    if (selErr || !row) {
      if (selErr && typeof Sentry?.captureException === "function") Sentry.captureException(selErr);
      return { ok: false };
    }
    const next = (Number.isFinite(Number(row.scan_count)) ? Number(row.scan_count) : 0) + 1;
    const { error: upErr } = await supabase
      .from("upc_mappings")
      .update({ scan_count: next, last_scanned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("upc", u);
    if (upErr) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(upErr);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    if (typeof Sentry?.captureException === "function") Sentry.captureException(e);
    return { ok: false };
  }
}

/**
 * User flagged the match as wrong: increment {@code flag_count} and {@code last_flagged_at};
 * when {@code flag_count} reaches 2, delete the mapping row. (If you need the mapping gone
 * after the first flag, call {@link deleteUpcMapping} from the route as well.)
 * @param {SupabaseClient} supabase
 * @param {string} upc
 * @returns {Promise<{ removed: boolean; ok: boolean }>}
 */
export async function flagUpcMappingAsIncorrect(supabase, upc) {
  const u = String(upc ?? "").trim();
  if (!u) return { removed: false, ok: false };
  try {
    const { data: row, error: selErr } = await supabase
      .from("upc_mappings")
      .select("flag_count")
      .eq("upc", u)
      .maybeSingle();
    if (selErr) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(selErr);
      return { removed: false, ok: false };
    }
    if (!row) return { removed: false, ok: true };
    const prev = Number.isFinite(Number(row.flag_count)) ? Number(row.flag_count) : 0;
    const next = prev + 1;
    const now = new Date().toISOString();
    if (next >= 2) {
      const { error: delErr } = await supabase.from("upc_mappings").delete().eq("upc", u);
      if (delErr) {
        if (typeof Sentry?.captureException === "function") Sentry.captureException(delErr);
        return { removed: false, ok: false };
      }
      return { removed: true, ok: true };
    }
    const { error: upErr } = await supabase
      .from("upc_mappings")
      .update({ flag_count: next, last_flagged_at: now, updated_at: now })
      .eq("upc", u);
    if (upErr) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(upErr);
      return { removed: false, ok: false };
    }
    return { removed: false, ok: true };
  } catch (e) {
    if (typeof Sentry?.captureException === "function") Sentry.captureException(e);
    return { removed: false, ok: false };
  }
}

/**
 * @param {SupabaseClient} supabase
 * @param {string} upc
 * @returns {Promise<{ ok: boolean; removed: boolean }>}
 */
export async function deleteUpcMapping(supabase, upc) {
  const u = String(upc ?? "").trim();
  if (!u) return { ok: false, removed: false };
  try {
    const { data, error } = await supabase.from("upc_mappings").delete().eq("upc", u).select("id");
    if (error) {
      if (typeof Sentry?.captureException === "function") Sentry.captureException(error);
      return { ok: false, removed: false };
    }
    return { ok: true, removed: Array.isArray(data) && data.length > 0 };
  } catch (e) {
    if (typeof Sentry?.captureException === "function") Sentry.captureException(e);
    return { ok: false, removed: false };
  }
}
