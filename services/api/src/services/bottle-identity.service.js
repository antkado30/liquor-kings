import { logSystemDiagnostic, DIAGNOSTIC_KIND } from "./diagnostics.service.js";

const normalizeName = (value) => {
  if (value == null || value === "") return null;
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
};

const sameSizeMl = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
};

async function fetchMlccItemByPrimaryCode(supabase, code) {
  const trimmed = code?.trim();
  if (!trimmed) return { data: null, error: null };

  const { data: direct, error: e1 } = await supabase
    .from("mlcc_items")
    .select("id, code, name, size_ml, mlcc_item_no")
    .eq("code", trimmed)
    .maybeSingle();

  if (e1) return { data: null, error: e1 };
  if (direct) return { data: direct, error: null };

  const { data: codeRows, error: e2 } = await supabase
    .from("mlcc_item_codes")
    .select("mlcc_item_id, valid_to")
    .eq("mlcc_code", trimmed);

  if (e2) return { data: null, error: e2 };

  const now = Date.now();
  const validRow = (codeRows ?? []).find(
    (r) => !r.valid_to || new Date(r.valid_to).getTime() > now,
  );
  if (!validRow) return { data: null, error: null };

  const { data: item, error: e3 } = await supabase
    .from("mlcc_items")
    .select("id, code, name, size_ml, mlcc_item_no")
    .eq("id", validRow.mlcc_item_id)
    .maybeSingle();

  if (e3) return { data: null, error: e3 };
  return { data: item ?? null, error: null };
}

async function fetchFingerprintForLiquorCode(supabase, liquorCode) {
  const trimmed = liquorCode?.trim();
  if (!trimmed) return null;

  const { data: rows, error } = await supabase
    .from("mlcc_code_map")
    .select("fingerprint, valid_to, valid_from")
    .eq("liquor_code", trimmed)
    .order("valid_from", { ascending: false })
    .limit(20);

  if (error || !rows?.length) return null;

  const now = Date.now();
  const row = rows.find(
    (r) => !r.valid_to || new Date(r.valid_to).getTime() > now,
  );
  return row?.fingerprint ?? null;
}

/**
 * Resolves authoritative mlcc_items row and validates the client/bottle view.
 * @returns {{ ok: true, mlccItem: object, liquorCode: string, fingerprint: string|null }}
 *          | { ok: false, code: 'CODE_MISMATCH', details: object }
 */
export async function resolveAndVerifyBottleIdentity(supabase, {
  bottleId,
  liquorCode: liquorCodeFromBody,
  requestedName,
  requestedSizeMl,
  requestedFingerprint,
  storeId,
  userId,
}) {
  if (!bottleId) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "bottleId is required" },
    };
  }

  const { data: bottle, error: bottleErr } = await supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, size_ml, mlcc_item_id, is_active, store_id",
    )
    .eq("id", bottleId)
    .maybeSingle();

  if (bottleErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "bottle_lookup_failed", message: bottleErr.message },
    };
  }

  if (!bottle) {
    return { ok: false, code: "CODE_MISMATCH", details: { reason: "bottle_not_found" } };
  }

  if (bottle.is_active === false) {
    return { ok: false, code: "CODE_MISMATCH", details: { reason: "bottle_inactive" } };
  }

  const liquorCode =
    (liquorCodeFromBody && String(liquorCodeFromBody).trim()) ||
    (bottle.mlcc_code && String(bottle.mlcc_code).trim());

  if (!liquorCode) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "missing_liquor_code" },
    };
  }

  const { data: mlccItem, error: mlccErr } = await fetchMlccItemByPrimaryCode(
    supabase,
    liquorCode,
  );

  if (mlccErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "mlcc_resolve_failed", message: mlccErr.message },
    };
  }

  if (!mlccItem) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "mlcc_item_not_found_for_code",
        liquor_code: liquorCode,
        bottle_id: bottleId,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "mlcc_item_not_found", liquor_code: liquorCode },
    };
  }

  if (bottle.mlcc_item_id && bottle.mlcc_item_id !== mlccItem.id) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "bottle_mlcc_item_id_mismatch",
        bottle_id: bottleId,
        bottle_mlcc_item_id: bottle.mlcc_item_id,
        resolved_mlcc_item_id: mlccItem.id,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: {
        reason: "bottle_mlcc_item_id_mismatch",
        resolved_mlcc_item_id: mlccItem.id,
      },
    };
  }

  const trustedLink =
    bottle.mlcc_item_id != null && bottle.mlcc_item_id === mlccItem.id;

  if (trustedLink) {
    const reqName = requestedName != null ? normalizeName(requestedName) : null;
    const canonName = normalizeName(mlccItem.name);
    if (reqName != null && reqName !== canonName) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
        storeId,
        userId,
        payload: {
          reason: "name_variance_trusted_link_non_blocking",
          requested: requestedName,
          resolved: mlccItem.name,
          non_blocking: true,
        },
      });
    }

    if (
      requestedSizeMl !== undefined &&
      requestedSizeMl !== null &&
      !sameSizeMl(Number(requestedSizeMl), mlccItem.size_ml)
    ) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
        storeId,
        userId,
        payload: {
          reason: "size_mismatch_request_vs_mlcc",
          requested_size_ml: requestedSizeMl,
          resolved_size_ml: mlccItem.size_ml,
        },
      });
      return {
        ok: false,
        code: "CODE_MISMATCH",
        details: { reason: "size_mismatch_request_vs_mlcc" },
      };
    }

    const fingerprint = await fetchFingerprintForLiquorCode(supabase, liquorCode);
    if (
      requestedFingerprint != null &&
      String(requestedFingerprint).trim() !== "" &&
      fingerprint != null &&
      String(requestedFingerprint).trim() !== String(fingerprint).trim()
    ) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
        storeId,
        userId,
        payload: { reason: "fingerprint_mismatch" },
      });
      return {
        ok: false,
        code: "CODE_MISMATCH",
        details: { reason: "fingerprint_mismatch" },
      };
    }

    return {
      ok: true,
      mlccItem,
      liquorCode,
      fingerprint,
    };
  }

  const authName = normalizeName(bottle.name);
  const canonName = normalizeName(mlccItem.name);
  if (authName !== canonName) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "name_mismatch_bottle_vs_mlcc",
        bottle_id: bottleId,
        bottle_name: bottle.name,
        mlcc_name: mlccItem.name,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "name_mismatch_bottle_vs_mlcc" },
    };
  }

  if (!sameSizeMl(bottle.size_ml, mlccItem.size_ml)) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "size_mismatch_bottle_vs_mlcc",
        bottle_id: bottleId,
        bottle_size_ml: bottle.size_ml,
        mlcc_size_ml: mlccItem.size_ml,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "size_mismatch_bottle_vs_mlcc" },
    };
  }

  const fingerprint = await fetchFingerprintForLiquorCode(supabase, liquorCode);

  const reqName = requestedName != null ? normalizeName(requestedName) : null;
  const reqSize =
    requestedSizeMl !== undefined && requestedSizeMl !== null
      ? Number(requestedSizeMl)
      : null;

  if (reqName != null && reqName !== canonName) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "name_mismatch_request_vs_mlcc",
        requested: requestedName,
        resolved: mlccItem.name,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "name_mismatch_request_vs_mlcc" },
    };
  }

  if (
    requestedSizeMl !== undefined &&
    requestedSizeMl !== null &&
    !sameSizeMl(reqSize, mlccItem.size_ml)
  ) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "size_mismatch_request_vs_mlcc",
        requested_size_ml: reqSize,
        resolved_size_ml: mlccItem.size_ml,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "size_mismatch_request_vs_mlcc" },
    };
  }

  if (
    requestedFingerprint != null &&
    String(requestedFingerprint).trim() !== "" &&
    fingerprint != null &&
    String(requestedFingerprint).trim() !== String(fingerprint).trim()
  ) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: { reason: "fingerprint_mismatch" },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "fingerprint_mismatch" },
    };
  }

  return {
    ok: true,
    mlccItem,
    liquorCode,
    fingerprint,
  };
}

/**
 * Find or create a per-store bottle from an MLCC code.
 *
 * Bottles are the per-store bridge between the global `mlcc_items` catalog and
 * a store's cart_items / inventory. For scanner / customer flows, the customer
 * only knows the MLCC `code` — they don't know (or shouldn't have to know)
 * about per-store bottle records. This helper looks up the existing bottle for
 * (store_id, mlcc_code) and creates one on first scan if it doesn't exist.
 *
 * Created bottles are stamped with mlcc_item_id (canonical link), name, and
 * size_ml from the resolved mlcc_items row. shelf_price stays null until set
 * via inventory management.
 *
 * Idempotent: scanning the same code twice returns the same bottle row.
 *
 * @returns {{ ok: true, bottle: object, mlccItem: object, created: boolean }}
 *          | { ok: false, code: 'CODE_MISMATCH', details: object }
 */
export async function findOrCreateBottleByMlccCode(supabase, {
  mlccCode,
  storeId,
  userId,
}) {
  const trimmedCode = mlccCode != null ? String(mlccCode).trim() : "";
  if (!trimmedCode) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "mlccCode is required" },
    };
  }
  if (!storeId) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "storeId is required" },
    };
  }

  // 1. Resolve canonical mlcc_items row from the code
  const { data: mlccItem, error: mlccErr } = await fetchMlccItemByPrimaryCode(
    supabase,
    trimmedCode,
  );
  if (mlccErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "mlcc_resolve_failed", message: mlccErr.message },
    };
  }
  if (!mlccItem) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
      storeId,
      userId,
      payload: {
        reason: "mlcc_item_not_found_for_scanner_add",
        liquor_code: trimmedCode,
      },
    });
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "mlcc_item_not_found", liquor_code: trimmedCode },
    };
  }

  // 2. Look up existing active bottle for (store_id, mlcc_code)
  // Use .order + .limit(1) to gracefully handle the rare case where multiple
  // active rows exist for the same code in the same store.
  const { data: existingRows, error: lookupErr } = await supabase
    .from("bottles")
    .select("id, name, mlcc_code, size_ml, mlcc_item_id, is_active, store_id")
    .eq("store_id", storeId)
    .eq("mlcc_code", trimmedCode)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (lookupErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: {
        reason: "bottle_lookup_failed",
        message: lookupErr.message,
      },
    };
  }

  const existing = (existingRows ?? [])[0];
  if (existing) {
    // Sanity check: if mlcc_item_id is set on existing bottle and differs from
    // the resolved mlcc_item.id, log diagnostic but trust the existing row
    // (don't auto-mutate). Operator review can reconcile.
    if (existing.mlcc_item_id && existing.mlcc_item_id !== mlccItem.id) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
        storeId,
        userId,
        payload: {
          reason: "existing_bottle_mlcc_item_id_drift",
          bottle_id: existing.id,
          bottle_mlcc_item_id: existing.mlcc_item_id,
          resolved_mlcc_item_id: mlccItem.id,
          liquor_code: trimmedCode,
          non_blocking: true,
        },
      });
    }
    return {
      ok: true,
      bottle: existing,
      mlccItem,
      created: false,
    };
  }

  // 3. Create a new bottle for this store, seeded from the mlcc_items row
  const { data: created, error: insertErr } = await supabase
    .from("bottles")
    .insert({
      store_id: storeId,
      mlcc_code: trimmedCode,
      mlcc_item_id: mlccItem.id,
      name: mlccItem.name,
      size_ml: mlccItem.size_ml,
      is_active: true,
    })
    .select("id, name, mlcc_code, size_ml, mlcc_item_id, is_active, store_id")
    .single();
  if (insertErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: {
        reason: "bottle_create_failed",
        message: insertErr.message,
      },
    };
  }

  await logSystemDiagnostic({
    kind: "bottle_auto_created_from_scanner",
    storeId,
    userId,
    payload: {
      bottle_id: created.id,
      mlcc_code: trimmedCode,
      mlcc_item_id: mlccItem.id,
      seed_name: mlccItem.name,
      seed_size_ml: mlccItem.size_ml,
    },
  });

  return {
    ok: true,
    bottle: created,
    mlccItem,
    created: true,
  };
}

/**
 * Validates every line on a cart before an execution run is created.
 */
export async function verifyCartItemsBeforeExecution(supabase, {
  storeId,
  userId,
  cartId,
}) {
  const { data: cart, error: cartErr } = await supabase
    .from("carts")
    .select("id, store_id")
    .eq("id", cartId)
    .maybeSingle();

  if (cartErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "cart_load_failed", message: cartErr.message },
    };
  }

  if (!cart || cart.store_id !== storeId) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "cart_store_mismatch" },
    };
  }

  let items = null;
  const withMlccItem = await supabase
    .from("cart_items")
    .select(
      `
      id,
      bottle_id,
      mlcc_item_id,
      bottles (
        id,
        name,
        mlcc_code,
        size_ml,
        mlcc_item_id,
        is_active
      )
    `,
    )
    .eq("cart_id", cartId);

  let itemsErr = withMlccItem.error;
  items = withMlccItem.data;

  // TEMP compatibility logic: some environments may lag behind the formal
  // cart_items.mlcc_item_id migration. Keep this fallback until all deployed
  // databases are confirmed migrated, then remove this branch.
  if (itemsErr && String(itemsErr.message ?? "").includes("mlcc_item_id")) {
    const fallback = await supabase
      .from("cart_items")
      .select(
        `
        id,
        bottle_id,
        bottles (
          id,
          name,
          mlcc_code,
          size_ml,
          mlcc_item_id,
          is_active
        )
      `,
      )
      .eq("cart_id", cartId);

    itemsErr = fallback.error;
    // TEMP compatibility logic: emulate mlcc_item_id field shape for callers
    // while the migration is still rolling out.
    items = (fallback.data ?? []).map((row) => ({ ...row, mlcc_item_id: null }));
  }

  if (itemsErr) {
    return {
      ok: false,
      code: "CODE_MISMATCH",
      details: { reason: "cart_items_load_failed", message: itemsErr.message },
    };
  }

  for (const row of items ?? []) {
    const b = row.bottles;
    if (!b) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
        storeId,
        userId,
        payload: {
          reason: "missing_bottle_join_on_cart_item",
          cart_item_id: row.id,
        },
      });
      return {
        ok: false,
        code: "CODE_MISMATCH",
        details: {
          reason: "missing_bottle_on_cart_item",
          cart_item_id: row.id,
        },
      };
    }

    const vr = await resolveAndVerifyBottleIdentity(supabase, {
      bottleId: row.bottle_id,
      liquorCode: null,
      requestedName: undefined,
      requestedSizeMl: undefined,
      requestedFingerprint: undefined,
      storeId,
      userId,
    });

    if (!vr.ok) return vr;

    if (row.mlcc_item_id && row.mlcc_item_id !== vr.mlccItem.id) {
      await logSystemDiagnostic({
        kind: DIAGNOSTIC_KIND.CODE_MISMATCH,
        storeId,
        userId,
        payload: {
          reason: "cart_item_mlcc_item_id_mismatch",
          cart_item_id: row.id,
          stored_mlcc_item_id: row.mlcc_item_id,
          resolved_mlcc_item_id: vr.mlccItem.id,
        },
      });
      return {
        ok: false,
        code: "CODE_MISMATCH",
        details: { reason: "cart_item_mlcc_item_id_mismatch" },
      };
    }
  }

  return { ok: true };
}
