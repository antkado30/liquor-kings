/**
 * /catalog-images — Tony's self-serve image curation tool (#69).
 *
 * Lists SKUs whose mlcc_items.image_url is still NULL, on-shelf first.
 * Tony's workflow:
 *   1. Open this page (admin desktop, easier than mobile for URL pasting).
 *   2. For each row: in another tab, Google the bottle name → right-click
 *      the result image → "Copy image address" → paste into the input.
 *   3. Inline preview renders; if it looks right, hit Save.
 *   4. Row disappears (it's no longer uncovered).
 *
 * Pin-point accuracy is YOUR call — you see the preview before saving.
 * No automated source means no Tito's-on-Hennessy mistakes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearImageUrl,
  fetchUncovered,
  setImageUrl,
  type UncoveredRow,
} from "../api/catalogImages";
import {
  DeckEmpty,
  DeckHeader,
  DeckPage,
  DeckSkeleton,
  DeckStat,
  DeckStatGrid,
  IconChevronLeft,
  IconChevronRight,
  IconExternal,
} from "../deck/DeckUi";

const PAGE_SIZE = 30;

type RowState = {
  draft: string;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
};

export function CatalogImagesPage() {
  const [rows, setRows] = useState<UncoveredRow[]>([]);
  const [total, setTotal] = useState(0);
  const [onShelfTotal, setOnShelfTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [onShelfOnly, setOnShelfOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Per-code UI state (input value, save status). */
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const r = await fetchUncovered({
      limit: PAGE_SIZE,
      offset,
      q: q.trim() || undefined,
      onShelfOnly,
    });
    if (!r.ok) {
      setLoadError(r.error);
      setLoading(false);
      return;
    }
    setRows(r.rows);
    setTotal(r.total);
    setOnShelfTotal(r.on_shelf_total);
    // Reset row drafts for newly-loaded rows.
    setRowState((prev) => {
      const next: Record<string, RowState> = {};
      for (const row of r.rows) {
        next[row.code] = prev[row.code] ?? {
          draft: "",
          saving: false,
          savedAt: null,
          error: null,
        };
      }
      return next;
    });
    setLoading(false);
  }, [offset, q, onShelfOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDraftChange = (code: string, value: string) => {
    setRowState((prev) => ({
      ...prev,
      [code]: {
        ...(prev[code] ?? { draft: "", saving: false, savedAt: null, error: null }),
        draft: value,
        error: null,
      },
    }));
  };

  const onSave = async (code: string) => {
    const state = rowState[code];
    const url = state?.draft?.trim() ?? "";
    if (!url) {
      setRowState((p) => ({
        ...p,
        [code]: { ...(p[code] ?? { draft: "", saving: false, savedAt: null, error: null }), error: "URL required" },
      }));
      return;
    }
    setRowState((p) => ({
      ...p,
      [code]: { ...(p[code] ?? { draft: "", saving: false, savedAt: null, error: null }), saving: true, error: null },
    }));
    const r = await setImageUrl(code, url);
    if (!r.ok) {
      setRowState((p) => ({
        ...p,
        [code]: { ...(p[code] ?? { draft: "", saving: false, savedAt: null, error: null }), saving: false, error: r.error },
      }));
      return;
    }
    // Remove from list (the SKU is now covered) + bump totals.
    setRows((cur) => cur.filter((row) => row.code !== code));
    setTotal((t) => Math.max(0, t - 1));
  };

  const goPrev = () => setOffset((o) => Math.max(0, o - PAGE_SIZE));
  const goNext = () => setOffset((o) => o + PAGE_SIZE);
  const hasPrev = offset > 0;
  const hasNext = offset + rows.length < total;

  const remaining = useMemo(() => total, [total]);

  return (
    <DeckPage narrow>
      <DeckHeader
        title="Catalog images"
        subtitle="Paste a clean image URL (Google Images → right-click → Copy image address). Preview before saving."
        icon="images"
        onRefresh={() => void load()}
        loading={loading}
      />

      <DeckStatGrid>
        <DeckStat
          label="Uncovered SKUs"
          value={remaining.toLocaleString()}
          tone="purple"
        />
        <DeckStat
          label="On shelf"
          value={onShelfTotal.toLocaleString()}
          sub="Prioritized in list when on-shelf only is enabled"
          tone="neutral"
        />
      </DeckStatGrid>

      <div className="deck-catalog-toolbar">
        <input
          type="search"
          className="deck-catalog-search"
          placeholder="Search by name..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={onShelfOnly}
            onChange={(e) => {
              setOnShelfOnly(e.target.checked);
              setOffset(0);
            }}
          />
          On-shelf only
        </label>
      </div>

      {loadError ? <div className="banner banner-err">Load error: {loadError}</div> : null}
      {loading ? <DeckSkeleton rows={4} variant="row" /> : null}
      {!loading && rows.length === 0 && !loadError ? (
        <DeckEmpty title="No uncovered SKUs">
          Try a different search or untick on-shelf only.
        </DeckEmpty>
      ) : null}

      <ul className="deck-catalog-list">
        {rows.map((row) => {
          const state = rowState[row.code] ?? {
            draft: "",
            saving: false,
            savedAt: null,
            error: null,
          };
          const previewUrl = state.draft.trim();
          return (
            <li
              key={row.code}
              className={`deck-catalog-row${row.on_shelf ? " deck-catalog-row--shelf" : ""}`}
            >
              <div className="deck-catalog-preview">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={row.name}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <span style={{ textAlign: "center", padding: 8 }}>no preview</span>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 15 }}>{row.name}</strong>
                  {row.on_shelf ? <span className="deck-catalog-badge">ON SHELF</span> : null}
                </div>
                <div className="muted small">
                  Code {row.code} · {row.bottle_size_label ?? `${row.bottle_size_ml ?? "?"} mL`}
                  {row.ada_name ? ` · ${row.ada_name}` : ""}
                  {row.category ? ` · ${row.category}` : ""}
                </div>
                <input
                  type="url"
                  className="mono"
                  placeholder="https://... image URL"
                  value={state.draft}
                  onChange={(e) => onDraftChange(row.code, e.target.value)}
                  style={{ width: "100%", fontSize: 12 }}
                />
                {state.error ? (
                  <span className="msg error" style={{ fontSize: 12, padding: "4px 8px" }}>{state.error}</span>
                ) : null}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void onSave(row.code)}
                    disabled={state.saving || !state.draft.trim()}
                  >
                    {state.saving ? "Saving…" : "Save"}
                  </button>
                  <a
                    href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(
                      `${row.name} ${row.bottle_size_label ?? ""} bottle`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn secondary"
                    style={{ textDecoration: "none" }}
                  >
                    Google images <IconExternal />
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="deck-pager">
        <button type="button" className="btn secondary" onClick={goPrev} disabled={!hasPrev || loading}>
          <IconChevronLeft /> Prev
        </button>
        <span className="muted small" style={{ fontVariantNumeric: "tabular-nums" }}>
          {offset + 1}–{offset + rows.length} of {total.toLocaleString()}
        </span>
        <button type="button" className="btn secondary" onClick={goNext} disabled={!hasNext || loading}>
          Next <IconChevronRight />
        </button>
      </div>
    </DeckPage>
  );
}

// Re-export for tree shake friendliness if needed elsewhere.
export { clearImageUrl };
