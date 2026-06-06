/**
 * Browse — Amazon-style catalog browsing (task #64, 2026-06-03).
 *
 * Tony's spec: "main browsing page where you scroll through all the
 * bottles ... sort by features ... filter by tequila, whiskey, by
 * proof, by size ... use all of the information that we have all the
 * data we have to the max."
 *
 * GET /catalog/browse?... — filterable, sortable, cursor-paginated.
 * GET /catalog/browse/facets — returns the available filter VALUES
 * (distinct categories, ADAs, sizes) for rendering filter chips.
 *
 * Backed by public.mlcc_items. All filters are AND-combined. Sort
 * defaults to name ASC because alphabetical is the safe browse
 * default; user can flip to price asc/desc or newest with a tap.
 */

import express from "express";
import supabaseDefault from "../config/supabase.js";

const router = express.Router();

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

/**
 * GET /catalog/browse — paginated, filtered, sortable.
 *
 * Filters (all optional):
 *   category:        string (e.g. "Vodka") — exact match on mlcc_items.category
 *   ada_number:      string (e.g. "321")
 *   bottle_size_ml:  integer (e.g. 750)
 *   min_price:       number — licensee_price >= min_price
 *   max_price:       number — licensee_price <= max_price
 *   min_proof:       number — proof >= min_proof
 *   max_proof:       number — proof <= max_proof
 *   new_only:        "1"/"true" — only is_new_item
 *   q:               substring search on name (also use the /price-book endpoints for richer search)
 *
 * Sort:
 *   sort:            "name" | "price_asc" | "price_desc" | "newest" | "proof_asc" | "proof_desc"
 *
 * Pagination:
 *   limit:           1..MAX_LIMIT, default DEFAULT_LIMIT
 *   cursor:          opaque string from previous response's nextCursor
 *
 * Response:
 *   { ok, products: MlccProduct[], nextCursor: string | null, total: number | null }
 */
router.get("/browse", async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const supabase = supabaseDefault;

  // Parse + clamp inputs defensively.
  const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_LIMIT, rawLimit)
      : DEFAULT_LIMIT;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

  const category =
    typeof req.query.category === "string" && req.query.category.trim()
      ? req.query.category.trim()
      : null;
  const adaNumber =
    typeof req.query.ada_number === "string" && req.query.ada_number.trim()
      ? req.query.ada_number.trim()
      : null;
  const sizeMl = Number.parseInt(String(req.query.bottle_size_ml ?? ""), 10);
  const filterSize = Number.isFinite(sizeMl) && sizeMl > 0 ? sizeMl : null;
  const minPrice = Number.parseFloat(String(req.query.min_price ?? ""));
  const maxPrice = Number.parseFloat(String(req.query.max_price ?? ""));
  const minProof = Number.parseFloat(String(req.query.min_proof ?? ""));
  const maxProof = Number.parseFloat(String(req.query.max_proof ?? ""));
  const newOnly = req.query.new_only === "1" || req.query.new_only === "true";
  const q =
    typeof req.query.q === "string" && req.query.q.trim().length >= 2
      ? req.query.q.trim()
      : null;
  const sort = String(req.query.sort ?? "name");

  /*
    Build the query. Always include is_active=true so we don't return
    discontinued SKUs (task #44 handles per-product freshness; this is
    a broader catalog hygiene filter).
  */
  let select = supabase
    .from("mlcc_items")
    .select("*", { count: "exact" })
    .eq("is_active", true);

  if (category) select = select.eq("category", category);
  if (adaNumber) select = select.eq("ada_number", adaNumber);
  if (filterSize != null) select = select.eq("bottle_size_ml", filterSize);
  if (Number.isFinite(minPrice)) select = select.gte("licensee_price", minPrice);
  if (Number.isFinite(maxPrice)) select = select.lte("licensee_price", maxPrice);
  if (Number.isFinite(minProof)) select = select.gte("proof", minProof);
  if (Number.isFinite(maxProof)) select = select.lte("proof", maxProof);
  if (newOnly) select = select.eq("is_new_item", true);
  if (q) select = select.ilike("name", `%${q}%`);

  /*
    Sort + cursor. We use a single-column ORDER BY for simplicity; the
    cursor encodes the last row's sort key + id. ORDER BY ... NULLS
    LAST means rows with NULL on the sort key float to the end and
    don't break the cursor predicate.
  */
  let sortColumn;
  let ascending;
  switch (sort) {
    case "price_asc":
      sortColumn = "licensee_price";
      ascending = true;
      break;
    case "price_desc":
      sortColumn = "licensee_price";
      ascending = false;
      break;
    case "newest":
      sortColumn = "last_price_book_date";
      ascending = false;
      break;
    case "proof_asc":
      sortColumn = "proof";
      ascending = true;
      break;
    case "proof_desc":
      sortColumn = "proof";
      ascending = false;
      break;
    case "name":
    default:
      sortColumn = "name";
      ascending = true;
      break;
  }
  select = select.order(sortColumn, {
    ascending,
    nullsFirst: false,
  });
  // Secondary by id keeps results deterministic for cursor paging when
  // sort-column values repeat.
  select = select.order("id", { ascending: true });

  // Cursor encoding: base64(JSON({sortVal, id})). Decode on input and
  // apply as a row-position filter.
  if (cursor) {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, "base64").toString("utf-8"),
      );
      const sortVal = decoded?.sortVal;
      const lastId = String(decoded?.id ?? "");
      if (sortVal !== undefined && lastId) {
        if (ascending) {
          select = select.or(
            `${sortColumn}.gt.${sortVal},and(${sortColumn}.eq.${sortVal},id.gt.${lastId})`,
          );
        } else {
          select = select.or(
            `${sortColumn}.lt.${sortVal},and(${sortColumn}.eq.${sortVal},id.gt.${lastId})`,
          );
        }
      }
    } catch {
      // Bad cursor — ignore and serve from the start.
    }
  }

  select = select.limit(limit + 1);

  const { data, error, count } = await select;
  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
  const rows = Array.isArray(data) ? data : [];
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  /*
    Alias snake_case → camelCase for fields the scanner client expects in
    that shape. mlcc_items stores image_url (added in 20260603020000),
    but the MlccProduct TS type uses `imageUrl`. We spread the original
    row so all other fields stay snake_case (matches the type's mixed
    convention) and add the camelCase image alias on top.
  */
  const products = sliced.map((row) => ({
    ...row,
    imageUrl: row.image_url ?? null,
  }));

  let nextCursor = null;
  if (hasMore && products.length > 0) {
    const last = products[products.length - 1];
    const sortVal = last[sortColumn];
    nextCursor = Buffer.from(
      JSON.stringify({ sortVal, id: last.id }),
    ).toString("base64");
  }

  return res.json({
    ok: true,
    products,
    nextCursor,
    total: typeof count === "number" ? count : null,
  });
});

/**
 * GET /catalog/browse/facets — returns the distinct values of each
 * filter dimension so the UI can render filter chips/dropdowns.
 *
 * Cached server-side would be ideal (these change rarely — only on
 * price-book ingest), but for V1 we just query each time. The
 * underlying tables are indexed and each query returns < 100 rows.
 */
router.get("/browse/facets", async (req, res) => {
  const storeId = req.store_id;
  if (!storeId) {
    return res
      .status(403)
      .json({ ok: false, error: "Store context not resolved" });
  }
  const supabase = supabaseDefault;

  // Each facet runs independently — one slow query doesn't block the
  // others. Empty results are fine ([] in the response).
  const [cats, adas, sizes, priceRange, proofRange] = await Promise.all([
    facetCategories(supabase),
    facetAdas(supabase),
    facetSizes(supabase),
    facetPriceRange(supabase),
    facetProofRange(supabase),
  ]);

  return res.json({
    ok: true,
    facets: {
      categories: cats,
      adas: adas,
      sizes: sizes,
      priceRange,
      proofRange,
    },
  });
});

async function facetCategories(supabase) {
  try {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("category")
      .eq("is_active", true)
      .not("category", "is", null);
    if (error || !Array.isArray(data)) return [];
    const counts = new Map();
    for (const row of data) {
      const c = String(row.category ?? "").trim();
      if (!c) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function facetAdas(supabase) {
  try {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("ada_number, ada_name")
      .eq("is_active", true)
      .not("ada_number", "is", null);
    if (error || !Array.isArray(data)) return [];
    const counts = new Map();
    for (const row of data) {
      const number = String(row.ada_number ?? "").trim();
      if (!number) continue;
      const name = String(row.ada_name ?? "").trim() || `ADA ${number}`;
      const key = number;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { number, name, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function facetSizes(supabase) {
  try {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("bottle_size_ml, bottle_size_label")
      .eq("is_active", true)
      .not("bottle_size_ml", "is", null);
    if (error || !Array.isArray(data)) return [];
    const counts = new Map();
    for (const row of data) {
      const ml = Number(row.bottle_size_ml);
      if (!Number.isFinite(ml) || ml <= 0) continue;
      const label =
        String(row.bottle_size_label ?? "").trim() || `${ml} ML`;
      const existing = counts.get(ml);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(ml, { ml, label, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => a.ml - b.ml);
  } catch {
    return [];
  }
}

async function facetPriceRange(supabase) {
  try {
    const { data: lo } = await supabase
      .from("mlcc_items")
      .select("licensee_price")
      .eq("is_active", true)
      .not("licensee_price", "is", null)
      .order("licensee_price", { ascending: true })
      .limit(1);
    const { data: hi } = await supabase
      .from("mlcc_items")
      .select("licensee_price")
      .eq("is_active", true)
      .not("licensee_price", "is", null)
      .order("licensee_price", { ascending: false })
      .limit(1);
    const min = lo?.[0]?.licensee_price ?? 0;
    const max = hi?.[0]?.licensee_price ?? 0;
    return {
      min: Math.floor(Number(min)),
      max: Math.ceil(Number(max)),
    };
  } catch {
    return { min: 0, max: 0 };
  }
}

async function facetProofRange(supabase) {
  try {
    const { data: lo } = await supabase
      .from("mlcc_items")
      .select("proof")
      .eq("is_active", true)
      .not("proof", "is", null)
      .order("proof", { ascending: true })
      .limit(1);
    const { data: hi } = await supabase
      .from("mlcc_items")
      .select("proof")
      .eq("is_active", true)
      .not("proof", "is", null)
      .order("proof", { ascending: false })
      .limit(1);
    const min = lo?.[0]?.proof ?? 0;
    const max = hi?.[0]?.proof ?? 0;
    return {
      min: Math.floor(Number(min)),
      max: Math.ceil(Number(max)),
    };
  } catch {
    return { min: 0, max: 0 };
  }
}

export default router;
