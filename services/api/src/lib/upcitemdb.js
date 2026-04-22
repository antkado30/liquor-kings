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

    const extractedSize = extractBottleSizeMl(name);
    if (extractedSize == null) {
      console.log("[upcitemdb] findMlccCandidatesForUpc no size in name, skipping precise query");
      return { confident: false, candidates: [] };
    }
    console.log(`[upcitemdb] extracted size: ${extractedSize}ml from "${name}"`);

    let brandNorm = normalizeForMatch(typeof upcItem.brand === "string" ? upcItem.brand : "");
    if (!brandNorm) {
      brandNorm = primaryBrandFromNameBeforeSize(name);
    }
    if (!brandNorm) {
      console.log("[upcitemdb] findMlccCandidatesForUpc no brand token after normalize");
      return { confident: false, candidates: [] };
    }

    const brandPattern = sanitizeIlikeValue(brandNorm);
    if (!brandPattern) {
      console.log("[upcitemdb] findMlccCandidatesForUpc empty brand pattern");
      return { confident: false, candidates: [] };
    }

    let q = supabase
      .from("mlcc_items")
      .select("*")
      .eq("is_active", true)
      .eq("bottle_size_ml", extractedSize)
      .ilike("name_normalized", `%${brandPattern}%`)
      .limit(50);

    const { data, error } = await q;
    if (error) {
      console.log("[upcitemdb] precise mlcc query error", error.message);
      return { confident: false, candidates: [] };
    }

    const sorted = sortMlccPreciseCandidates(data ?? [], brandNorm).slice(0, candidateLimit);
    const confident = sorted.length === 1;
    console.log(
      `[upcitemdb] precise candidates: count=${sorted.length} confident=${confident} brand="${brandNorm}" size=${extractedSize}ml`,
    );
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
  const desc = typeof item.description === "string" ? item.description.trim() : "";
  const name =
    `${brand} ${title}`.trim() || title || desc || brand;
  if (!name) {
    console.log("[upcitemdb] item missing name fields");
    return { ok: false, error: "not_found" };
  }

  const images = item.images ?? [];
  const imageUrl = firstImageUrlFromUpcitemdb(images);
  console.log("[upcitemdb] hit", code, name.slice(0, 80));
  return {
    ok: true,
    product: { name, brand, category, images, imageUrl },
    /** Full API JSON for `upc_lookups.raw_api_response` (not part of the public contract). */
    raw: body,
  };
}
