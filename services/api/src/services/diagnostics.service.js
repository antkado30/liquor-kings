import supabase from "../config/supabase.js";

const SOURCE = "lk_api";

export const DIAGNOSTIC_KIND = {
  UNAUTHORIZED: "unauthorized",
  MISSING_STORE: "missing_store",
  STORE_MISMATCH: "store_mismatch",
  CODE_MISMATCH: "code_mismatch",
};

export async function logSystemDiagnostic({
  kind,
  storeId = null,
  userId = null,
  payload = {},
}) {
  const row = {
    store_id: storeId,
    run_by_user_id: userId,
    source: SOURCE,
    payload: {
      kind,
      ...payload,
      recorded_at: new Date().toISOString(),
    },
  };

  const { error } = await supabase.from("lk_system_diagnostics").insert(row);

  if (error) {
    console.error("[lk_system_diagnostics]", error.message, kind);
  }
}
