/**
 * Order template routes (task #72, 2026-06-04).
 *
 * Per-store reusable cart snapshots. Mounted at /order-templates behind
 * resolveAuthenticatedStore so all routes get req.store_id.
 *
 * - GET    /order-templates              — list templates for the store
 * - POST   /order-templates              — create a template from an items array
 * - PUT    /order-templates/:id          — update name/items
 * - DELETE /order-templates/:id          — archive (soft delete)
 * - POST   /order-templates/:id/load     — mark loaded (updates last_loaded_at) and return items
 */

import express from "express";
import supabase from "../config/supabase.js";

const router = express.Router();

const MAX_NAME_LEN = 80;
const MAX_ITEMS_PER_TEMPLATE = 500;

/**
 * Cron auth — mirrors the price-book check-updates pattern. We use the
 * same LK_CRON_SECRET so Tony has one secret to manage across all
 * cron-job.org schedules. Header preferred; query param accepted for
 * tools that can't set headers.
 */
function requireCronSecret(req, res) {
  const secret = process.env.LK_CRON_SECRET;
  if (!secret) {
    res.status(500).json({ ok: false, error: "LK_CRON_SECRET not configured" });
    return false;
  }
  const headerToken =
    typeof req.headers["x-cron-token"] === "string"
      ? req.headers["x-cron-token"].trim()
      : "";
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";
  const provided = headerToken || queryToken;
  if (!provided || provided !== secret) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

/**
 * Validate schedule fields if present. Either both null (manual-only)
 * or schedule_dow + optional schedule_time_local. dow 0-6, time HH:MM.
 */
function normalizeSchedule(rawDow, rawTime) {
  if (rawDow === undefined && rawTime === undefined) return { ok: true };
  let schedule_dow = null;
  let schedule_time_local = null;
  // Bug fix 2026-06-05: `!= null` catches BOTH null AND undefined. The
  // earlier `!== null && !== ""` let undefined through, which then
  // ran `String(undefined).trim()` → "undefined" → regex failed →
  // "schedule_time_invalid" on every save where the client didn't
  // pass a time at all (which is the normal path — UI only sets dow).
  if (rawDow != null && rawDow !== "") {
    const n = Number(rawDow);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      return { ok: false, error: "schedule_dow_invalid" };
    }
    schedule_dow = n;
  }
  if (rawTime != null && rawTime !== "") {
    const s = String(rawTime).trim();
    if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) {
      return { ok: false, error: "schedule_time_invalid" };
    }
    schedule_time_local = s.length === 5 ? `${s}:00` : s;
  }
  return { ok: true, schedule_dow, schedule_time_local };
}

/**
 * Validate an items array. Each item must be { mlcc_code, quantity }
 * with optional name + bottle_size_ml. Extra fields are dropped so
 * we don't store arbitrary client-side junk in the JSON column.
 */
function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems)) return { ok: false, error: "items_must_be_array" };
  if (rawItems.length === 0) return { ok: false, error: "items_required" };
  if (rawItems.length > MAX_ITEMS_PER_TEMPLATE) {
    return { ok: false, error: `max_${MAX_ITEMS_PER_TEMPLATE}_items` };
  }
  const cleaned = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "item_must_be_object" };
    }
    const code = String(raw.mlcc_code ?? raw.code ?? "").trim();
    const qty = Number(raw.quantity ?? raw.qty);
    if (!code) return { ok: false, error: "item_missing_mlcc_code" };
    if (!Number.isFinite(qty) || qty <= 0 || qty > 9999) {
      return { ok: false, error: `item_invalid_quantity_${code}` };
    }
    const out = { mlcc_code: code, quantity: Math.floor(qty) };
    if (typeof raw.name === "string" && raw.name.trim()) {
      out.name = raw.name.trim().slice(0, 200);
    }
    if (
      raw.bottle_size_ml != null &&
      Number.isFinite(Number(raw.bottle_size_ml))
    ) {
      out.bottle_size_ml = Number(raw.bottle_size_ml);
    }
    cleaned.push(out);
  }
  return { ok: true, items: cleaned };
}

/* ─── List ─────────────────────────────────────────────────────────── */

router.get("/", async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res.status(403).json({ ok: false, error: "Store context not resolved" });
  }
  const includeArchived =
    String(req.query.include_archived ?? "").toLowerCase() === "true";
  let q = supabase
    .from("order_templates")
    .select(
      "id, name, items, created_at, updated_at, last_loaded_at, is_archived, " +
        "schedule_dow, schedule_time_local, last_scheduled_run_at, last_scheduled_load_consumed_at",
    )
    .eq("store_id", storeId)
    .order("last_loaded_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (!includeArchived) q = q.eq("is_archived", false);

  const { data, error } = await q;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  /*
   * Compute "needs_review" — true when a scheduled run fired more
   * recently than the user consumed it. Client uses this to show the
   * "your weekly order is ready" banner without doing its own date math.
   */
  const enriched = (data ?? []).map((t) => {
    const ranAt = t.last_scheduled_run_at
      ? new Date(t.last_scheduled_run_at).getTime()
      : 0;
    const consumedAt = t.last_scheduled_load_consumed_at
      ? new Date(t.last_scheduled_load_consumed_at).getTime()
      : 0;
    return { ...t, needs_review: ranAt > 0 && ranAt > consumedAt };
  });
  return res.json({ ok: true, templates: enriched });
});

/* ─── Create ───────────────────────────────────────────────────────── */

router.post("/", express.json(), async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res.status(403).json({ ok: false, error: "Store context not resolved" });
  }
  const name = String(req.body?.name ?? "").trim().slice(0, MAX_NAME_LEN);
  if (!name) {
    return res.status(400).json({ ok: false, error: "name_required" });
  }
  const normalized = normalizeItems(req.body?.items);
  if (!normalized.ok) {
    return res.status(400).json({ ok: false, error: normalized.error });
  }

  const sched = normalizeSchedule(req.body?.schedule_dow, req.body?.schedule_time_local);
  if (!sched.ok) {
    return res.status(400).json({ ok: false, error: sched.error });
  }

  const { data, error } = await supabase
    .from("order_templates")
    .insert({
      store_id: storeId,
      name,
      items: normalized.items,
      created_by: req.auth_user_id ?? null,
      ...(sched.schedule_dow !== undefined ? { schedule_dow: sched.schedule_dow } : {}),
      ...(sched.schedule_time_local !== undefined
        ? { schedule_time_local: sched.schedule_time_local }
        : {}),
    })
    .select("*")
    .single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(201).json({ ok: true, template: data });
});

/* ─── Update ───────────────────────────────────────────────────────── */

router.put("/:id", express.json(), async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res.status(403).json({ ok: false, error: "Store context not resolved" });
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id_required" });

  const update = { updated_at: new Date().toISOString() };
  if (typeof req.body?.name === "string") {
    const n = req.body.name.trim().slice(0, MAX_NAME_LEN);
    if (!n) return res.status(400).json({ ok: false, error: "name_empty" });
    update.name = n;
  }
  if (req.body?.items !== undefined) {
    const normalized = normalizeItems(req.body.items);
    if (!normalized.ok) {
      return res.status(400).json({ ok: false, error: normalized.error });
    }
    update.items = normalized.items;
  }
  if (typeof req.body?.is_archived === "boolean") {
    update.is_archived = req.body.is_archived;
  }
  if (req.body?.schedule_dow !== undefined || req.body?.schedule_time_local !== undefined) {
    const sched = normalizeSchedule(
      req.body?.schedule_dow,
      req.body?.schedule_time_local,
    );
    if (!sched.ok) {
      return res.status(400).json({ ok: false, error: sched.error });
    }
    if (sched.schedule_dow !== undefined) update.schedule_dow = sched.schedule_dow;
    if (sched.schedule_time_local !== undefined) {
      update.schedule_time_local = sched.schedule_time_local;
    }
  }

  const { data, error } = await supabase
    .from("order_templates")
    .update(update)
    .eq("id", id)
    .eq("store_id", storeId)
    .select("*")
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  // .single() previously threw PGRST116 ("no rows") for a stale/cross-store
  // id and that error masqueraded as a 500. .maybeSingle() + explicit 404
  // (2026-06-13, scan-everything pass) gives the real status.
  if (!data) return res.status(404).json({ ok: false, error: "not_found" });
  return res.json({ ok: true, template: data });
});

/* ─── Archive (soft delete) ───────────────────────────────────────── */

router.delete("/:id", async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res.status(403).json({ ok: false, error: "Store context not resolved" });
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id_required" });

  const { data, error } = await supabase
    .from("order_templates")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("store_id", storeId)
    .select("id")
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  // .single() previously threw PGRST116 ("no rows") for a stale/cross-store
  // id and that error masqueraded as a 500. .maybeSingle() + explicit 404
  // (2026-06-13, scan-everything pass) gives the real status.
  if (!data) return res.status(404).json({ ok: false, error: "not_found" });
  return res.json({ ok: true, archived: data.id });
});

/* ─── Cron: mark today's scheduled templates ready for review ────── */

/**
 * POST /order-templates/run-scheduler
 *
 * Cron-gated daily job. Marks every non-archived template whose
 * schedule_dow matches today's day-of-week (in Eastern time — Tony's
 * store + dad are MI) as "ready for review" by stamping
 * last_scheduled_run_at = now(). The scanner home banner triggers off
 * the diff between this timestamp and last_scheduled_load_consumed_at.
 *
 * Idempotent within the same day: if the cron fires twice (e.g. retry
 * after transient failure), the second run is a no-op because the
 * template's last_scheduled_run_at is already today.
 *
 * NOTE: exported as `runSchedulerHandler` and ALSO registered at the
 * app level so it bypasses the `/order-templates` resolveAuthenticatedStore
 * gate. Without that bypass the cron's X-Cron-Token would never reach
 * this handler — the outer middleware would 401 it first because
 * there's no Authorization: Bearer header in cron-job.org requests.
 * (Pattern matches `/price-book/check-updates` which is registered
 * the same way for the same reason.)
 */
export const runSchedulerHandler = async (req, res) => {
  if (!requireCronSecret(req, res)) return;
  try {
    // Compute Eastern Time day-of-week. America/New_York handles DST
    // transitions for us. Using Intl is more portable than juggling
    // -4/-5 offsets manually.
    const easternFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    });
    const dowName = easternFormatter.format(new Date());
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const todayDow = dowMap[dowName];
    if (todayDow === undefined) {
      return res
        .status(500)
        .json({ ok: false, error: "could_not_resolve_dow" });
    }

    // Today's start in UTC (Eastern midnight). Anything earlier in
    // last_scheduled_run_at means "stale and needs re-marking."
    const todayStartEastern = new Date(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .format(new Date())
        .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2") + "T00:00:00-04:00",
      // -04:00 is fine here even during ST because we only care about
      // "is the timestamp before today's local midnight" — being off
      // an hour around DST changeover doesn't affect the idempotency.
    );
    const nowIso = new Date().toISOString();

    /*
     * Find scheduled templates that match today's dow AND haven't
     * already been marked today. The .or() catches both "never run"
     * and "last run was on a previous day."
     */
    const { data: candidates, error: selErr } = await supabase
      .from("order_templates")
      .select("id, store_id, name, last_scheduled_run_at")
      .eq("schedule_dow", todayDow)
      .eq("is_archived", false);
    if (selErr) {
      return res.status(500).json({ ok: false, error: selErr.message });
    }
    const dueIds = (candidates ?? [])
      .filter(
        (t) =>
          !t.last_scheduled_run_at ||
          new Date(t.last_scheduled_run_at) < todayStartEastern,
      )
      .map((t) => t.id);

    if (dueIds.length === 0) {
      return res.json({
        ok: true,
        scanned: candidates?.length ?? 0,
        marked: 0,
        dow: todayDow,
      });
    }

    const { data: updated, error: updErr } = await supabase
      .from("order_templates")
      .update({ last_scheduled_run_at: nowIso })
      .in("id", dueIds)
      .select("id, store_id, name");
    if (updErr) {
      return res.status(500).json({ ok: false, error: updErr.message });
    }
    return res.json({
      ok: true,
      scanned: candidates?.length ?? 0,
      marked: (updated ?? []).length,
      dow: todayDow,
      marked_template_ids: (updated ?? []).map((t) => t.id),
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

/* ─── Load (mark used) ─────────────────────────────────────────────── */

/**
 * Marks the template as loaded (updates last_loaded_at) and returns
 * its items so the client can add them to the cart. The actual cart
 * mutation happens client-side via the existing addItem flow — we
 * don't want to fight the local cart hook's reducer.
 */
router.post("/:id/load", async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res.status(403).json({ ok: false, error: "Store context not resolved" });
  }
  const id = String(req.params.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "id_required" });

  /*
   * Any load (manual via picker OR from the ready-to-review banner)
   * consumes a scheduled run if one was pending — clears the banner
   * automatically. The two timestamps stay aligned without the client
   * having to tell us which entry point was used.
   */
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("order_templates")
    .update({
      last_loaded_at: nowIso,
      last_scheduled_load_consumed_at: nowIso,
    })
    .eq("id", id)
    .eq("store_id", storeId)
    .select("id, name, items")
    // .single() throws PGRST116 on 0 rows, which would hit the `error`
    // branch above (500) before ever reaching the `!data` 404 check below
    // -- making that check dead code for a stale/cross-store id
    // (2026-06-13, scan-everything pass). .maybeSingle() makes the 404
    // branch actually reachable.
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: "not_found" });

  /*
   * Hydrate items with full mlcc_items rows so the client can call
   * cart.addItem(product, qty) directly. Without this the scanner
   * would need to N+1 fetch each code separately just to learn the
   * name / size / price for a stored template — slow on the load click.
   */
  const items = Array.isArray(data.items) ? data.items : [];
  const codes = [
    ...new Set(
      items
        .map((it) => String(it?.mlcc_code ?? "").trim())
        .filter(Boolean),
    ),
  ];
  let products = [];
  if (codes.length > 0) {
    const { data: catalogRows, error: catalogErr } = await supabase
      .from("mlcc_items")
      .select("*")
      .in("code", codes);
    if (catalogErr) {
      return res.status(500).json({ ok: false, error: catalogErr.message });
    }
    products = (catalogRows ?? []).map((row) => ({
      ...row,
      imageUrl: row.image_url ?? null,
    }));
  }
  // Map: code → first matching product row (code isn't unique, but
  // first match is fine for cart purposes — qty + add-to-cart use the
  // single-row shape).
  const productByCode = new Map();
  for (const p of products) {
    const c = String(p?.code ?? "").trim();
    if (c && !productByCode.has(c)) productByCode.set(c, p);
  }
  /*
   * Surface which template codes no longer exist in the catalog (MLCC
   * dropped the SKU since the template was saved) so the UI can
   * tell the user "we skipped 2 items that are no longer in MLCC's
   * catalog" instead of silently swallowing them.
   */
  const missingCodes = [];
  const enrichedItems = [];
  for (const it of items) {
    const code = String(it?.mlcc_code ?? "").trim();
    const qty = Number(it?.quantity);
    if (!code || !Number.isFinite(qty) || qty <= 0) continue;
    const product = productByCode.get(code);
    if (!product) {
      missingCodes.push({ code, quantity: qty, name: it?.name ?? null });
      continue;
    }
    enrichedItems.push({ product, quantity: Math.floor(qty) });
  }

  return res.json({
    ok: true,
    template: { id: data.id, name: data.name },
    items: enrichedItems,
    missingCodes,
  });
});

export default router;
