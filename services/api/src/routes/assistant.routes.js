/**
 * AI Assistant route — POST /assistant/ask
 *
 * The V1 "moat" feature (docs/lk/v1-spec.md Pillar 4). Takes an operator's
 * natural-language question, runs it through the Claude-tool-use assistant
 * in lib/assistant.js (liquor expert + store tools), returns an answer.
 *
 * V1 auth posture: storeId is accepted in the body and trusted. This is an
 * operator-facing tool. Proper per-store auth scoping (via the
 * resolveAuthenticatedStore middleware used by /cart, /inventory, etc.) is
 * a V1.5 hardening item — tracked, not forgotten.
 */

import express from "express";
import { askAssistant } from "../lib/assistant.js";

const router = express.Router();

/**
 * POST /assistant/ask
 * Body: { question: string, storeId?: string, imageDataUri?: string }
 * 200 → { answer, toolCalls, model, iterations }
 * 400 → { error } when question and image are both missing
 * 503 → { error } when ANTHROPIC_API_KEY not configured
 * 500 → { error } on unexpected failure
 */
router.post("/ask", async (req, res) => {
  const body = req.body ?? {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const storeId = body.storeId ? String(body.storeId) : null;
  const imageDataUri =
    typeof body.imageDataUri === "string" ? body.imageDataUri.trim() : "";

  if (!question && !imageDataUri) {
    return res.status(400).json({ error: "question or imageDataUri is required" });
  }

  try {
    const result = await askAssistant({
      question,
      storeId,
      imageDataUri: imageDataUri || null,
    });
    return res.json(result);
  } catch (e) {
    const message = e?.message || String(e);
    // Missing API key is a config problem (503), not a runtime bug (500).
    const isConfigError = /ANTHROPIC_API_KEY/.test(message);
    if (isConfigError) {
      console.error("[assistant] config error:", message);
      return res.status(503).json({ error: message });
    }
    console.error("[assistant] request failed:", message);
    return res.status(500).json({ error: message });
  }
});

export default router;
