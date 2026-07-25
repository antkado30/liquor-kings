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
import { askAssistant, resolveOrderList } from "../lib/assistant.js";
import { recordCorrections } from "../lib/store-memory.js";
import supabase from "../config/supabase.js";
import { sizeFromText } from "../lib/resolve-order-lines.js";

const router = express.Router();

/**
 * POST /assistant/ask
 * Body: { question: string, storeId?: string, imageDataUri?: string, imageDataUris?: string[] }
 *   - imageDataUris[] (2026-07-17, multi-photo): send several photos in one
 *     message. Legacy imageDataUri (singular) still accepted; both may be
 *     present. Server caps + validates.
 * 200 → { answer, toolCalls, model, iterations }
 * 400 → { error } when question and images are both missing
 * 503 → { error } when ANTHROPIC_API_KEY not configured
 * 500 → { error } on unexpected failure
 */
router.post("/ask", async (req, res) => {
  const body = req.body ?? {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const storeId = body.storeId ? String(body.storeId) : null;
  const imageDataUri =
    typeof body.imageDataUri === "string" ? body.imageDataUri.trim() : "";
  const imageDataUris = Array.isArray(body.imageDataUris)
    ? body.imageDataUris.filter((u) => typeof u === "string" && u.trim() !== "").map((u) => u.trim())
    : [];
  // Conversation history so follow-ups keep context (fixes "every one of what?").
  const history = Array.isArray(body.history) ? body.history : [];

  if (!question && !imageDataUri && imageDataUris.length === 0) {
    return res.status(400).json({ error: "question or image is required" });
  }

  try {
    const result = await askAssistant({
      question,
      storeId,
      imageDataUri: imageDataUri || null,
      imageDataUris,
      history,
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

/**
 * POST /assistant/resolve-order
 * Body: { text: string }  — a free-text reorder list, however messy.
 * 200 → { lines: [{ input, name, sizeMl, qty, best, alternates, confidence }], parseModel }
 * 400 → { error } when text is missing
 * 503 → { error } when ANTHROPIC_API_KEY not configured
 * 500 → { error } on unexpected failure
 *
 * Resolves each line to an MLCC code (LLM parses the text; deterministic
 * matching finds codes). Read-only — the client adds confirmed lines to the
 * cart via the normal authenticated cart API.
 */
router.post("/resolve-order", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }
  try {
    const result = await resolveOrderList({ text });
    return res.json(result);
  } catch (e) {
    const message = e?.message || String(e);
    const isConfigError = /ANTHROPIC_API_KEY/.test(message);
    if (isConfigError) {
      console.error("[assistant] resolve-order config error:", message);
      return res.status(503).json({ error: message });
    }
    console.error("[assistant] resolve-order failed:", message);
    return res.status(500).json({ error: message });
  }
});

/**
 * POST /assistant/memory — THE MOAT's learn path (Phase A, 2026-07-24).
 * Body: { storeId, corrections: [{ name, size?, sizeMl?, mlcc_code }] }
 * 200 → { saved, errors }
 *
 * Called fire-and-forget by the resolve card when the owner SWAPS a match
 * and adds to cart (Tony's call: every swap teaches, silently). Upserts the
 * store's (phrase,size) → code memory; the next resolve of that phrase pins
 * the remembered bottle green ("★ remembered").
 *
 * Auth posture matches /assistant/ask (storeId trusted in body — V1;
 * per-store middleware scoping is the same tracked V1.5 hardening item).
 * Writes are capped, provenance-stamped, and only ever touch this table.
 */
router.post("/memory", async (req, res) => {
  const body = req.body ?? {};
  const storeId = body.storeId ? String(body.storeId) : null;
  const list = Array.isArray(body.corrections) ? body.corrections : [];
  if (!storeId) return res.status(400).json({ error: "storeId is required" });
  if (list.length === 0) return res.status(400).json({ error: "corrections[] is required" });
  try {
    const corrections = list.map((c) => ({
      name: String(c?.name || ""),
      // KEY SYMMETRY: derive size EXACTLY like resolve time does
      // (size field → raw line → name), so the learned key and the next
      // resolve's lookup key can never disagree.
      sizeMl: Number.isFinite(c?.sizeMl)
        ? c.sizeMl
        : (sizeFromText(String(c?.size || "")) ??
          sizeFromText(String(c?.raw || "")) ??
          sizeFromText(String(c?.name || "")) ??
          null),
      mlccCode: String(c?.mlcc_code || c?.mlccCode || ""),
      source: "card_swap",
    }));
    const result = await recordCorrections(supabase, storeId, corrections);
    return res.json(result);
  } catch (e) {
    const message = e?.message || String(e);
    console.error("[assistant] memory record failed:", message);
    return res.status(500).json({ error: message });
  }
});

export default router;
