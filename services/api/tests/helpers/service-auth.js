import dotenv from "dotenv";

dotenv.config();

export function serviceRoleAuthHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for authenticated API tests",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

export function storeScopedAuthHeaders(storeId) {
  return {
    ...serviceRoleAuthHeaders(),
    "X-Store-Id": storeId,
  };
}
