/**
 * store-memory — the per-store learned vocabulary (THE MOAT, Phase A,
 * 2026-07-24). Tony's decisions: every swap on the resolve card teaches the
 * store silently; a remembered phrase pins its bottle green with
 * "★ remembered" on the next resolve.
 *
 * Boundaries (deliberate):
 *  - Memory can only pin a store's OWN recorded choice — it never invents a
 *    match. Everything not remembered goes through the deterministic
 *    resolver unchanged.
 *  - Memory informs MATCHING only; it never touches the cart.
 *  - Every row carries provenance (source, created_by, timestamps) and usage
 *    counters, so any learning is auditable and deletable.
 *
 * Keying: phrase = tokenizeName(name).join(" ") — the resolver's own
 * tokenizer, so "Olive Cherry Vodka" ≡ "olive cherry vodka". size_ml rides
 * the key ("stoli vanilla" @750 ≠ @1750); null = phrase carried no size.
 */
import { tokenizeName } from "./resolve-order-lines.js";

const TABLE = "store_resolver_memory";

/** Normalize a user phrase to its stable memory key text. Apostrophes are
    stripped BEFORE tokenizing — tokenizeName splits "Tito's" into "tito"+"s"
    but "titos" stays whole, which would give the same bottle two different
    memory keys across conversations (caught by smoke, 2026-07-24). */
export function normalizePhrase(name) {
  return tokenizeName(String(name || "").replace(/['’]/g, "")).join(" ");
}

/** Composite lookup key for the in-process index. */
export function memoryKey(phrase, sizeMl) {
  return `${phrase}::${sizeMl == null ? -1 : sizeMl}`;
}

/**
 * Fetch this store's remembered vocabulary for a set of phrases in ONE query.
 * Returns a Map of memoryKey → row. Fails SOFT (empty map + warn): memory is
 * an enhancement — a memory outage must never break resolving.
 */
export async function fetchMemoryIndex(supabase, storeId, phrases) {
  const wanted = [...new Set((phrases || []).filter((p) => p && p.length > 0))];
  if (!storeId || wanted.length === 0) return new Map();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, phrase, size_ml, mlcc_code, source, times_used")
      .eq("store_id", storeId)
      .in("phrase", wanted);
    if (error) {
      console.warn(`[store-memory] fetch failed (soft): ${error.message}`);
      return new Map();
    }
    const map = new Map();
    for (const row of data || []) {
      map.set(memoryKey(row.phrase, row.size_ml), row);
    }
    return map;
  } catch (e) {
    console.warn(`[store-memory] fetch threw (soft): ${e?.message || e}`);
    return new Map();
  }
}

/**
 * Record corrections learned from resolve-card swaps (or chat/seed later).
 * Upsert semantics: a later correction for the same (phrase,size) REPLACES
 * the earlier one — the store's newest word wins. Returns {saved, errors}.
 *
 * corrections: [{ name, sizeMl?, mlccCode, source?, userId? }]
 */
export async function recordCorrections(supabase, storeId, corrections) {
  const out = { saved: 0, errors: [] };
  if (!storeId || !Array.isArray(corrections)) return out;
  for (const c of corrections.slice(0, 50)) {
    const phrase = normalizePhrase(c?.name);
    const mlccCode = String(c?.mlccCode || "").trim();
    if (!phrase || !mlccCode) continue;
    const sizeMl = Number.isFinite(c?.sizeMl) ? c.sizeMl : null;
    try {
      // Manual upsert (the unique key uses COALESCE, which PostgREST's
      // on_conflict can't target): update-first, insert on miss.
      let q = supabase
        .from(TABLE)
        .update({
          mlcc_code: mlccCode,
          source: c?.source === "chat" || c?.source === "seed" ? c.source : "card_swap",
          updated_at: new Date().toISOString(),
        })
        .eq("store_id", storeId)
        .eq("phrase", phrase);
      q = sizeMl == null ? q.is("size_ml", null) : q.eq("size_ml", sizeMl);
      const upd = await q.select("id");
      if (upd.error) {
        out.errors.push(`${phrase}: ${upd.error.message}`);
        continue;
      }
      if ((upd.data || []).length > 0) {
        out.saved += 1;
        continue;
      }
      const ins = await supabase.from(TABLE).insert({
        store_id: storeId,
        phrase,
        size_ml: sizeMl,
        mlcc_code: mlccCode,
        source: c?.source === "chat" || c?.source === "seed" ? c.source : "card_swap",
        ...(c?.userId ? { created_by: c.userId } : {}),
      });
      if (ins.error) {
        // Unique-race fallback: another writer inserted first — count it.
        if (/duplicate|unique/i.test(ins.error.message)) out.saved += 1;
        else out.errors.push(`${phrase}: ${ins.error.message}`);
      } else {
        out.saved += 1;
      }
    } catch (e) {
      out.errors.push(`${phrase}: ${e?.message || e}`);
    }
  }
  return out;
}

/**
 * List this store's remembered mappings (Phase B chat teaching, 2026-07-25).
 * Newest first, capped. Read-only.
 */
export async function listMemory(supabase, storeId, limit = 50) {
  if (!storeId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("phrase, size_ml, mlcc_code, source, times_used, updated_at")
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 100));
  if (error) {
    console.warn(`[store-memory] list failed (soft): ${error.message}`);
    return [];
  }
  return data ?? [];
}

/**
 * Forget ONE remembered mapping (Phase B). Key = normalized phrase + size
 * (null size targets the size-less memory). Returns { deleted: boolean }.
 */
export async function forgetMemory(supabase, storeId, name, sizeMl) {
  const phrase = normalizePhrase(name);
  if (!storeId || !phrase) return { deleted: false };
  let q = supabase.from(TABLE).delete().eq("store_id", storeId).eq("phrase", phrase);
  q = sizeMl == null ? q.is("size_ml", null) : q.eq("size_ml", sizeMl);
  const { data, error } = await q.select("id");
  if (error) {
    console.warn(`[store-memory] forget failed: ${error.message}`);
    return { deleted: false, error: error.message };
  }
  return { deleted: (data ?? []).length > 0 };
}

/**
 * Bump usage counters for memory rows that just fired (fire-and-forget —
 * callers must NOT await critical-path on this).
 */
export async function markMemoryUsed(supabase, rowIds) {
  const ids = (rowIds || []).filter(Boolean);
  if (ids.length === 0) return;
  try {
    // Per-row increment without an RPC: read-modify-write is fine at this
    // scale (a handful of rows per resolve, counters are advisory).
    const { data } = await supabase.from(TABLE).select("id, times_used").in("id", ids);
    await Promise.all(
      (data || []).map((r) =>
        supabase
          .from(TABLE)
          .update({ times_used: (r.times_used || 0) + 1, last_used_at: new Date().toISOString() })
          .eq("id", r.id),
      ),
    );
  } catch (e) {
    console.warn(`[store-memory] usage bump failed (soft): ${e?.message || e}`);
  }
}
