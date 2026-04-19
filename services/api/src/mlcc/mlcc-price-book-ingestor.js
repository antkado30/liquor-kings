import { parseMlccPriceBookExcel, deriveAdaName } from "./mlcc-price-book-parser.js";

const MLCC_PRICE_BOOK_INFO_URL =
  "https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info";

const DISCOVER_TIMEOUT_MS = 15_000;
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
 * @param {string | null | undefined} ada
 * @returns {string | null}
 */
function normalizeAdaNumber(ada) {
  const t = String(ada ?? "").trim();
  return t === "" ? null : t;
}

/**
 * @param {string} code
 * @param {string | null | undefined} ada
 */
function mlccItemCompositeKey(code, ada) {
  const a = normalizeAdaNumber(ada);
  return `${code}\0${a ?? ""}`;
}

const UPSERT_BATCH_SIZE = 100;
const UPSERT_RETRY_DELAY_MS = 2000;
const UPSERT_PROGRESS_INTERVAL = 500;

/**
 * @param {string} message
 */
function isLikelyNetworkError(message) {
  const m = String(message ?? "").toLowerCase();
  if (!m) return false;
  return (
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("epipe") ||
    m.includes("socket") ||
    m.includes("network") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("aborted") ||
    m.includes("eai_again") ||
    m.includes("und_err") ||
    m.includes("connect")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode minimal HTML entities in hrefs and text.
 * @param {string} s
 */
function decodeBasicEntities(s) {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} href raw href including optional ?rev= / &hash= query (entities decoded)
 * @returns {string}
 */
function absolutizeMlccHref(href) {
  const raw = decodeBasicEntities(href).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `https://www.michigan.gov${raw}`;
  return `https://www.michigan.gov/${raw.replace(/^\//, "")}`;
}

/**
 * Strip tags for anchor visible text.
 * @param {string} innerHtml
 */
function anchorVisibleText(innerHtml) {
  return decodeBasicEntities(innerHtml.replace(/<[^>]+>/g, " "));
}

/**
 * Full spirits price book Excel (not new-item list, ADA changes, retail changes, MI manufacturer list).
 * @param {string} hrefPathLower path + filename before query, lowercased
 */
function isFullPriceBookXlsxHref(hrefPathLower) {
  if (!hrefPathLower.endsWith(".xlsx")) return false;
  if (!hrefPathLower.includes("price-book")) return false;
  if (
    /new-item|ada-changes|retail-price-changes|products-from-mi|mi-manufacturer/i.test(
      hrefPathLower,
    )
  ) {
    return false;
  }
  return /-price-book-excel\.xlsx$/i.test(hrefPathLower);
}

/**
 * Prefer link labels like the main LCC "Price Book (Excel)" line item.
 * @param {string} label
 */
function isPreferredPriceBookLabel(label) {
  const L = label.toLowerCase();
  if (!L.includes("price book (excel)")) return false;
  if (L.includes("new item")) return false;
  if (L.includes("ada changes")) return false;
  if (L.includes("retail price changes")) return false;
  return true;
}

/**
 * Discover the latest full MLCC spirits price book .xlsx URL from the public info page.
 * @returns {Promise<{ ok: true, url: string, label: string } | { ok: false, error: string }>}
 */
export async function discoverLatestPriceBookUrl() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(MLCC_PRICE_BOOK_INFO_URL, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LiquorKingsPriceBook/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} fetching price book info page` };
    }
    const html = await res.text();
    if (!html || typeof html !== "string") {
      return { ok: false, error: "Empty price book info page response" };
    }

    const anchorRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    /** @type {{ hrefRaw: string, hrefPathLower: string, label: string }[]} */
    const fullBookCandidates = [];
    let m;
    while ((m = anchorRe.exec(html)) !== null) {
      const hrefRaw = m[1];
      const hrefPathLower = decodeBasicEntities(hrefRaw).split("?")[0].trim().toLowerCase();
      if (!hrefPathLower.endsWith(".xlsx")) continue;
      if (!isFullPriceBookXlsxHref(hrefPathLower)) continue;
      const label = anchorVisibleText(m[2]);
      fullBookCandidates.push({ hrefRaw, hrefPathLower, label });
    }

    if (!fullBookCandidates.length) {
      return { ok: false, error: "No full price book Excel link found on the info page" };
    }

    const preferred = fullBookCandidates.filter((c) => isPreferredPriceBookLabel(c.label));
    const ordered = preferred.length ? preferred : fullBookCandidates;
    const chosen = ordered[0];
    const url = absolutizeMlccHref(chosen.hrefRaw);
    if (!url) {
      return { ok: false, error: "Could not resolve absolute URL for price book Excel" };
    }
    return { ok: true, url, label: chosen.label || url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Price book URL discovery failed" };
  }
}

/**
 * @param {string | undefined} urlOverride
 * @returns {Promise<{ ok: true, buffer: Buffer, url: string } | { ok: false, error: string, url?: string }>}
 */
export async function fetchLatestMlccPriceBookExcel(urlOverride) {
  const trimmed = urlOverride && String(urlOverride).trim();
  let url = trimmed || "";
  if (!url) {
    const disc = await discoverLatestPriceBookUrl();
    if (!disc.ok) {
      return { ok: false, error: disc.error };
    }
    url = disc.url;
    console.log("[price-book-ingestor] discovered price book URL:", url);
  }
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
      return { ok: false, error: `HTTP ${res.status} downloading price book`, url };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      return { ok: false, error: "Downloaded file is empty", url };
    }
    return { ok: true, buffer: buf, url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || "Download failed", url };
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
        source_url: dl.url ?? opts.url ?? null,
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
    const existingByCodeAda = new Map();
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
        existingByCodeAda.set(mlccItemCompositeKey(row.code, row.ada_number), row);
      }
    }

    const itemByCompositeKey = new Map();
    for (const item of items) {
      const ada = normalizeAdaNumber(item.adaNumber);
      const key = mlccItemCompositeKey(item.mlccCode, ada);
      itemByCompositeKey.set(key, item);
    }

    let newCount = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    /** @type {Map<string, object>} */
    const upsertByKey = new Map();

    for (const item of itemByCompositeKey.values()) {
      const code = item.mlccCode;
      const adaNumber = normalizeAdaNumber(item.adaNumber);
      const rowKey = mlccItemCompositeKey(code, adaNumber);
      const existing = existingByCodeAda.get(rowKey);
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

      const mlccItemNo =
        existing?.mlcc_item_no ?? (adaNumber != null ? `${code}-${adaNumber}` : code);

      upsertByKey.set(rowKey, {
        code,
        ada_number: adaNumber,
        name: item.brandName || code,
        mlcc_item_no: mlccItemNo,
        size_ml: item.bottleSizeMl ?? existing?.size_ml ?? null,
        category: item.category ?? existing?.category ?? null,
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
        ada_name: deriveAdaName(item.adaNumber),
        brand_family: existing?.brand_family ?? null,
        is_active: existing?.is_active ?? true,
        last_price_book_date: effectiveDateStr,
        price_changed_at: priceChangedAt,
        is_new_item: item.isNewItem,
        updated_at: nowIso,
      });
    }

    const upsertRows = [...upsertByKey.values()];
    const totalUpsertPlan = upsertRows.length;
    let rowsUpserted = 0;
    let chunkUpsertErrors = 0;

    for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH_SIZE) {
      const slice = upsertRows.slice(i, i + UPSERT_BATCH_SIZE);
      const dedupedSlice = [...new Map(slice.map((row) => [mlccItemCompositeKey(row.code, row.ada_number), row])).values()];

      async function attemptUpsert() {
        return supabase.from("mlcc_items").upsert(dedupedSlice, { onConflict: "code,ada_number" });
      }

      let { error: upErr } = await attemptUpsert();
      if (upErr && isLikelyNetworkError(upErr.message)) {
        console.log(
          "[price-book-ingestor] upsert network error, retrying after delay:",
          upErr.message,
        );
        await sleep(UPSERT_RETRY_DELAY_MS);
        const second = await attemptUpsert();
        upErr = second.error;
      }

      if (upErr) {
        chunkUpsertErrors += 1;
        console.log("[price-book-ingestor] upsert chunk failed (continuing):", upErr.message);
        continue;
      }

      const prevRows = rowsUpserted;
      rowsUpserted += dedupedSlice.length;
      let m = Math.ceil((prevRows + 1) / UPSERT_PROGRESS_INTERVAL) * UPSERT_PROGRESS_INTERVAL;
      while (m <= rowsUpserted && m <= totalUpsertPlan) {
        console.log(`[price-book-ingestor] progress: ${m} / ${totalUpsertPlan} rows upserted`);
        m += UPSERT_PROGRESS_INTERVAL;
      }
    }

    if (rowsUpserted > 0 && rowsUpserted % UPSERT_PROGRESS_INTERVAL !== 0) {
      console.log(`[price-book-ingestor] progress: ${rowsUpserted} / ${totalUpsertPlan} rows upserted`);
    }

    const totalItems = upsertRows.length;
    console.log("[price-book-ingestor] upsert complete:", {
      totalItems,
      newCount,
      updatedCount,
      rowsUpserted,
      chunkUpsertErrors,
    });
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
      rowsUpserted,
      chunkUpsertErrors,
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
