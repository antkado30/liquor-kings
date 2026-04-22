import { getAllMlccSearchVariants } from "../mlcc/mlcc-brand-aliases.js";
import { mlccCategoryMatchesAnyHint } from "../mlcc/mlcc-category-ontology.js";
import { extractCategoryHintsUpc } from "../mlcc/mlcc-upc-scoring.js";

/**
 * Parse bottle size in milliliters from a product name or description (mL / L patterns).
 * @param {string | null | undefined} text
 * @returns {number | null}
 */
export function extractBottleSizeMl(text) {
  const s = String(text ?? "");
  if (!s.trim()) return null;

  const mlMatch = s.match(/(\d+(?:\.\d+)?)\s*m\s*l\b/i);
  if (mlMatch) {
    const v = Number.parseFloat(mlMatch[1]);
    if (Number.isFinite(v)) return Math.round(v);
  }

  const lMatch = s.match(/(\d+(?:\.\d+)?)\s*l\b/i);
  if (lMatch) {
    const liters = Number.parseFloat(lMatch[1]);
    if (Number.isFinite(liters)) return Math.round(liters * 1000);
  }

  return null;
}

/** Same normalization as MLCC `name_normalized` / price-book search (alphanumeric + spaces). */
function normalizeForMatch(str) {
  return String(str ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip % and _ for safe use inside ILIKE patterns. */
function sanitizeIlikeValue(s) {
  return String(s).replace(/%/g, "").replace(/_/g, "");
}

/**
 * Parse and concatenate UPC size hints from offer titles.
 * @param {unknown} offers
 * @returns {string}
 */
function offersToSizeHintText(offers) {
  if (!Array.isArray(offers) || offers.length === 0) return "";
  const hints = [];
  for (const offer of offers) {
    const title = typeof offer?.title === "string" ? offer.title.trim() : "";
    if (!title) continue;
    if (/\b\d+(?:\.\d+)?\s*(?:m\s*l|ml|l|litre|liter|fl\.?\s*oz|oz)\b/i.test(title)) {
      hints.push(title);
    }
  }
  return hints.join(" | ");
}

/**
 * @param {unknown} images
 * @returns {string | null}
 */
function firstImageUrlFromUpcitemdb(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const first = images[0];
  if (typeof first === "string") {
    const u = first.trim();
    return u || null;
  }
  if (first && typeof first === "object") {
    const u = /** @type {{ url?: string }} */ (first).url;
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  return null;
}

/**
 * When `brand` is empty, take the first 1–3 tokens from `name` that appear before the bottle-size token.
 * @param {string} name
 * @returns {string} normalized token string (may be empty)
 */
function primaryBrandFromNameBeforeSize(name) {
  const s = String(name ?? "");
  const mlMatch = s.match(/(\d+(?:\.\d+)?)\s*m\s*l\b/i);
  const lMatch = mlMatch ? null : s.match(/(\d+(?:\.\d+)?)\s*l\b/i);
  const m = mlMatch || lMatch;
  const idx = m?.index != null ? m.index : s.length;
  const before = s.slice(0, idx).trim();
  const parts = normalizeForMatch(before)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return parts.join(" ");
}

/**
 * Sort: rows whose `name_normalized` starts with brand token first, then shorter display name.
 * @param {object[]} rows
 * @param {string} brandNorm
 */
function sortMlccPreciseCandidates(rows, brandNorm) {
  return [...rows].sort((a, b) => {
    const an = String(a.name_normalized ?? "");
    const bn = String(b.name_normalized ?? "");
    const aStart = brandNorm && an.startsWith(brandNorm);
    const bStart = brandNorm && bn.startsWith(brandNorm);
    if (aStart !== bStart) return aStart ? -1 : 1;
    const lenA = String(a.name ?? "").length;
    const lenB = String(b.name ?? "").length;
    if (lenA !== lenB) return lenA - lenB;
    return String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true });
  });
}

/**
 * Precise MLCC lookup: exact `bottle_size_ml` + `name_normalized` contains normalized brand (no trigram).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {{ name: string; brand: string; category?: string; images?: unknown }} upcItem
 * @param {{ candidateLimit?: number }} [options] default 5; use higher values for scoring pools.
 * @returns {Promise<{ confident: boolean; candidates: object[] }>}
 */
export async function findMlccCandidatesForUpc(supabase, upcItem, options = {}) {
  const candidateLimit = Number.isFinite(options.candidateLimit)
    ? Math.min(200, Math.max(1, Math.floor(options.candidateLimit)))
    : 5;
  try {
    const name = typeof upcItem?.name === "string" ? upcItem.name.trim() : "";
    if (!name) {
      console.log("[upcitemdb] findMlccCandidatesForUpc missing name");
      return { confident: false, candidates: [] };
    }

    const plausibleSizesFromUpc = Array.isArray(upcItem?.plausible_sizes)
      ? upcItem.plausible_sizes
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v))
      : [];
    const fallbackSize =
      extractBottleSizeMl(name) ??
      extractBottleSizeMl(typeof upcItem?.rawSize === "string" ? upcItem.rawSize : "") ??
      extractBottleSizeMl(typeof upcItem?.offersText === "string" ? upcItem.offersText : "");
    const plausibleSizes =
      plausibleSizesFromUpc.length > 0
        ? [...new Set(plausibleSizesFromUpc)]
        : Number.isFinite(Number(upcItem?.size_ml))
          ? [Number(upcItem.size_ml)]
          : fallbackSize != null
            ? [fallbackSize]
            : [];

    let brandNorm = normalizeForMatch(typeof upcItem.brand === "string" ? upcItem.brand : "");
    if (!brandNorm) {
      brandNorm = primaryBrandFromNameBeforeSize(name);
    }
    if (!brandNorm) {
      console.log("[upcitemdb] findMlccCandidatesForUpc no brand token after normalize");
      return { confident: false, candidates: [] };
    }

    const brandVariants = getAllMlccSearchVariants(upcItem?.brand ?? "");
    if (!brandVariants.length) {
      brandVariants.push(...getAllMlccSearchVariants(brandNorm));
    }
    if (!brandVariants.length) {
      const fallbackWord = name.split(/\s+/).filter(Boolean)[0];
      if (fallbackWord) brandVariants.push(fallbackWord.toUpperCase());
    }

    /** @type {Map<string, object>} */
    const dedupedByCode = new Map();
    /** @type {Array<{ variant: string; count: number }>} */
    const variantCounts = [];

    for (const variant of brandVariants) {
      const pattern = sanitizeIlikeValue(variant);
      if (!pattern) continue;
      const { data, error } = await supabase
        .from("mlcc_items")
        .select("*")
        .eq("is_active", true)
        .ilike("name", `%${pattern}%`)
        .limit(Math.max(candidateLimit, 20));
      if (error) {
        console.log("[upcitemdb] alias variant query error", error.message);
        return { confident: false, candidates: [] };
      }
      const rows = data ?? [];
      variantCounts.push({ variant, count: rows.length });
      for (const row of rows) {
        const code = String(row?.code ?? "").trim();
        if (!code || dedupedByCode.has(code)) continue;
        dedupedByCode.set(code, row);
      }
    }

    let merged = [...dedupedByCode.values()];
    if (plausibleSizes.length > 0) {
      merged = merged.filter((row) => {
        const rowSize = Number(row?.bottle_size_ml);
        if (!Number.isFinite(rowSize)) return false;
        return plausibleSizes.some((size) => rowSize === size || Math.abs(rowSize - size) <= 50);
      });
    }
    const categoryHints = extractCategoryHintsUpc(name);
    if (categoryHints.length > 0) {
      merged = merged.filter((row) => {
        return mlccCategoryMatchesAnyHint(row?.category, categoryHints);
      });
    }
    const minPool = Math.max(20, candidateLimit);
    const sorted = sortMlccPreciseCandidates(merged, brandNorm).slice(0, minPool);
    const confident = sorted.length === 1;
    if (process.env.DEBUG_UPC_FILTER === "1") {
      console.log(
        "[upcitemdb][DEBUG_UPC_FILTER]",
        JSON.stringify({
          phase: "alias_candidate_search",
          upcName: name,
          upcBrand: upcItem?.brand ?? null,
          plausibleSizes,
          categoryHints,
          brandVariants,
          variantCounts,
          dedupedCount: dedupedByCode.size,
          postFilterCount: merged.length,
          returnedCount: sorted.length,
        }),
      );
    }
    return { confident, candidates: sorted };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[upcitemdb] findMlccCandidatesForUpc exception", msg);
    return { confident: false, candidates: [] };
  }
}

/**
 * @deprecated Prefer `findMlccCandidatesForUpc` for UPC flows; this returns only the first candidate for backward compatibility.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} productName
 * @returns {Promise<object | null>}
 */
export async function findMlccProductByName(supabase, productName) {
  const upcItem = {
    name: String(productName ?? "").trim(),
    brand: "",
    category: "",
    images: [],
  };
  const { candidates } = await findMlccCandidatesForUpc(supabase, upcItem);
  return candidates[0] ?? null;
}

/**
 * UPCitemdb product lookup (free trial or paid v1 API).
 * On success, `raw` holds the API JSON for persistence in `upc_lookups.raw_api_response`.
 * @param {string} upc
 * @returns {Promise<
 *   | {
 *       ok: true;
 *       product: {
 *         name: string;
 *         brand: string;
 *         category: string;
 *         rawSize: string;
 *         offersText: string;
 *         images: unknown;
 *         imageUrl: string | null;
 *       };
 *       raw: object;
 *     }
 *   | { ok: false; error: "not_found" | "rate_limited" | "network_error" }
 * >}
 */
export async function lookupUpcFromUpcitemdb(upc) {
  const code = String(upc ?? "").trim();
  if (!code) {
    console.log("[upcitemdb] empty upc");
    return { ok: false, error: "not_found" };
  }

  const apiKey = process.env.UPCITEMDB_API_KEY?.trim();
  const url = apiKey
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(code)}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`;

  const headers = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let res;
  try {
    const ctrl = AbortSignal.timeout(5000);
    res = await fetch(url, { method: "GET", headers, signal: ctrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[upcitemdb] network error", msg);
    return { ok: false, error: "network_error" };
  }

  if (res.status === 429) {
    console.log("[upcitemdb] rate limited");
    return { ok: false, error: "rate_limited" };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    console.log("[upcitemdb] invalid json response", res.status);
    return { ok: false, error: "network_error" };
  }

  if (!res.ok) {
    console.log("[upcitemdb] http error", res.status, body?.code ?? "");
    return { ok: false, error: res.status === 429 ? "rate_limited" : "not_found" };
  }

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    console.log("[upcitemdb] no items", body?.code ?? "", "total", body?.total);
    return { ok: false, error: "not_found" };
  }

  const item = items[0];
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const brand = typeof item.brand === "string" ? item.brand.trim() : "";
  const category = typeof item.category === "string" ? item.category.trim() : "";
  const rawSize = typeof item.size === "string" ? item.size.trim() : "";
  const desc = typeof item.description === "string" ? item.description.trim() : "";
  const name =
    `${brand} ${title}`.trim() || title || desc || brand;
  if (!name) {
    console.log("[upcitemdb] item missing name fields");
    return { ok: false, error: "not_found" };
  }

  const images = item.images ?? [];
  const offersText = offersToSizeHintText(item.offers);
  const imageUrl = firstImageUrlFromUpcitemdb(images);
  console.log("[upcitemdb] hit", code, name.slice(0, 80));
  return {
    ok: true,
    product: { name, brand, category, rawSize, offersText, images, imageUrl },
    /** Full API JSON for `upc_lookups.raw_api_response` (not part of the public contract). */
    raw: body,
  };
}
