import { parseMlccPriceBookExcel, deriveAdaName } from "./mlcc-price-book-parser.js";

/** Default: February 1, 2026 spirits price book (override with options.url or env if URL changes). */
export const DEFAULT_MLCC_PRICE_BOOK_XLSX_URL =
  "https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/Price-Book/Spirits-Price-Book-Effective-February-1-2026.xlsx";

const FETCH_TIMEOUT_MS = 30_000;

function toDateOnly(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    const t = new Date();
    return t.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function numEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

/**
 * @param {string | undefined} urlOverride
 * @returns {Promise<{ ok: true, buffer: Buffer, url: string } | { ok: false, error: string }>}
 */
export async function fetchLatestMlccPriceBookExcel(urlOverride) {
  const url = (urlOverride && String(urlOverride).trim()) || DEFAULT_MLCC_PRICE_BOOK_XLSX_URL;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} downloading price book` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      return { ok: false, error: "Downloaded file is empty" };
    }
    return { ok: true, buffer: buf, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Download failed" };
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<object | null>}
 */
export async function getLatestPriceBookRun(supabase) {
  try {
    const { data, error } = await supabase
      .from("mlcc_price_book_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.log("[price-book-ingestor] getLatestPriceBookRun error:", error.message);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.log("[price-book-ingestor] getLatestPriceBookRun exception:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function updateRun(supabase, runId, patch) {
  try {
    await supabase.from("mlcc_price_book_runs").update(patch).eq("id", runId);
  } catch {
    /* ignore */
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {Date} [options.priceBookDate]
 * @param {boolean} [options.dryRun]
 */
export async function ingestMlccPriceBook(supabase, options = {}) {
  const opts = options || {};
  const dryRun = Boolean(opts.dryRun);
  const priceBookDate = opts.priceBookDate instanceof Date && !Number.isNaN(opts.priceBookDate.getTime())
    ? opts.priceBookDate
    : new Date();
  const dateStr = toDateOnly(priceBookDate);

  if (dryRun) {
    console.log("[price-book-ingestor] dryRun: skipping DB run record; downloading and parsing only");
    const dl = await fetchLatestMlccPriceBookExcel(opts.url);
    if (!dl.ok) {
      console.log("[price-book-ingestor] dryRun download failed:", dl.error);
      return { ok: false, error: dl.error };
    }
    console.log("[price-book-ingestor] dryRun: downloaded", dl.url);
    const parsed = parseMlccPriceBookExcel(dl.buffer);
    if (!parsed.ok) {
      console.log("[price-book-ingestor] dryRun parse failed:", parsed.errors);
      return { ok: false, error: parsed.errors.join("; ") || "Parse failed" };
    }
    const totalItems = parsed.items.length;
    const newItems = parsed.items.filter((i) => i.isNewItem).length;
    console.log("[price-book-ingestor] dryRun complete:", { totalItems, flaggedNew: newItems });
    return {
      ok: true,
      dryRun: true,
      totalItems,
      newItems,
      updatedItems: 0,
      url: dl.url,
    };
  }

  let runId = null;
  try {
    console.log("[price-book-ingestor] creating run record (processing)");
    const { data: runRow, error: runErr } = await supabase
      .from("mlcc_price_book_runs")
      .insert({
        price_book_date: dateStr,
        status: "processing",
        source_url: opts.url || null,
      })
      .select("id")
      .single();

    if (runErr || !runRow?.id) {
      const msg = runErr?.message || "Failed to create mlcc_price_book_runs row";
      console.log("[price-book-ingestor] run insert failed:", msg);
      return { ok: false, error: msg };
    }
    runId = runRow.id;

    const dl = await fetchLatestMlccPriceBookExcel(opts.url);
    if (!dl.ok) {
      console.log("[price-book-ingestor] download failed:", dl.error);
      await updateRun(supabase, runId, {
        status: "failed",
        error_message: dl.error,
        completed_at: new Date().toISOString(),
        source_url: opts.url || null,
      });
      return { ok: false, error: dl.error, runId };
    }
    console.log("[price-book-ingestor] downloaded:", dl.url);
    await updateRun(supabase, runId, { source_url: dl.url });

    const parsed = parseMlccPriceBookExcel(dl.buffer);
    if (!parsed.ok) {
      const errMsg = parsed.errors.join("; ") || "Parse failed";
      console.log("[price-book-ingestor] parse failed:", errMsg);
      await updateRun(supabase, runId, {
        status: "failed",
        error_message: errMsg,
        completed_at: new Date().toISOString(),
      });
      return { ok: false, error: errMsg, runId };
    }

    const effectiveDateStr = parsed.priceBookDate ? toDateOnly(parsed.priceBookDate) : dateStr;
    const items = parsed.items.filter((i) => i.mlccCode);
    console.log("[price-book-ingestor] parsed rows:", items.length);

    const codes = [...new Set(items.map((i) => i.mlccCode))];
    /** @type {Map<string, object>} */
    const existingByCode = new Map();
    const chunkSize = 500;
    for (let i = 0; i < codes.length; i += chunkSize) {
      const chunk = codes.slice(i, i + chunkSize);
      const { data: rows, error: selErr } = await supabase.from("mlcc_items").select("*").in("code", chunk);
      if (selErr) {
        console.log("[price-book-ingestor] existing fetch error:", selErr.message);
        await updateRun(supabase, runId, {
          status: "failed",
          error_message: selErr.message,
          completed_at: new Date().toISOString(),
        });
        return { ok: false, error: selErr.message, runId };
      }
      for (const row of rows || []) {
        existingByCode.set(row.code, row);
      }
    }

    let newCount = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    const upsertRows = [];

    for (const item of items) {
      const code = item.mlccCode;
      const existing = existingByCode.get(code);
      const isNew = !existing;
      const priceChanged =
        existing &&
        (!numEq(existing.base_price, item.basePrice) ||
          !numEq(existing.licensee_price, item.licenseePrice) ||
          !numEq(existing.min_shelf_price, item.minShelfPrice));

      if (isNew) newCount += 1;
      else if (priceChanged) updatedCount += 1;

      const priceChangedAt =
        isNew || priceChanged ? nowIso : existing?.price_changed_at ?? null;

      upsertRows.push({
        code,
        name: item.brandName || code,
        mlcc_item_no: existing?.mlcc_item_no ?? code,
        size_ml: item.bottleSizeMl ?? existing?.size_ml ?? null,
        category: existing?.category ?? null,
        subcategory: existing?.subcategory ?? null,
        abv: existing?.abv ?? null,
        state_min_price: item.minShelfPrice ?? existing?.state_min_price ?? null,
        upc: existing?.upc ?? null,
        proof: item.proof,
        bottle_size_ml: item.bottleSizeMl,
        bottle_size_label: item.bottleSizeLabel || null,
        case_size: item.caseSize,
        base_price: item.basePrice,
        licensee_price: item.licenseePrice,
        min_shelf_price: item.minShelfPrice,
        ada_number: item.adaNumber || null,
        ada_name: deriveAdaName(item.adaNumber),
        brand_family: existing?.brand_family ?? null,
        is_active: existing?.is_active ?? true,
        last_price_book_date: effectiveDateStr,
        price_changed_at: priceChangedAt,
        is_new_item: item.isNewItem,
        updated_at: nowIso,
      });
    }

    const upsertChunk = 150;
    for (let i = 0; i < upsertRows.length; i += upsertChunk) {
      const slice = upsertRows.slice(i, i + upsertChunk);
      const { error: upErr } = await supabase.from("mlcc_items").upsert(slice, { onConflict: "code" });
      if (upErr) {
        console.log("[price-book-ingestor] upsert error:", upErr.message);
        await updateRun(supabase, runId, {
          status: "failed",
          error_message: upErr.message,
          completed_at: new Date().toISOString(),
        });
        return { ok: false, error: upErr.message, runId };
      }
    }

    const totalItems = items.length;
    console.log("[price-book-ingestor] upsert complete:", { totalItems, newCount, updatedCount });
    await updateRun(supabase, runId, {
      status: "complete",
      total_items: totalItems,
      new_items: newCount,
      updated_items: updatedCount,
      completed_at: new Date().toISOString(),
    });

    return {
      ok: true,
      runId,
      totalItems,
      newItems: newCount,
      updatedItems: updatedCount,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[price-book-ingestor] unexpected:", msg);
    if (runId) {
      await updateRun(supabase, runId, {
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      });
    }
    return { ok: false, error: msg, runId };
  }
}
