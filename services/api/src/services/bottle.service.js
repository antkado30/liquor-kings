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
