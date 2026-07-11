import { useCallback, useEffect, useRef, useState } from "react";
import type { FamilyGroup, MlccProduct } from "../types";
import { searchProducts, searchProductsGrouped } from "../api/catalog";

const PAGE_SIZE = 20;

/*
  Grouped search kill switch (plan §safety, 2026-07-11). ON: search
  results collapse to one family card per product line (competitor-bar
  UX). Flip to false to restore flat search everywhere with zero other
  changes — the server route is additive and just goes unused.
*/
const GROUPED_SEARCH_ENABLED = true;

/**
 * Typeahead catalog search for the scan page. Debounced live results as the
 * user types, plus "Load more" pagination (task: Amazon-style search dropdown,
 * 2026-06-07). A request counter guards against stale responses — if the query
 * changes mid-flight, an older page never overwrites or appends to the newer
 * result set.
 *
 * Grouped mode (2026-07-11): when enabled AND the caller allows it, results
 * come back as FamilyGroup cards (`groups`); `results` stays empty. Zero
 * groups (typo, fuzzy-only match) falls back to the flat search in the same
 * request cycle, so misspellings keep working exactly as before. Callers that
 * need EXACT-SKU picking (UPC mapping mode) pass `grouped: false` and get
 * the flat list — mapping a UPC to a family representative would risk the
 * wrong bottle, which is the one unforgivable failure.
 */
export function useCatalogSearch(options?: { grouped?: boolean }) {
  const groupedWanted = GROUPED_SEARCH_ENABLED && options?.grouped !== false;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MlccProduct[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const reqRef = useRef(0); // bumped on each NEW search; guards stale appends
  /*
    Mirror groupedWanted into a ref so runSearch/effect don't need it as a
    dependency-triggered rebuild on every render; the mode-change effect
    below re-runs the search explicitly when it flips (e.g. entering UPC
    mapping mode mid-typeahead).
  */
  const groupedRef = useRef(groupedWanted);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setGroups([]);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }
    const myReq = ++reqRef.current;
    pageRef.current = 1;
    setLoading(true);
    setError(null);
    try {
      if (groupedRef.current) {
        const familyGroups = await searchProductsGrouped(q, { limit: 30 });
        if (reqRef.current !== myReq) return;
        if (familyGroups.length > 0) {
          setGroups(familyGroups);
          setResults([]);
          setHasMore(false); // top-30 family cards; no "page 2 of families"
          return;
        }
        // Zero groups → typo or fuzzy-only match. Fall through to the flat
        // path (which has the fuzzy RPC) so the user still gets answers.
      }
      const items = await searchProducts(q, { limit: PAGE_SIZE, page: 1 });
      if (reqRef.current !== myReq) return; // a newer search superseded this
      setGroups([]);
      setResults(items);
      setHasMore(items.length === PAGE_SIZE);
    } catch {
      if (reqRef.current !== myReq) return;
      setError("Having trouble connecting…");
      setResults([]);
      setGroups([]);
      setHasMore(false);
    } finally {
      if (reqRef.current === myReq) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const q = query.trim();
    if (loadingMore || !hasMore || q.length < 2) return;
    const myReq = reqRef.current; // tie this page to the current search
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const items = await searchProducts(q, { limit: PAGE_SIZE, page: next });
      if (reqRef.current !== myReq) return; // query changed — drop this page
      pageRef.current = next;
      setResults((prev) => [...prev, ...items]);
      setHasMore(items.length === PAGE_SIZE);
    } catch {
      // Keep what we have; just stop offering more on a hard error.
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [query, loadingMore, hasMore]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      reqRef.current += 1; // invalidate any in-flight search/loadMore
      setResults([]);
      setGroups([]);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(query.trim());
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  /*
    Mode flip mid-typeahead (2026-07-11): entering UPC-mapping mode turns
    grouping off (exact-SKU picking); leaving it turns grouping back on.
    Re-run the current query immediately in the new mode so the visible
    list always matches the mode — a grouped card lingering in mapping
    mode is exactly the wrong-bottle trap this flag exists to prevent.
  */
  useEffect(() => {
    if (groupedRef.current === groupedWanted) return;
    groupedRef.current = groupedWanted;
    const q = query.trim();
    if (q.length >= 2) void runSearch(q);
  }, [groupedWanted, query, runSearch]);

  return { query, setQuery, results, groups, loading, loadingMore, hasMore, error, loadMore };
}
