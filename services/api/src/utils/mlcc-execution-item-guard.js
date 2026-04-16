/**
 * Execution enqueue: require a resolved catalog id on each payload line
 * (cart_items.mlcc_item_id or bottles.mlcc_item_id in the snapshot).
 */

/** Same text as POST /execution-runs/from-cart MLCC_ITEM_ID_REQUIRED responses. */
export const MLCC_EXECUTION_ITEM_ID_MESSAGE =
  "Cannot queue MLCC execution: every line must have mlcc_item_id on the cart line or bottle snapshot.";

function hasResolvedMlccItemId(value) {
  if (value == null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

/**
 * @param {{ items?: Array<{ cartItemId?: string; bottleId?: string; mlcc_item_id?: unknown; bottle?: { mlcc_item_id?: unknown } }> } | null | undefined} payload
 * @returns {{ cartItemId: string | null; bottleId: string | null; reason: string }[]}
 */
export function collectMissingMlccItemIdLines(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const missing = [];
  for (const item of items) {
    const lineId = item?.mlcc_item_id;
    const bottleFk = item?.bottle?.mlcc_item_id;
    const ok =
      hasResolvedMlccItemId(lineId) || hasResolvedMlccItemId(bottleFk);
    if (!ok) {
      missing.push({
        cartItemId: item?.cartItemId != null ? String(item.cartItemId) : null,
        bottleId: item?.bottleId != null ? String(item.bottleId) : null,
        reason: "missing_mlcc_item_id",
      });
    }
  }
  return missing;
}
