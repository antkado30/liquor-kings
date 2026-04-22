import { useCallback, useEffect, useRef, useState } from "react";
import type { MlccProduct } from "../types";
import { searchProducts } from "../api/catalog";

export function useCatalogSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MlccProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await searchProducts(q, { limit: 20 });
      setResults(items);
    } catch {
      setError("Having trouble connecting…");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
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

  return { query, setQuery, results, loading, error };
}
