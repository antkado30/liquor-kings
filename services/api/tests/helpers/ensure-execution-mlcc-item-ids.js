/**
 * Best-effort: align smoke-test bottle + cart lines with a catalog mlcc_item_id so
 * execution enqueue guard (mlcc_item_id required) passes when mlcc_items has a row
 * for the bottle's mlcc_code.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ cartId: string; bottleId: string }} ids
 */
export async function ensureExecutionTestCartHasMlccItemIds(supabase, { cartId, bottleId }) {
  const { data: bottle, error: bErr } = await supabase
    .from("bottles")
    .select("id, mlcc_code, mlcc_item_id")
    .eq("id", bottleId)
    .maybeSingle();

  if (bErr || !bottle?.mlcc_code) {
    return;
  }

  let resolvedId = bottle.mlcc_item_id ?? null;
  if (!resolvedId) {
    const { data: mi } = await supabase
      .from("mlcc_items")
      .select("id")
      .eq("code", bottle.mlcc_code)
      .limit(1)
      .maybeSingle();
    resolvedId = mi?.id ?? null;
    if (resolvedId) {
      await supabase.from("bottles").update({ mlcc_item_id: resolvedId }).eq("id", bottleId);
    }
  }

  if (resolvedId) {
    await supabase
      .from("cart_items")
      .update({ mlcc_item_id: resolvedId })
      .eq("cart_id", cartId);
  }
}
