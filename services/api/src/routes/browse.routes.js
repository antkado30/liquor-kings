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
  // No count:"exact" — it forced a full COUNT scan over the filtered
  // (often ilike) result set on EVERY page fetch, and the client doesn't
  // use `total` anymore. Dropping it is the single biggest browse speedup.
  //
  // Select only the columns the catalog card + cursor + filters need —
  // NOT select("*"). mlcc_items has ~20 columns (base_price, state_min_price,
  // case_size, name_normalized, scan_count, price_changed_at, upc, …) that
  // the browse grid never renders. Trimming the row shrinks the payload that
  // crosses the Fly-ORD ↔ Supabase-us-east-1 hop, which is where the real
  // browse latency lives (the table itself is only ~14k rows — too small for
  // indexes to matter). Includes every sort column so the cursor keeps working.
  const BROWSE_COLUMNS =
    "id, code, name, category, ada_number, ada_name, " +
    "bottle_size_ml, bottle_size_label, licensee_price, proof, " +
    "is_new_item, last_price_book_date, image_url, image_thumb_url, featured_sort";
  let select = supabase
    .from("mlcc_items")
    .select(BROWSE_COLUMNS)
    .eq("is_active", true);

  if (category) select = select.eq("category", category);
  if (adaNumber) select = select.eq("ada_number", adaNumber);
  if (filterSize != null) select = select.eq("bottle_size_ml", filterSize);
  if (Number.isFinite(minPrice)) select = select.gte("licensee_price", minPrice);
  if (Number.isFinite(maxPrice)) select = select.lte("licensee_price", maxPrice);
  if (Number.isFinite(minProof)) select = select.gte("proof", minProof);
  if (Number.isFinite(maxProof)) select = select.lte("proof", maxProof);
  if (newOnly) select = select.eq("is_new_item", true);
  /*
    Search matches BOTH raw name AND name_searchable (the generated
    space/punctuation-free column from 20260609230000). Fixes the
    2026-06-10 Tito's bug: iOS smart-punctuation sends a curly
    apostrophe ("Tito’s") that never matches the catalog's straight
    apostrophe ("TITO'S"), and "Titos" matched nothing at all. The
    stripped term against name_searchable catches both, plus the
    RumChata-style spacing cases. The raw-name ilike stays so
    multi-word queries with spaces ("crown royal") keep matching
    name's word boundaries when the stripped form is too greedy.
    PostgREST .or() syntax: commas separate clauses, so strip
    commas/parens out of the user term to avoid filter injection.
  */
  if (q) {
    const safeQ = q.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
    const stripped = safeQ.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (stripped.length >= 2) {
      select = select.or(
        `name.ilike.%${safeQ}%,name_searchable.ilike.%${stripped}%`,
      );
    } else if (safeQ.length >= 2) {
      select = select.ilike("name", `%${safeQ}%`);
    }
  }

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
      /*
        "Featured" (the default sort): photographed bottles first, A-Z
        within each group, placeholders sink to the bottom (Tony,
        2026-06-10 — "push bottles with photos to the top until we have
        all the pictures figured out"). featured_sort is a generated
        column ('0~'+name with photo / '1~'+name without, migration
        20260610233000) so it works with the single-column cursor and
        reorders itself as photo coverage grows.
      */
      sortColumn = "featured_sort";
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
        /*
          Quote the sort value for PostgREST .or() syntax (2026-06-10).
          Text sort values are product names — commas and parens in a
          name ("DARK ARTS WHISKEY HOUSE, OLOROSO…") broke the filter
          grammar and silently restarted pagination from page one.
          Double-quoting makes any value a single literal; embedded
          quotes/backslashes are stripped (never legitimately in names).
        */
        const qv = `"${String(sortVal).replace(/["\\]/g, "")}"`;
        if (ascending) {
          select = select.or(
            `${sortColumn}.gt.${qv},and(${sortColumn}.eq.${qv},id.gt.${lastId})`,
          );
        } else {
          select = select.or(
            `${sortColumn}.lt.${qv},and(${sortColumn}.eq.${qv},id.gt.${lastId})`,
          );
        }
      }
    } catch {
      // Bad cursor — ignore and serve from the start.
    }
  }

  select = select.limit(limit + 1);

  const { data, error } = await select;
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
    // Grid-sized WebP (~360px). NULL until the thumb backfill touches the
    // code — clients fall back to imageUrl, so deploy order is safe.
    imageThumbUrl: row.image_thumb_url ?? null,
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
    // total intentionally null — the client paginates by cursor and never
    // displayed a total, so we skip the expensive exact-count scan.
    total: null,
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

  /*
    Fast path (2026-06-10): one browse_facets() RPC — Postgres GROUP BYs
    return the entire facet payload as a single jsonb blob instead of
    shipping ~13.8k rows three times for JS counting (migration
    20260610234500). Falls back to the original per-facet JS path when
    the function doesn't exist yet, so deploy order doesn't matter.
  */
  try {
    const { data: blob, error: rpcErr } = await supabase.rpc("browse_facets");
    if (!rpcErr && blob && typeof blob === "object") {
      return res.json({
        ok: true,
        facets: {
          categories: Array.isArray(blob.categories) ? blob.categories : [],
          adas: Array.isArray(blob.adas) ? blob.adas : [],
          sizes: Array.isArray(blob.sizes) ? blob.sizes : [],
          priceRange:
            blob.priceRange && typeof blob.priceRange === "object"
              ? blob.priceRange
              : { min: 0, max: 0 },
          proofRange:
            blob.proofRange && typeof blob.proofRange === "object"
              ? blob.proofRange
              : { min: 0, max: 0 },
        },
      });
    }
    if (rpcErr) {
      console.log("[browse-facets] rpc unavailable, JS fallback:", rpcErr.message);
    }
  } catch (e) {
    console.log("[browse-facets] rpc threw, JS fallback:", e?.message ?? e);
  }

  // Fallback: each facet runs independently — one slow query doesn't
  // block the others. Empty results are fine ([] in the response).
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
    // lo + hi are independent — run them concurrently, not back to back.
    const [{ data: lo }, { data: hi }] = await Promise.all([
      supabase
        .from("mlcc_items")
        .select("licensee_price")
        .eq("is_active", true)
        .not("licensee_price", "is", null)
        .order("licensee_price", { ascending: true })
        .limit(1),
      supabase
        .from("mlcc_items")
        .select("licensee_price")
        .eq("is_active", true)
        .not("licensee_price", "is", null)
        .order("licensee_price", { ascending: false })
        .limit(1),
    ]);
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
    // lo + hi are independent — run them concurrently, not back to back.
    const [{ data: lo }, { data: hi }] = await Promise.all([
      supabase
        .from("mlcc_items")
        .select("proof")
        .eq("is_active", true)
        .not("proof", "is", null)
        .order("proof", { ascending: true })
        .limit(1),
      supabase
        .from("mlcc_items")
        .select("proof")
        .eq("is_active", true)
        .not("proof", "is", null)
        .order("proof", { ascending: false })
        .limit(1),
    ]);
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
