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
    <div className="page-narrow" style={{ padding: 16 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Catalog images</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {remaining.toLocaleString()} SKU{remaining === 1 ? "" : "s"} still need a photo. {onShelfTotal.toLocaleString()} are on someone&apos;s shelf.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Paste a clean image URL (Google Images → right-click → &quot;Copy image address&quot;). Preview before saving.
        </p>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="search"
          placeholder="Search by name..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", border: "1px solid var(--border, #ccc)", borderRadius: 6 }}
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
      {loading ? <p className="muted">Loading…</p> : null}
      {!loading && rows.length === 0 && !loadError ? (
        <p className="muted">No uncovered SKUs match. Try a different search or untick &quot;on-shelf only&quot;.</p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
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
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                gap: 12,
                padding: 12,
                border: "1px solid var(--border, #2a2a35)",
                borderRadius: 8,
                background: row.on_shelf ? "rgba(108, 99, 255, 0.06)" : "transparent",
              }}
            >
              {/* Preview slot */}
              <div
                style={{
                  width: 120,
                  height: 150,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 6,
                  overflow: "hidden",
                  fontSize: 11,
                  color: "var(--muted, #888)",
                }}
              >
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
                  {row.on_shelf ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        padding: "2px 6px",
                        background: "rgba(108,99,255,0.18)",
                        borderRadius: 4,
                        color: "#c4b5fd",
                      }}
                    >
                      ON SHELF
                    </span>
                  ) : null}
                </div>
                <div className="muted small">
                  Code {row.code} · {row.bottle_size_label ?? `${row.bottle_size_ml ?? "?"} mL`}
                  {row.ada_name ? ` · ${row.ada_name}` : ""}
                  {row.category ? ` · ${row.category}` : ""}
                </div>
                <input
                  type="url"
                  placeholder="https://... image URL"
                  value={state.draft}
                  onChange={(e) => onDraftChange(row.code, e.target.value)}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid var(--border, #ccc)",
                    borderRadius: 6,
                    width: "100%",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
                {state.error ? (
                  <span style={{ color: "#ef4444", fontSize: 12 }}>{state.error}</span>
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
                    Google images ↗
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <button type="button" className="btn secondary" onClick={goPrev} disabled={!hasPrev || loading}>
          ← Prev
        </button>
        <span className="muted small">
          {offset + 1}–{offset + rows.length} of {total.toLocaleString()}
        </span>
        <button type="button" className="btn secondary" onClick={goNext} disabled={!hasNext || loading}>
          Next →
        </button>
      </div>
    </div>
  );
}

// Re-export for tree shake friendliness if needed elsewhere.
export { clearImageUrl };
