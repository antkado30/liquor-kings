import express from "express";
import supabase from "../config/supabase.js";
import { findMlccCandidatesForUpc, lookupUpcFromUpcitemdb } from "../lib/upcitemdb.js";
import { BRAND_ALIAS_MAP, resolveSearchAliases } from "../mlcc/mlcc-brand-aliases.js";
import { getLatestPriceBookRun, ingestMlccPriceBook } from "../mlcc/mlcc-price-book-ingestor.js";

const router = express.Router();

function requireServiceRole(req, res) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: "Server misconfiguration" });
    return false;
  }
  const auth = req.headers.authorization?.trim();
  const expected = `Bearer ${key}`;
  if (auth !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

router.get("/status", async (req, res) => {
  try {
    const latestRun = await getLatestPriceBookRun(supabase);
    res.json({ ok: true, latestRun });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/ingest", async (req, res) => {
  if (!requireServiceRole(req, res)) return;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const url = typeof body.url === "string" ? body.url : undefined;
    const dryRun = Boolean(body.dryRun);
    const result = await ingestMlccPriceBook(supabase, { url, dryRun });
    if (!result.ok) {
      return res.json({ ok: false, error: result.error || "Ingest failed" });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

function applyMlccItemsFilters(q, adaNumber, isNewItemQ) {
  let query = q;
  if (adaNumber) {
    query = query.eq("ada_number", adaNumber);
  }
  if (isNewItemQ === "true") {
    query = query.eq("is_new_item", true);
  } else if (isNewItemQ === "false") {
    query = query.eq("is_new_item", false);
  }
  return query;
}

/** Same semantics as `applyMlccItemsFilters` for in-memory rows (e.g. RPC results). */
function filterMlccRowsClientSide(rows, adaNumber, isNewItemQ) {
  return (rows ?? []).filter((row) => {
    if (adaNumber && String(row.ada_number ?? "").trim() !== adaNumber) return false;
    if (isNewItemQ === "true" && row.is_new_item !== true) return false;
    if (isNewItemQ === "false" && row.is_new_item !== false) return false;
    return true;
  });
}

/** Applies the legacy name / name_normalized / code OR filter for non-brand-key text search. */
function applyItemsOrSearchToQuery(q, search) {
  const original = escapeIlikeOrToken(search);
  const normalizedRaw = normalizeSearchTerm(search);
  const normalized = escapeIlikeOrToken(normalizedRaw);
  const aliasTerms = resolveSearchAliases(normalizedRaw);
  const aliasOrParts = aliasTerms.map(
    (t) => `name_normalized.ilike.%${escapeIlikeOrToken(t)}%`,
  );
  const aliasOrSuffix = aliasOrParts.length ? `,${aliasOrParts.join(",")}` : "";

  if (normalized && normalized !== original) {
    return q.or(
      `name.ilike.%${original}%,name.ilike.%${normalized}%,name_normalized.ilike.%${normalized}%,code.ilike.%${original}%${aliasOrSuffix}`,
    );
  }
  if (normalized) {
    return q.or(
      `name.ilike.%${original}%,name_normalized.ilike.%${normalized}%,code.ilike.%${original}%${aliasOrSuffix}`,
    );
  }
  return q.or(`name.ilike.%${original}%,code.ilike.%${original}%${aliasOrSuffix}`);
}

/** Escape %, _, \\ for ilike patterns; strip commas so .or() filter stays valid. */
function escapeIlikeOrToken(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "");
}

/**
 * Lowercase, strip punctuation (non-alphanumeric except spaces), collapse spaces, trim.
 * Matches DB name_normalized semantics for fuzzy search.
 */
function normalizeSearchTerm(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip % and _ from external strings used inside ilike patterns (defense in depth). */
function sanitizeIlikeValue(s) {
  return String(s).replace(/%/g, "").replace(/_/g, "");
}

/** Longest `BRAND_ALIAS_MAP` key contained in `normalizedRaw` (substring match). */
function findLongestContainedBrandKey(normalizedRaw) {
  const term = String(normalizedRaw ?? "").trim();
  if (!term) return null;
  let best = null;
  let bestLen = -1;
  for (const key of BRAND_ALIAS_MAP.keys()) {
    if (!key || term.length < key.length) continue;
    if (!term.includes(key)) continue;
    if (key.length > bestLen) {
      bestLen = key.length;
      best = key;
    }
  }
  return best;
}

function removeFirstSubstring(haystack, needle) {
  const h = String(haystack ?? "");
  const n = String(needle ?? "");
  if (!n) return h.trim();
  const i = h.indexOf(n);
  if (i < 0) return h.replace(/\s+/g, " ").trim();
  return (h.slice(0, i) + h.slice(i + n.length)).replace(/\s+/g, " ").trim();
}

const MULTI_TERM_BRAND_FETCH_CAP = 500;

/**
 * One query per MLCC-style brand variant; each row must match brand phrase and every suffix word on name_normalized.
 * @returns {Promise<{ rows: object[], error: Error | null }>}
 */
async function multiTermBrandSearch({
  supabase,
  brandKey,
  normalizedRaw,
  adaNumber,
  isNewItemQ,
}) {
  const suffixRaw = removeFirstSubstring(normalizedRaw, brandKey);
  const suffixWords = suffixRaw
    ? suffixRaw
        .split(/\s+/)
        .map((w) => sanitizeIlikeValue(w))
        .filter(Boolean)
    : [];

  const variants = BRAND_ALIAS_MAP.get(brandKey) ?? [];
  const brandCandidates = [];
  const seenBrand = new Set();
  for (const b of [brandKey, ...variants]) {
    const t = sanitizeIlikeValue(b);
    if (!t || seenBrand.has(t)) continue;
    seenBrand.add(t);
    brandCandidates.push(t);
  }

  const rowsById = new Map();

  for (const brandPart of brandCandidates) {
    let q = supabase.from("mlcc_items").select("*");
    q = applyMlccItemsFilters(q, adaNumber, isNewItemQ);
    q = q.ilike("name_normalized", `%${brandPart}%`);
    for (const w of suffixWords) {
      q = q.ilike("name_normalized", `%${w}%`);
    }
    const { data, error } = await q
      .order("code", { ascending: true })
      .limit(MULTI_TERM_BRAND_FETCH_CAP);
    if (error) return { rows: [], error };
    for (const row of data ?? []) {
      if (row?.id && !rowsById.has(row.id)) rowsById.set(row.id, row);
    }
  }

  const merged = [...rowsById.values()].sort((a, b) =>
    String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true }),
  );
  return { rows: merged, error: null };
}

function queueUpcLookupLog(row) {
  try {
    void supabase
      .from("upc_lookups")
      .insert(row)
      .then(({ error }) => {
        if (error) console.log("[price-book-upc] upc_lookups log failed", error.message);
      });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.log("[price-book-upc] upc_lookups log exception", m);
  }
}

export async function priceBookUpcHandler(req, res) {
  try {
    const upc = String(req.params.upc ?? "").trim();
    if (!upc) {
      return res.status(400).json({ ok: false, error: "upc_required" });
    }
    console.log("[price-book-upc] lookup", upc);

    const { data: localRow, error: localErr } = await supabase
      .from("mlcc_items")
      .select("*")
      .eq("upc", upc)
      .limit(1)
      .maybeSingle();

    if (localErr) {
      console.log("[price-book-upc] db error", localErr.message);
      return res.status(500).json({ ok: false, error: localErr.message });
    }
    if (localRow) {
      console.log("[price-book-upc] local match", localRow.id);
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: localRow.code ?? null,
        matched_product_name: localRow.name ?? null,
        source: "local_cache",
        raw_api_response: null,
      });
      return res.json({ ok: true, product: localRow });
    }

    const upcDb = await lookupUpcFromUpcitemdb(upc);
    if (upcDb.ok && upcDb.product) {
      const upcItem = upcDb.product;
      const mlcc = await findMlccCandidatesForUpc(supabase, upcItem);
      if (mlcc.confident && mlcc.candidates.length === 1) {
        const match = mlcc.candidates[0];
        const { error: upErr } = await supabase.from("mlcc_items").update({ upc }).eq("id", match.id);
        if (upErr) {
          console.log("[price-book-upc] mlcc_items upc cache update failed", upErr.message);
        }
        const { data: refreshed } = await supabase.from("mlcc_items").select("*").eq("id", match.id).maybeSingle();
        const product = refreshed ?? { ...match, upc };
        queueUpcLookupLog({
          upc,
          matched_mlcc_code: product.code ?? null,
          matched_product_name: product.name ?? null,
          source: "upcitemdb",
          raw_api_response: upcDb.raw ?? null,
        });
        console.log("[price-book-upc] matched via upcitemdb (confident)", product.id);
        return res.json({ ok: true, product, matchMode: "confident" });
      }
      if (mlcc.candidates.length > 1) {
        queueUpcLookupLog({
          upc,
          matched_mlcc_code: null,
          matched_product_name: null,
          source: "upcitemdb",
          raw_api_response: upcDb.raw ?? null,
        });
        return res.json({
          ok: true,
          needsUserConfirmation: true,
          matchMode: "ambiguous",
          candidates: mlcc.candidates,
          upcProductName: upcItem.name,
          upcBrand: upcItem.brand,
          message: "Multiple products match. User must select.",
        });
      }
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "upcitemdb",
        raw_api_response: upcDb.raw ?? null,
      });
      return res.json({
        ok: false,
        error: "upc_found_but_no_mlcc_match",
        productName: upcItem.name,
        hint: "search_by_name",
      });
    }

    const tryOff = upcDb.error === "not_found";
    if (!tryOff) {
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "upcitemdb",
        raw_api_response: { error: upcDb.error },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    let offJson;
    try {
      const ctrl = AbortSignal.timeout(5000);
      const offRes = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(upc)}.json`,
        { signal: ctrl },
      );
      offJson = await offRes.json();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log("[price-book-upc] openfoodfacts fetch failed", msg);
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "not_found",
        raw_api_response: { open_food_facts: "fetch_failed", message: msg },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    if (offJson?.status != 1 || !offJson.product) {
      console.log("[price-book-upc] openfoodfacts no product");
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "not_found",
        raw_api_response: { open_food_facts: offJson ?? null },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    const p = offJson.product;
    const nameGuess =
      (typeof p.product_name === "string" && p.product_name.trim()) ||
      (typeof p.brands === "string" && p.brands.trim()) ||
      "";
    if (!nameGuess) {
      console.log("[price-book-upc] openfoodfacts missing name/brands");
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "not_found",
        raw_api_response: { open_food_facts: "no_name" },
      });
      return res.json({ ok: false, error: "upc_not_found" });
    }

    const offBrands = typeof p.brands === "string" ? p.brands.trim() : "";
    const offUpcItem = {
      name: nameGuess.trim(),
      brand: offBrands,
      category: "",
      images: [],
    };
    const offMlcc = await findMlccCandidatesForUpc(supabase, offUpcItem);
    if (offMlcc.confident && offMlcc.candidates.length === 1) {
      const offMatch = offMlcc.candidates[0];
      const { error: offUpErr } = await supabase.from("mlcc_items").update({ upc }).eq("id", offMatch.id);
      if (offUpErr) {
        console.log("[price-book-upc] mlcc_items upc cache update (off) failed", offUpErr.message);
      }
      const { data: offRefreshed } = await supabase
        .from("mlcc_items")
        .select("*")
        .eq("id", offMatch.id)
        .maybeSingle();
      const product = offRefreshed ?? { ...offMatch, upc };
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: product.code ?? null,
        matched_product_name: product.name ?? null,
        source: "open_food_facts",
        raw_api_response: offJson,
      });
      console.log("[price-book-upc] matched via open food facts (confident)", product.id);
      return res.json({ ok: true, product, matchMode: "confident" });
    }
    if (offMlcc.candidates.length > 1) {
      queueUpcLookupLog({
        upc,
        matched_mlcc_code: null,
        matched_product_name: null,
        source: "open_food_facts",
        raw_api_response: offJson,
      });
      return res.json({
        ok: true,
        needsUserConfirmation: true,
        matchMode: "ambiguous",
        candidates: offMlcc.candidates,
        upcProductName: offUpcItem.name,
        upcBrand: offUpcItem.brand,
        message: "Multiple products match. User must select.",
      });
    }

    console.log("[price-book-upc] no mlcc match for off name");
    queueUpcLookupLog({
      upc,
      matched_mlcc_code: null,
      matched_product_name: null,
      source: "open_food_facts",
      raw_api_response: offJson,
    });
    return res.json({
      ok: false,
      error: "upc_found_but_no_mlcc_match",
      productName: nameGuess.trim(),
      hint: "search_by_name",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("[price-book-upc] unexpected", msg);
    return res.json({ ok: false, error: "upc_not_found" });
  }
}

router.post("/upc/:upc/confirm", async (req, res) => {
  if (!requireServiceRole(req, res)) return;
  try {
    const upc = String(req.params.upc ?? "").trim();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const mlccCode = typeof body.mlccCode === "string" ? body.mlccCode.trim() : "";
    if (!upc || !mlccCode) {
      return res.status(400).json({ ok: false, error: "upc_and_mlccCode_required" });
    }

    const { data: rows, error: selErr } = await supabase
      .from("mlcc_items")
      .select("*")
      .eq("code", mlccCode)
      .limit(1);

    if (selErr) {
      return res.status(500).json({ ok: false, error: selErr.message });
    }
    const row = rows?.[0];
    if (!row) {
      return res.json({ ok: false, error: "mlcc_code_not_found" });
    }

    const { error: upErr } = await supabase.from("mlcc_items").update({ upc }).eq("id", row.id);
    if (upErr) {
      return res.status(500).json({ ok: false, error: upErr.message });
    }

    const { data: refreshed } = await supabase.from("mlcc_items").select("*").eq("id", row.id).maybeSingle();
    const product = refreshed ?? { ...row, upc };

    const upcProductName =
      typeof body.upcProductName === "string" ? body.upcProductName.trim() || null : null;
    const upcBrand = typeof body.upcBrand === "string" ? body.upcBrand.trim() || null : null;
    queueUpcLookupLog({
      upc,
      matched_mlcc_code: product.code ?? null,
      matched_product_name: product.name ?? null,
      source: "manual_confirm",
      raw_api_response:
        upcProductName || upcBrand ? { upcProductName, upcBrand } : null,
    });

    return res.json({ ok: true, product });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
});

router.get("/upc/:upc", priceBookUpcHandler);

router.get("/items", async (req, res) => {
  try {
    let page = Number.parseInt(String(req.query.page || "1"), 10);
    let limit = Number.parseInt(String(req.query.limit || "50"), 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const adaNumber = typeof req.query.adaNumber === "string" ? req.query.adaNumber.trim() : "";
    const isNewItemQ = req.query.isNewItem;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (search && /^\d+$/.test(search)) {
      let qExact = supabase.from("mlcc_items").select("*", { count: "exact" }).eq("code", search);
      qExact = applyMlccItemsFilters(qExact, adaNumber, isNewItemQ);
      const exactRes = await qExact.order("code", { ascending: true }).range(from, to);
      if (exactRes.error) {
        return res.status(500).json({ ok: false, error: exactRes.error.message });
      }
      if (exactRes.data?.length) {
        return res.json({
          ok: true,
          items: exactRes.data,
          total: exactRes.count ?? 0,
          page,
        });
      }

      let qName = supabase.from("mlcc_items").select("*", { count: "exact" }).ilike("name", `%${search}%`);
      qName = applyMlccItemsFilters(qName, adaNumber, isNewItemQ);
      const nameRes = await qName.order("code", { ascending: true }).range(from, to);
      if (nameRes.error) {
        return res.status(500).json({ ok: false, error: nameRes.error.message });
      }
      return res.json({
        ok: true,
        items: nameRes.data || [],
        total: nameRes.count ?? 0,
        page,
      });
    }

    if (search) {
      const normalizedRaw = normalizeSearchTerm(search);
      const brandKey = findLongestContainedBrandKey(normalizedRaw);

      if (brandKey) {
        const { rows: mergedRows, error: mergeErr } = await multiTermBrandSearch({
          supabase,
          brandKey,
          normalizedRaw,
          adaNumber,
          isNewItemQ,
        });
        if (mergeErr) {
          const msg =
            mergeErr instanceof Error ? mergeErr.message : String(mergeErr?.message ?? mergeErr);
          return res.status(500).json({ ok: false, error: msg });
        }

        if (mergedRows.length >= 3) {
          const total = mergedRows.length;
          const items = mergedRows.slice(from, from + limit);
          return res.json({
            ok: true,
            items,
            total,
            page,
          });
        }

        const { data: fuzzyRows, error: fuzzyErr } = await supabase.rpc("search_mlcc_items_fuzzy", {
          search_query: search,
          match_threshold: 0.15,
          result_limit: limit * 3,
        });
        if (fuzzyErr) {
          return res.status(500).json({ ok: false, error: fuzzyErr.message });
        }
        let filtered = filterMlccRowsClientSide(fuzzyRows, adaNumber, isNewItemQ);
        filtered.sort((a, b) =>
          String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true }),
        );
        const total = filtered.length;
        const items = filtered.slice(from, from + limit);
        return res.json({
          ok: true,
          items,
          total,
          page,
        });
      }

      let qOrHead = supabase.from("mlcc_items").select("*", { count: "exact", head: true });
      qOrHead = applyItemsOrSearchToQuery(qOrHead, search);
      qOrHead = applyMlccItemsFilters(qOrHead, adaNumber, isNewItemQ);
      const { count: orCount, error: orHeadErr } = await qOrHead;
      if (orHeadErr) {
        return res.status(500).json({ ok: false, error: orHeadErr.message });
      }

      if (orCount != null && orCount >= 3) {
        let qOr = supabase.from("mlcc_items").select("*", { count: "exact" });
        qOr = applyItemsOrSearchToQuery(qOr, search);
        qOr = applyMlccItemsFilters(qOr, adaNumber, isNewItemQ);
        const { data: orItems, error: orErr, count } = await qOr
          .order("code", { ascending: true })
          .range(from, to);
        if (orErr) {
          return res.status(500).json({ ok: false, error: orErr.message });
        }
        return res.json({
          ok: true,
          items: orItems || [],
          total: count ?? 0,
          page,
        });
      }

      const { data: fuzzyRowsNoBrand, error: fuzzyErrNoBrand } = await supabase.rpc(
        "search_mlcc_items_fuzzy",
        {
          search_query: search,
          match_threshold: 0.15,
          result_limit: limit * 3,
        },
      );
      if (fuzzyErrNoBrand) {
        return res.status(500).json({ ok: false, error: fuzzyErrNoBrand.message });
      }
      let filteredNoBrand = filterMlccRowsClientSide(fuzzyRowsNoBrand, adaNumber, isNewItemQ);
      filteredNoBrand.sort((a, b) =>
        String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true }),
      );
      const totalNb = filteredNoBrand.length;
      const itemsNb = filteredNoBrand.slice(from, from + limit);
      return res.json({
        ok: true,
        items: itemsNb,
        total: totalNb,
        page,
      });
    }

    let q = supabase.from("mlcc_items").select("*", { count: "exact" });

    q = applyMlccItemsFilters(q, adaNumber, isNewItemQ);

    const { data: items, error, count } = await q.order("code", { ascending: true }).range(from, to);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({
      ok: true,
      items: items || [],
      total: count ?? 0,
      page,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
