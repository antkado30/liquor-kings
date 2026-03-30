import { logSystemDiagnostic, DIAGNOSTIC_KIND } from "../services/diagnostics.service.js";

/**
 * Express `param("storeId")` handler: URL store must match authenticated context.
 */
export async function enforceParamStoreMatches(req, res, next, storeId) {
  if (!storeId) return next();

  if (req.auth_mode === "service_role" && !req.store_id) {
    return res.status(400).json({ error: "X-Store-Id header required" });
  }

  if (req.store_id !== storeId) {
    await logSystemDiagnostic({
      kind: DIAGNOSTIC_KIND.STORE_MISMATCH,
      storeId: req.store_id,
      userId: req.auth_user_id,
      payload: {
        path: req.path,
        param_store_id: storeId,
        reason: "url_store_mismatch",
      },
    });
    return res.status(403).json({ error: "Store context mismatch" });
  }

  next();
}
