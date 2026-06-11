/**
 * Operator review queue for Tier 2 ambiguous NRS matches.
 *
 * One row at a time, focused-triage UX:
 *  - Top: NRS name + size + UPC of the current row
 *  - Middle: up to 3 MLCC candidate cards, numbered 1/2/3
 *  - Bottom: Skip button + progress + queue size
 *
 * Keyboard shortcuts:
 *  - 1 / 2 / 3   → resolve current row with that candidate
 *  - s           → skip current row
 *  - r           → refresh queue
 *
 * Queue management: prefetches in pages of 50, advances on each action,
 * silently refills when the local queue runs below 5 remaining.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPendingReviews,
  resolveReview,
  searchMlccCatalog,
  skipReview,
  type CatalogSearchResult,
  type NrsReviewRow,
} from "../api/nrsReview";
import {
  DeckBanner,
  DeckEmpty,
  DeckHeader,
  DeckPage,
  DeckSkeleton,
  IconCheckSmall,
} from "../deck/DeckUi";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatSize(sizeMl: number | null | undefined, label: string | null | undefined): string {
  if (label && label.trim() !== "") return label;
  if (sizeMl != null && Number.isFinite(sizeMl)) return `${sizeMl} ML`;
  return "—";
}

type Flash =
  | { kind: "none" }
  | { kind: "ok"; text: string }
  | { kind: "err"; text: string };

const PAGE_SIZE = 50;
const REFILL_THRESHOLD = 5;

export function NrsReviewPage() {
  const [queue, setQueue] = useState<NrsReviewRow[]>([]);
  const [totalPending, setTotalPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [flash, setFlash] = useState<Flash>({ kind: "none" });
  const [resolvedCount, setResolvedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const refillingRef = useRef(false);

  // Catalog search fallback — when none of the top 3 match, operator can
  // search the full MLCC catalog (reuses /price-book/items endpoint).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = queue[0] ?? null;

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setFlash({ kind: "none" });
    const res = await fetchPendingReviews(PAGE_SIZE, 0);
    setLoading(false);
    if (!res.ok) {
      setFlash({ kind: "err", text: res.error ?? "Failed to load review queue" });
      return;
    }
    setQueue(res.items);
    setTotalPending(res.total);
  }, []);

  // Initial load
  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Background refill when queue runs low (and there's more to fetch)
  useEffect(() => {
    if (refillingRef.current) return;
    if (queue.length > REFILL_THRESHOLD) return;
    if (totalPending == null) return;
    // Estimate remaining server-side: total - actions taken in this session
    const estServerRemaining = totalPending - resolvedCount - skippedCount;
    if (estServerRemaining <= queue.length) return;

    refillingRef.current = true;
    void (async () => {
      const res = await fetchPendingReviews(PAGE_SIZE, 0);
      refillingRef.current = false;
      if (!res.ok) return;
      // Filter out items we already have in queue (by id) — refills can overlap
      const known = new Set(queue.map((q) => q.id));
      const fresh = res.items.filter((it) => !known.has(it.id));
      if (fresh.length > 0) {
        setQueue((prev) => [...prev, ...fresh]);
      }
      setTotalPending(res.total);
    })();
  }, [queue, totalPending, resolvedCount, skippedCount]);

  const advance = useCallback(() => {
    setQueue((prev) => prev.slice(1));
    // Reset search state on advance so the next row starts fresh.
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const handleResolve = useCallback(
    async (candidateIndex: number) => {
      if (!current || acting) return;
      const candidate = current.top_candidates[candidateIndex];
      if (!candidate) return;
      setActing(true);
      const res = await resolveReview(current.id, candidate.code);
      setActing(false);
      if (!res.ok) {
        setFlash({ kind: "err", text: res.error ?? "Resolve failed" });
        return;
      }
      setResolvedCount((n) => n + 1);
      setFlash({
        kind: "ok",
        text: `Mapped UPC ${current.upc} → ${res.mlccName ?? candidate.name} (${candidate.code})`,
      });
      advance();
    },
    [current, acting, advance],
  );

  // Resolve via direct mlcc_code (used by both candidate buttons and catalog search picks).
  const handleResolveCode = useCallback(
    async (mlccCode: string, displayName?: string) => {
      if (!current || acting) return;
      setActing(true);
      const res = await resolveReview(current.id, mlccCode);
      setActing(false);
      if (!res.ok) {
        setFlash({ kind: "err", text: res.error ?? "Resolve failed" });
        return;
      }
      setResolvedCount((n) => n + 1);
      setFlash({
        kind: "ok",
        text: `Mapped UPC ${current.upc} → ${res.mlccName ?? displayName ?? mlccCode}`,
      });
      // Reset search state when moving on
      setSearchOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      advance();
    },
    [current, acting, advance],
  );

  const handleSkip = useCallback(async () => {
    if (!current || acting) return;
    setActing(true);
    const res = await skipReview(current.id, "operator_skipped");
    setActing(false);
    if (!res.ok) {
      setFlash({ kind: "err", text: res.error ?? "Skip failed" });
      return;
    }
    setSkippedCount((n) => n + 1);
    setFlash({ kind: "ok", text: `Skipped UPC ${current.upc}` });
    advance();
  }, [current, acting, advance]);

  // Keyboard shortcuts: 1/2/3 resolve, s skip, r refresh
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (acting || !current) return;
      // Ignore when focus is in an input/textarea
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "1") {
        e.preventDefault();
        void handleResolve(0);
      } else if (e.key === "2") {
        e.preventDefault();
        void handleResolve(1);
      } else if (e.key === "3") {
        e.preventDefault();
        void handleResolve(2);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleSkip();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void loadInitial();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acting, current, handleResolve, handleSkip, loadInitial]);

  // Auto-clear flash after a few seconds
  useEffect(() => {
    if (flash.kind === "none") return;
    const t = setTimeout(() => setFlash({ kind: "none" }), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  // Debounced catalog search (300ms after typing stops)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchOpen || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      const results = await searchMlccCatalog(searchQuery);
      setSearchResults(results);
      setSearchLoading(false);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchOpen, searchQuery]);

  const progressLabel = useMemo(() => {
    const cleared = resolvedCount + skippedCount;
    const remainingFromTotal = totalPending != null ? Math.max(totalPending - cleared, 0) : null;
    if (remainingFromTotal == null) return `${cleared} cleared this session`;
    return `${cleared} cleared this session · ~${remainingFromTotal} remaining`;
  }, [resolvedCount, skippedCount, totalPending]);

  return (
    <DeckPage narrow>
      <DeckHeader
        title="Catalog review queue"
        subtitle={
          <>
            Tier 2 ambiguous NRS matches. Pick the correct MLCC product to write a permanent UPC mapping.
            Keys: <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> = resolve · <kbd>S</kbd> = skip · <kbd>R</kbd> = refresh
          </>
        }
        icon="catalog"
        onRefresh={() => void loadInitial()}
        loading={loading}
      />

      {flash.kind === "ok" ? <DeckBanner kind="ok">{flash.text}</DeckBanner> : null}
      {flash.kind === "err" ? <DeckBanner kind="err">{flash.text}</DeckBanner> : null}

      {loading ? <DeckSkeleton rows={3} variant="card" /> : null}

      {!loading && !current ? (
        <DeckEmpty
          title="Inbox zero"
          action={
            <button type="button" className="btn primary" onClick={() => void loadInitial()}>
              Refresh
            </button>
          }
        >
          No pending matches in the queue. Refresh (R) to check for new ones.
        </DeckEmpty>
      ) : null}

      {current ? (
        <div className="card nrs-review-current">
          <div className="nrs-review-row-meta">
            <div className="muted small">UPC</div>
            <div className="nrs-review-upc">{current.upc}</div>
            <div className="muted small" style={{ marginTop: 8 }}>NRS name</div>
            <div className="nrs-review-nrsname">{current.nrs_name}</div>
            <div className="muted small" style={{ marginTop: 8 }}>Extracted size</div>
            <div>{current.size_ml ? `${current.size_ml} ML` : "—"}</div>
          </div>

          <div className="nrs-review-candidates">
            <div className="muted small" style={{ marginBottom: 8 }}>
              MLCC candidates — click or press the number key to confirm
            </div>
            {current.top_candidates.slice(0, 3).map((c, idx) => (
              <button
                type="button"
                key={`${current.id}-${c.code}`}
                className="nrs-review-candidate"
                onClick={() => void handleResolve(idx)}
                disabled={acting}
              >
                <span className="nrs-review-candidate-key">{idx + 1}</span>
                <span className="nrs-review-candidate-body">
                  <span className="nrs-review-candidate-name">{c.name}</span>
                  <span className="nrs-review-candidate-attrs muted small">
                    {formatSize(c.size_ml, c.bottle_size_label)}
                    {c.category ? ` · ${c.category}` : ""}
                    {c.ada_name ? ` · ${c.ada_name}` : ""}
                    {" · "}code {c.code}
                  </span>
                </span>
                <span className="nrs-review-candidate-price">
                  <span>{money(c.licensee_price)}</span>
                  <span className="muted small">score {c.score}</span>
                </span>
              </button>
            ))}
            {current.top_candidates.length === 0 ? (
              <p className="muted">No candidates were recorded for this UPC. Skip it.</p>
            ) : null}
          </div>

          {/* Catalog search fallback for when none of the top 3 match */}
          <div className="nrs-review-search-section">
            {!searchOpen ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => setSearchOpen(true)}
              >
                None of these match — search the full catalog
              </button>
            ) : (
              <>
                <div className="nrs-review-search-row">
                  <input
                    type="text"
                    className="nrs-review-search-input"
                    placeholder="Type a name to search MLCC catalog (e.g. 'ole smoky apple pie')"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                  >
                    Close
                  </button>
                </div>
                {searchLoading ? <DeckSkeleton rows={2} variant="row" /> : null}
                {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 ? (
                  <p className="muted small">No matches in MLCC catalog. Try a shorter or different name.</p>
                ) : null}
                {searchResults.length > 0 ? (
                  <ul className="nrs-review-search-results">
                    {searchResults.map((r) => (
                      <li key={r.code}>
                        <button
                          type="button"
                          className="nrs-review-candidate"
                          onClick={() => void handleResolveCode(r.code, r.name)}
                          disabled={acting}
                        >
                          <span className="nrs-review-candidate-key" aria-hidden>
                            <IconCheckSmall size={16} />
                          </span>
                          <span className="nrs-review-candidate-body">
                            <span className="nrs-review-candidate-name">{r.name}</span>
                            <span className="nrs-review-candidate-attrs muted small">
                              {formatSize(r.size_ml, r.bottle_size_label)}
                              {r.category ? ` · ${r.category}` : ""}
                              {r.ada_name ? ` · ${r.ada_name}` : ""}
                              {" · "}code {r.code}
                            </span>
                          </span>
                          <span className="nrs-review-candidate-price">
                            <span>{money(r.licensee_price)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <div className="nrs-review-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => void handleSkip()}
              disabled={acting}
            >
              Skip (S)
            </button>
          </div>
        </div>
      ) : null}

      <footer className="nrs-review-footer muted small" style={{ fontVariantNumeric: "tabular-nums" }}>
        {progressLabel}
      </footer>
    </DeckPage>
  );
}
