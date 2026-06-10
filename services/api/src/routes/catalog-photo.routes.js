/**
 * Catalog photo truth layer (Tony, 2026-06-10).
 *
 * Tony: "even if it's the right bottle, what if the bottle looks different
 * when it comes in? I don't want that happening AT ALL."
 *
 * Internet backfill (Serper) can't guarantee CURRENT trade dress — brands
 * redesign labels, switch glass/plastic. The only ground truth is the
 * bottle physically in the store, and the scanner is already pointed at
 * it. Two endpoints:
 *
 *   POST /catalog/items/:code/photo
 *     body: { image: "data:image/jpeg;base64,..." }
 *     The user snapped the REAL bottle. Re-hosts to Storage and stamps
 *     image_source='in_store' — the highest-precedence source. Overrides
 *     any backfill image. (Backfill scripts only fill NULLs, so an
 *     in-store photo is never clobbered.)
 *
 *   POST /catalog/items/:code/photo-report
 *     body: { reason?: string }
 *     "Wrong photo?" — the catalog must never lie. Clears image_url
 *     immediately (placeholder renders instead) and stamps
 *     image_source='reported_wrong' so backfill scripts SKIP this code
 *     instead of re-filling the same wrong image. Logged for review.
 *
 * Precedence (by image_source): in_store > curated > serper_google_images
 * > NULL/placeholder. 'reported_wrong' = quarantined.
 *
 * Auth: mounted under /catalog behind resolveAuthenticatedStore (writes
 * cost storage + affect every store's catalog view; must be a signed-in
 * store user). Audit-logged to lk_system_diagnostics (doctrine #7 — the
 * dangerous stuff leaves a trail).
 *
 * Schema gotcha (Smirnoff class): mlcc_items `code` is NOT unique —
 * (code, ada_number) is. Existence checks use .limit(1).maybeSingle();
 * updates apply to ALL rows of the code (same bottle, same photo).
 */

import express from "express";
import supabaseDefault from "../config/supabase.js";
import { parseImageInput } from "./catalog-vision.routes.js";

const router = express.Router();

const STORAGE_BUCKET = "bottle-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function extFor(mediaType) {
  if (mediaType.includes("png")) return "png";
  if (mediaType.includes("webp")) return "webp";
  if (mediaType.includes("gif")) return "gif";
  return "jpg";
}

/** Best-effort audit trail; a logging failure must never sink the action. */
async function audit(supabase, req, source, payload) {
  try {
    const { error } = await supabase.from("lk_system_diagnostics").insert({
      store_id: req.store_id ?? null,
      source,
      payload,
    });
    if (error) console.warn(`[catalog-photo] audit insert failed: ${error.message}`);
  } catch (e) {
    console.warn(`[catalog-photo] audit insert threw: ${e?.message ?? e}`);
  }
}

async function codeExists(supabase, code) {
  // code is NOT unique (multi-ADA SKUs) — never .single()/.maybeSingle()
  // without limit(1). The Smirnoff rule.
  const { data, error } = await supabase
    .from("mlcc_items")
    .select("code, name")
    .eq("code", code)
    .order("ada_number")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

router.post("/items/:code/photo", async (req, res) => {
  const supabase = req.supabase ?? supabaseDefault;
  const code = String(req.params.code ?? "").trim();
  if (!code) {
    res.status(400).json({ ok: false, error: "missing_code" });
    return;
  }

  const parsed = parseImageInput(req.body?.image);
  if (!parsed) {
    res.status(400).json({ ok: false, error: "invalid_image" });
    return;
  }
  const buf = Buffer.from(parsed.data, "base64");
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) {
    res.status(400).json({ ok: false, error: "image_size_out_of_range" });
    return;
  }

  let item;
  try {
    item = await codeExists(supabase, code);
  } catch (e) {
    res.status(500).json({ ok: false, error: `lookup_failed: ${e.message}` });
    return;
  }
  if (!item) {
    res.status(404).json({ ok: false, error: "unknown_code" });
    return;
  }

  // Distinct storage path so backfill scripts (which write `${code}.{ext}`)
  // can never collide with an in-store truth photo.
  const path = `instore/${code}.${extFor(parsed.mediaType)}`;
  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType: parsed.mediaType, upsert: true });
  if (upErr) {
    res.status(500).json({ ok: false, error: `upload_failed: ${upErr.message}` });
    return;
  }
  const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    res.status(500).json({ ok: false, error: "no_public_url" });
    return;
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("mlcc_items")
    .update({
      image_url: pub.publicUrl,
      image_source: "in_store",
      image_updated_at: nowIso,
    })
    .eq("code", code);
  if (updErr) {
    res.status(500).json({ ok: false, error: `update_failed: ${updErr.message}` });
    return;
  }

  await audit(supabase, req, "catalog_photo_capture", {
    code,
    name: item.name,
    image_url: pub.publicUrl,
    bytes: buf.byteLength,
  });

  res.json({ ok: true, image_url: pub.publicUrl, image_source: "in_store" });
});

router.post("/items/:code/photo-report", async (req, res) => {
  const supabase = req.supabase ?? supabaseDefault;
  const code = String(req.params.code ?? "").trim();
  if (!code) {
    res.status(400).json({ ok: false, error: "missing_code" });
    return;
  }
  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;

  // Capture what we're clearing for the audit trail before we clear it.
  let prior = null;
  try {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code, name, image_url, image_source")
      .eq("code", code)
      .order("ada_number")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    prior = data;
  } catch (e) {
    res.status(500).json({ ok: false, error: `lookup_failed: ${e.message}` });
    return;
  }
  if (!prior) {
    res.status(404).json({ ok: false, error: "unknown_code" });
    return;
  }

  const { error: updErr } = await supabase
    .from("mlcc_items")
    .update({
      image_url: null,
      image_source: "reported_wrong",
      image_updated_at: new Date().toISOString(),
    })
    .eq("code", code);
  if (updErr) {
    res.status(500).json({ ok: false, error: `update_failed: ${updErr.message}` });
    return;
  }

  await audit(supabase, req, "catalog_photo_report", {
    code,
    name: prior.name,
    prior_image_url: prior.image_url,
    prior_image_source: prior.image_source,
    reason,
  });

  res.json({ ok: true });
});

export default router;
