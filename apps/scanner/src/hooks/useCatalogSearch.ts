import { useCallback, useEffect, useRef, useState } from "react";
import type { MlccProduct } from "../types";
import { searchProducts } from "../api/catalog";

const PAGE_SIZE = 20;

/**
 * Typeahead catalog search for the scan page. Debounced live results as the
 * user types, plus "Load more" pagination (task: Amazon-style search dropdown,
 * 2026-06-07). A request counter guards against stale responses — if the query
 * changes mid-flight, an older page never overwrites or appends to the newer
 * result set.
 */
export function useCatalogSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MlccProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const reqRef = useRef(0); // bumped on each NEW search; guards stale appends

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
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
      const items = await searchProducts(q, { limit: PAGE_SIZE, page: 1 });
      if (reqRef.current !== myReq) return; // a newer search superseded this
      setResults(items);
      setHasMore(items.length === PAGE_SIZE);
    } catch {
      if (reqRef.current !== myReq) return;
      setError("Having trouble connecting…");
      setResults([]);
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

  return { query, setQuery, results, loading, loadingMore, hasMore, error, loadMore };
}
