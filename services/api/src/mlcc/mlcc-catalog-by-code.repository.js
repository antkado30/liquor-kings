/**
 * Read-only mlcc_items lookup by exact `code` (no writes).
 */

const MAX_ROWS = 200;

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string[]} codes — exact catalog codes (already normalized by caller)
 * @returns {Promise<{ rows: Record<string, unknown>[]; error: Error | null }>}
 */
export async function fetchMlccItemsByExactCodes(supabase, codes) {
  const unique = [...new Set((codes ?? []).filter((c) => typeof c === "string" && c.length > 0))];
  if (unique.length === 0) {
    return { rows: [], error: null };
  }

  const { data, error } = await supabase
    .from("mlcc_items")
    .select("id, code, name, size_ml, abv, mlcc_item_no")
    .in("code", unique)
    .limit(MAX_ROWS);

  if (error) {
    return { rows: [], error };
  }
  return { rows: data ?? [], error: null };
}
