/*
 * Multi-tenancy hardening (2026-06-13, scan-everything pass):
 *
 * `bottles` rows are PER-STORE (bottle-identity.service.js inserts each
 * row with a `store_id`). The service-role Supabase client used by the
 * API BYPASSES RLS entirely (see config/supabase.js), so these functions
 * were the only thing standing between one store's catalog and another's.
 *
 * Before this fix, every lookup here (.eq("id", ...), .eq("mlcc_code", ...),
 * .eq("upc", ...), search, related) queried across ALL stores with no
 * store_id filter at all. With a single store in prod this "worked" by
 * accident. The moment a second store onboards (which is the entire
 * point of the SaaS):
 *   - `/bottles/code/:mlccCode` and `/bottles/upc/:upc` use `.single()`,
 *     which THROWS on >1 row. Since MLCC codes/UPCs are shared statewide,
 *     two stores stocking the same product would both have a bottles row
 *     with that code/UPC -> `.single()` errors -> route returns a false
 *     "Bottle not found" 404 for EVERY store, permanently.
 *   - `/bottles/:id`, search, and related-bottles had no store filter at
 *     all -> a store could read another store's private catalog rows
 *     (shelf_price, state_min_price, etc.) by ID, code, or UPC.
 *
 * Fix: every function now takes a required `storeId` and filters on it.
 * `.single()` -> `.maybeSingle()` so a genuine 0-row result returns
 * `{ data: null, error: null }` (clean 404) instead of throwing
 * PGRST116 and being silently mapped to "not found" alongside real
 * multi-row data-integrity errors (doctrine #5: loud failures only).
 */

export const searchBottles = (supabase, storeId, query, limit = 20) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active",
    )
    .eq("store_id", storeId)
    .or(`name.ilike.%${query}%,mlcc_code.ilike.%${query}%,upc.ilike.%${query}%`)
    .limit(limit);

export const getBottleById = (supabase, storeId, bottleId) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .eq("id", bottleId)
    .maybeSingle();

export const getBottleByMlccCode = (supabase, storeId, mlccCode) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .eq("mlcc_code", mlccCode)
    .maybeSingle();

export const getBottleByUpc = (supabase, storeId, upc) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at",
    )
    .eq("store_id", storeId)
    .eq("upc", upc)
    .maybeSingle();

export const searchBottlesCompact = (supabase, storeId, query, limit = 10) =>
  supabase
    .from("bottles")
    .select("id, name, mlcc_code, upc, size_ml, image_url, is_active")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .or(`name.ilike.%${query}%,mlcc_code.ilike.%${query}%,upc.ilike.%${query}%`)
    .limit(limit);

export const getRelatedBottles = (supabase, storeId, bottle) => {
  if (bottle.upc) {
    return supabase
      .from("bottles")
      .select(
        "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active",
      )
      .eq("store_id", storeId)
      .eq("upc", bottle.upc)
      .neq("id", bottle.id)
      .limit(12);
  }

  if (bottle.size_ml) {
    return supabase
      .from("bottles")
      .select(
        "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active",
      )
      .eq("store_id", storeId)
      .eq("size_ml", bottle.size_ml)
      .neq("id", bottle.id)
      .limit(12);
  }

  return Promise.resolve({ data: [], error: null });
};
