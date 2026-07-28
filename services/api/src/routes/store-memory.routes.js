/**
 * Store memory routes (2026-07-28) — the Settings "Saved matches" surface.
 *
 * THE MOAT's audit door: every phrase the store has taught the resolver
 * (card swaps, chat teaching) is visible and deletable by the operator.
 * The lib (lib/store-memory.js) already had listMemory/forgetMemory for
 * the assistant's tools; this exposes the same two verbs over REST so
 * Settings can render them. Nothing here can INVENT memory — read and
 * forget only, always scoped to the authenticated store.
 *
 * Mounted under /store-memory with resolveAuthenticatedStore (app.js),
 * which attaches req.store_id.
 */
import express from "express";
import supabaseDefault from "../config/supabase.js";
import { listMemory, forgetMemory } from "../lib/store-memory.js";

const router = express.Router();

/**
 * Join memory rows to catalog product rows for display. mlcc_items.code
 * is NOT unique (unique on (code, ada_number)) — the FIRST row per code
 * anchors, same law as related-products. Missing products degrade to
 * nulls (a delisted bottle's memory row still renders by code).
 */
export function shapeMemoryItems(rows, productRows) {
  const byCode = new Map();
  for (const p of productRows || []) {
    const code = String(p?.code ?? "");
    if (code && !byCode.has(code)) byCode.set(code, p);
  }
  return (rows || []).map((r) => {
    const p = byCode.get(String(r?.mlcc_code ?? ""));
    return {
      phrase: String(r?.phrase ?? ""),
      size_ml: r?.size_ml ?? null,
      mlcc_code: String(r?.mlcc_code ?? ""),
      product_name: p?.name ?? null,
      bottle_size_label: p?.bottle_size_label ?? null,
      source: r?.source ?? null,
      times_used: Number.isFinite(r?.times_used) ? r.times_used : 0,
      updated_at: r?.updated_at ?? null,
    };
  });
}

router.get("/", async (req, res) => {
  try {
    const rows = await listMemory(supabaseDefault, req.store_id, 100);
    let products = [];
    const codes = [...new Set(rows.map((r) => String(r.mlcc_code)).filter(Boolean))];
    if (codes.length > 0) {
      const { data, error } = await supabaseDefault
        .from("mlcc_items")
        .select("code, name, bottle_size_label")
        .in("code", codes);
      if (error) {
        // Fail SOFT on the enrichment — rows still render by code.
        console.warn(`[store-memory] product join failed (soft): ${error.message}`);
      } else {
        products = data ?? [];
      }
    }
    return res.json({ ok: true, items: shapeMemoryItems(rows, products) });
  } catch (e) {
    console.error(`[store-memory] list failed: ${e?.message || e}`);
    return res.status(500).json({ ok: false, error: "memory_list_failed" });
  }
});

/*
 * POST /forget (not DELETE-with-body — fetch() DELETE bodies are flaky
 * across proxies). Keyed the same way the lib keys memory: normalized
 * phrase + size (null = the size-less row). The stored phrase is already
 * normalized and normalizePhrase is idempotent, so echoing a row's own
 * phrase back is always a valid key.
 */
router.post("/forget", async (req, res) => {
  const name = typeof req.body?.phrase === "string" ? req.body.phrase : "";
  const sizeRaw = req.body?.sizeMl;
  const sizeMl = Number.isFinite(sizeRaw) ? sizeRaw : null;
  if (!name.trim()) {
    return res.status(400).json({ ok: false, error: "phrase is required" });
  }
  try {
    const r = await forgetMemory(supabaseDefault, req.store_id, name, sizeMl);
    return res.json({ ok: true, deleted: r.deleted === true });
  } catch (e) {
    console.error(`[store-memory] forget failed: ${e?.message || e}`);
    return res.status(500).json({ ok: false, error: "memory_forget_failed" });
  }
});

export default router;
