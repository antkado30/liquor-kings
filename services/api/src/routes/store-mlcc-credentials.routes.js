import express from "express";
import supabase from "../config/supabase.js";
import { enforceParamStoreMatches } from "../middleware/store-param.middleware.js";
import {
  saveStoreMlccCredentials,
  getStoreMlccCredentialsStatus,
  verifyStoreMlccCredentials,
  clearStoreMlccCredentials,
} from "../services/store-mlcc-credentials.service.js";

const router = express.Router();
router.param("storeId", enforceParamStoreMatches);

/** GET status — never returns password */
router.get("/:storeId/mlcc-credentials/status", async (req, res) => {
  const { storeId } = req.params;
  const result = await getStoreMlccCredentialsStatus(supabase, storeId);
  if (!result.ok) {
    return res
      .status(result.error === "store not found" ? 404 : 500)
      .json({ error: result.error });
  }
  return res.json({ success: true, ...result.status });
});

/** PUT save credentials (does not verify; caller must POST .../verify after) */
router.put("/:storeId/mlcc-credentials", async (req, res) => {
  const { storeId } = req.params;
  const { username, password } = req.body ?? {};
  const result = await saveStoreMlccCredentials(supabase, storeId, {
    username,
    password,
  });
  if (!result.ok) {
    const status = result.error === "store not found" ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.json({ success: true, store: result.store });
});

/** POST verify — runs Stage 1 against live MILO */
router.post("/:storeId/mlcc-credentials/verify", async (req, res) => {
  const { storeId } = req.params;
  const headless = req.body?.headless !== false;
  const result = await verifyStoreMlccCredentials(supabase, storeId, {
    headless,
  });
  if (result.code === "LK_NO_CREDENTIALS") {
    return res.status(400).json({ error: "no_credentials_on_file" });
  }
  if (result.code === "LK_DECRYPT_FAILED") {
    return res.status(500).json({ error: "decryption_failed" });
  }
  return res.json({
    success: result.ok,
    status: result.status,
    errorCode: result.errorCode,
    verifiedAt: result.verifiedAt,
    lastVerifiedAt: result.lastVerifiedAt,
  });
});

/** DELETE clear credentials */
router.delete("/:storeId/mlcc-credentials", async (req, res) => {
  const { storeId } = req.params;
  const result = await clearStoreMlccCredentials(supabase, storeId);
  if (!result.ok) {
    return res
      .status(result.error === "store not found" ? 404 : 500)
      .json({ error: result.error });
  }
  return res.json({ success: true });
});

export default router;
