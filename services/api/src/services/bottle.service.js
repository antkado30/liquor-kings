export const searchBottles = (supabase, query, limit = 20) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active",
    )
    .or(`name.ilike.%${query}%,mlcc_code.ilike.%${query}%,upc.ilike.%${query}%`)
    .limit(limit);

export const getBottleById = (supabase, bottleId) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at",
    )
    .eq("id", bottleId)
    .single();

export const getBottleByMlccCode = (supabase, mlccCode) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at",
    )
    .eq("mlcc_code", mlccCode)
    .single();

export const getBottleByUpc = (supabase, upc) =>
  supabase
    .from("bottles")
    .select(
      "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at",
    )
    .eq("upc", upc)
    .single();

export const searchBottlesCompact = (supabase, query, limit = 10) =>
  supabase
    .from("bottles")
    .select("id, name, mlcc_code, upc, size_ml, image_url, is_active")
    .or(`name.ilike.%${query}%,mlcc_code.ilike.%${query}%,upc.ilike.%${query}%`)
    .limit(limit);

export const getRelatedBottles = (supabase, bottle) => {
  if (bottle.upc) {
    return supabase
      .from("bottles")
      .select(
        "id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active",
      )
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
      .eq("size_ml", bottle.size_ml)
      .neq("id", bottle.id)
      .limit(12);
  }

  return Promise.resolve({ data: [], error: null });
};
