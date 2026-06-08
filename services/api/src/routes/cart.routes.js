import express from "express";
import supabase from "../config/supabase.js";
import { enforceParamStoreMatches } from "../middleware/store-param.middleware.js";
import { enforceCartItemStoreScope } from "../middleware/cart-item-scope.middleware.js";
import {
  resolveAndVerifyBottleIdentity,
  findOrCreateBottleByMlccCode,
} from "../services/bottle-identity.service.js";
import {
  DIAGNOSTIC_KIND,
  logSystemDiagnostic,
} from "../services/diagnostics.service.js";
import { validateCartByCodes } from "../lib/cart-validation.js";

const router = express.Router();

router.param("storeId", enforceParamStoreMatches);

/**
 * POST /cart/:storeId/validate
 *
 * Live cart validation against MLCC rules — per-ADA 9-liter minimum +
 * per-size split-case quantity rules. The scanner calls this as the
 * operator builds a cart, so per-ADA liter totals and rule violations
 * surface BEFORE submit (instead of failing later at MILO).
 *
 * Body: { items: [{ code, quantity }, ...] }
 * 200 → { ok, valid, errors, adaBreakdown, itemsValidated, unknownCodes }
 * 400 → { ok:false, error } when items missing / no known codes
 */
router.post("/:storeId/validate", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = await validateCartByCodes(supabase, body.items);
    if (!result.ok) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        unknownCodes: result.unknownCodes,
      });
    }
    return res.json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

router.patch(
  "/items/:itemId",
  enforceCartItemStoreScope,
  async (req, res) => {
    const { itemId } = req.params;
    const { quantity } = req.body;

    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
      return res
        .status(400)
        .json({ error: "quantity must be a positive integer" });
    }

    const { data: existingItem, error: fetchError } = await supabase
      .from("cart_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    if (!existingItem) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    let patchMlccItemId = existingItem.mlcc_item_id ?? null;
    if (!patchMlccItemId) {
      const identity = await resolveAndVerifyBottleIdentity(supabase, {
        bottleId: existingItem.bottle_id,
        liquorCode: null,
        requestedName: undefined,
        requestedSizeMl: undefined,
        requestedFingerprint: undefined,
        storeId: req.store_id,
        userId: req.auth_user_id,
      });

      if (identity.ok && identity.mlccItem?.id) {
        patchMlccItemId = identity.mlccItem.id;
      } else {
        await logSystemDiagnostic({
          kind: DIAGNOSTIC_KIND.IDENTITY_WRITE_MISSING_MLCC_ITEM_ID,
          storeId: req.store_id,
          userId: req.auth_user_id,
          payload: {
            reason: "quantity_update_with_unresolved_identity",
            cart_item_id: itemId,
            bottle_id: existingItem.bottle_id,
            identity_error: identity.ok ? null : identity.details,
          },
        });
      }
    }

    const { data: updatedItem, error: updateError } = await supabase
      .from("cart_items")
      .update({
        quantity: qty,
        mlcc_item_id: patchMlccItemId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    res.json({
      success: true,
      item: updatedItem,
    });
  },
);

router.delete(
  "/items/:itemId",
  enforceCartItemStoreScope,
  async (req, res) => {
    const { itemId } = req.params;

    const { data: existingItem, error: fetchError } = await supabase
      .from("cart_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message });
    }

    if (!existingItem) {
      return res.status(404).json({ error: "Cart item not found" });
    }

    const { error: deleteError } = await supabase
      .from("cart_items")
      .delete()
      .eq("id", itemId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }

    res.json({
      success: true,
      deletedItemId: itemId,
    });
  },
);

router.get("/:storeId", async (req, res) => {
  const storeId = req.store_id;

  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cartError) {
    return res.status(500).json({ error: cartError.message });
  }

  if (!cart) {
    return res.json({
      success: true,
      cart: null,
      items: [],
    });
  }

  const { data: items, error: itemsError } = await supabase
    .from("cart_items")
    .select(
      `
      id,
      cart_id,
      bottle_id,
      mlcc_item_id,
      quantity,
      created_at,
      updated_at,
      bottles (
        id,
        name,
        mlcc_code,
        upc,
        image_url,
        size,
        size_ml,
        category,
        subcategory,
        state_min_price,
        shelf_price,
        is_active
      )
    `,
    )
    .eq("cart_id", cart.id)
    .order("created_at", { ascending: true });

  if (itemsError) {
    return res.status(500).json({ error: itemsError.message });
  }

  res.json({
    success: true,
    cart,
    items,
  });
});

router.post("/:storeId/items", async (req, res) => {
  const storeId = req.store_id;
  const {
    bottleId,
    mlccCode,           // NEW: scanner path — find/create bottle from MLCC code
    quantity,
    liquor_code,
    mlcc_code,
    name: requestedName,
    size_ml: requestedSizeMl,
    fingerprint: requestedFingerprint,
  } = req.body ?? {};

  // Accept any of: bottleId (admin path), mlccCode/liquor_code/mlcc_code (scanner path)
  const codeForScannerPath =
    (mlccCode != null && String(mlccCode).trim() !== "" && String(mlccCode).trim()) ||
    (liquor_code != null && String(liquor_code).trim() !== "" && String(liquor_code).trim()) ||
    (mlcc_code != null && String(mlcc_code).trim() !== "" && String(mlcc_code).trim()) ||
    null;

  if (!bottleId && !codeForScannerPath) {
    return res
      .status(400)
      .json({ error: "bottleId or mlccCode is required" });
  }

  const qty = Number(quantity);

  if (!Number.isInteger(qty) || qty <= 0) {
    return res
      .status(400)
      .json({ error: "quantity must be a positive integer" });
  }

  let resolvedBottleId = bottleId;
  let mlccItem = null;

  if (!resolvedBottleId) {
    // Scanner path: find or create the bottle for (storeId, mlccCode)
    const result = await findOrCreateBottleByMlccCode(supabase, {
      mlccCode: codeForScannerPath,
      storeId,
      userId: req.auth_user_id,
    });
    if (!result.ok) {
      return res.status(400).json({
        error: result.code || "CODE_MISMATCH",
        details: result.details,
      });
    }
    resolvedBottleId = result.bottle.id;
    mlccItem = result.mlccItem;
  } else {
    // Admin / legacy path: verify the supplied bottleId matches its MLCC catalog entry
    const identity = await resolveAndVerifyBottleIdentity(supabase, {
      bottleId,
      liquorCode: codeForScannerPath,
      requestedName,
      requestedSizeMl,
      requestedFingerprint,
      storeId,
      userId: req.auth_user_id,
    });

    if (!identity.ok) {
      return res.status(400).json({
        error: "CODE_MISMATCH",
        details: identity.details,
      });
    }

    mlccItem = identity.mlccItem;
  }

  if (!mlccItem?.id) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.IDENTITY_WRITE_MISSING_MLCC_ITEM_ID,
      storeId,
      userId: req.auth_user_id,
      payload: {
        reason: "cart_add_missing_resolved_mlcc_item_id",
        bottle_id: resolvedBottleId,
      },
    });
    return res
      .status(500)
      .json({ error: "Identity resolution failed to produce mlcc_item_id" });
  }

  let { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cartError) {
    return res.status(500).json({ error: cartError.message });
  }

  if (!cart) {
    const { data: newCart, error: newCartError } = await supabase
      .from("carts")
      .insert({
        store_id: storeId,
        status: "active",
      })
      .select("*")
      .single();

    if (newCartError) {
      return res.status(500).json({ error: newCartError.message });
    }

    cart = newCart;
  }

  const { data: existingItem, error: existingItemError } = await supabase
    .from("cart_items")
    .select("*")
    .eq("cart_id", cart.id)
    .eq("bottle_id", resolvedBottleId)
    .maybeSingle();

  if (existingItemError) {
    return res.status(500).json({ error: existingItemError.message });
  }

  let savedItem;

  if (existingItem) {
    const newQuantity = existingItem.quantity + qty;

    const { data: updatedItem, error: updateError } = await supabase
      .from("cart_items")
      .update({
        quantity: newQuantity,
        mlcc_item_id: mlccItem.id,
        store_id: storeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingItem.id)
      .select("*")
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    savedItem = updatedItem;
  } else {
    const { data: newItem, error: insertError } = await supabase
      .from("cart_items")
      .insert({
        cart_id: cart.id,
        bottle_id: resolvedBottleId,
        mlcc_item_id: mlccItem.id,
        store_id: storeId,
        quantity: qty,
      })
      .select("*")
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    savedItem = newItem;
  }

  res.status(201).json({
    success: true,
    cart,
    item: savedItem,
  });
});

router.delete("/:storeId/items", async (req, res) => {
  const storeId = req.store_id;

  const { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cartError) {
    return res.status(500).json({ error: cartError.message });
  }

  if (!cart) {
    return res.json({
      success: true,
      clearedCount: 0,
    });
  }

  const { data: cartItems, error: itemsError } = await supabase
    .from("cart_items")
    .select("id")
    .eq("cart_id", cart.id);

  if (itemsError) {
    return res.status(500).json({ error: itemsError.message });
  }

  const ids = (cartItems ?? []).map((row) => row.id);

  if (ids.length === 0) {
    return res.json({
      success: true,
      clearedCount: 0,
    });
  }

  const { error: deleteError } = await supabase
    .from("cart_items")
    .delete()
    .eq("cart_id", cart.id);

  if (deleteError) {
    return res.status(500).json({ error: deleteError.message });
  }

  res.json({
    success: true,
    clearedCount: ids.length,
  });
});

/**
 * POST /cart/:storeId/items/bulk — replace the active cart with the
 * given lines in ONE request (perf, 2026-06-07).
 *
 * WHY: the scanner used to sync a cart by calling POST /items once per
 * line. A 72-item cart = 72 phone→API round trips (each paying cellular
 * + cross-region latency) before a validate/submit could even start.
 * This collapses that into a single request: the SAME identity function
 * (findOrCreateBottleByMlccCode) runs per line server-side, then we
 * clear + batch-insert.
 *
 * SAFETY (integrity doctrine):
 *   - We resolve EVERY line's identity FIRST. If any code can't resolve,
 *     we return 400 and DO NOT touch the existing cart — no partial /
 *     half-cleared state.
 *   - Replace semantics (clear then insert exactly these lines) make the
 *     server cart deterministically equal to the UI, and avoid the
 *     quantity-doubling the increment path would cause on re-sync.
 *   - Duplicate bottle_ids are merged (summed) so the (cart_id, bottle_id)
 *     uniqueness holds.
 *
 * Body: { items: [{ code|mlccCode, quantity }, ...] }
 * 200 → { success, cart, items }
 * 400 → { success:false, error, details } when a line can't resolve
 */
router.post("/:storeId/items/bulk", async (req, res) => {
  const storeId = req.store_id;
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!rawItems || rawItems.length === 0) {
    return res
      .status(400)
      .json({ success: false, error: "items array is required" });
  }

  // Normalize + validate the input lines up front.
  const lines = [];
  for (const it of rawItems) {
    const code =
      (it?.mlccCode != null && String(it.mlccCode).trim()) ||
      (it?.code != null && String(it.code).trim()) ||
      "";
    const qty = Number(it?.quantity);
    if (!code) {
      return res
        .status(400)
        .json({ success: false, error: "each item needs a code" });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        error: `quantity must be a positive integer (code ${code})`,
      });
    }
    lines.push({ code, quantity: qty });
  }

  // Resolve identity for EVERY line first — no DB writes to the cart yet.
  // Sequential on purpose: findOrCreateBottleByMlccCode can create a
  // bottle row, and parallel creation of the same code could race.
  const byBottle = new Map(); // bottle_id -> { bottle_id, mlcc_item_id, quantity }
  for (const line of lines) {
    const result = await findOrCreateBottleByMlccCode(supabase, {
      mlccCode: line.code,
      storeId,
      userId: req.auth_user_id,
    });
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.code || "CODE_MISMATCH",
        details: { code: line.code, ...(result.details ?? {}) },
      });
    }
    if (!result.mlccItem?.id) {
      return res.status(500).json({
        success: false,
        error: "Identity resolution failed to produce mlcc_item_id",
        details: { code: line.code },
      });
    }
    const bottleId = result.bottle.id;
    const existing = byBottle.get(bottleId);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      byBottle.set(bottleId, {
        bottle_id: bottleId,
        mlcc_item_id: result.mlccItem.id,
        quantity: line.quantity,
      });
    }
  }

  // Resolve or create the active cart (same logic as POST /items).
  let { data: cart, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("store_id", storeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cartError) {
    return res.status(500).json({ success: false, error: cartError.message });
  }
  if (!cart) {
    const { data: newCart, error: newCartError } = await supabase
      .from("carts")
      .insert({ store_id: storeId, status: "active" })
      .select("*")
      .single();
    if (newCartError) {
      return res
        .status(500)
        .json({ success: false, error: newCartError.message });
    }
    cart = newCart;
  }

  // All lines resolved — now it's safe to clear + insert.
  const { error: clearError } = await supabase
    .from("cart_items")
    .delete()
    .eq("cart_id", cart.id);
  if (clearError) {
    return res.status(500).json({ success: false, error: clearError.message });
  }

  const rows = [...byBottle.values()].map((r) => ({
    cart_id: cart.id,
    bottle_id: r.bottle_id,
    mlcc_item_id: r.mlcc_item_id,
    store_id: storeId,
    quantity: r.quantity,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("cart_items")
    .insert(rows)
    .select("*");
  if (insertError) {
    return res.status(500).json({ success: false, error: insertError.message });
  }

  return res.status(200).json({
    success: true,
    cart,
    items: Array.isArray(inserted) ? inserted : [],
  });
});

export default router;
