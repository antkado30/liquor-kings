/**
 * TemplatesPage — Order template library (task #90, 2026-06-07).
 *
 * The Templates tab in the bottom nav. Tony's explicit ask: "let's
 * make it a little better." Iteration over the original save/load
 * flow (#72/#75) — now templates are a first-class destination with
 * a proper list, edit, delete, schedule, load.
 *
 * Each template card shows:
 *   - Name + needs-review pulse if the scheduler marked it ready
 *   - Schedule chip ("Auto every Thu" or "Manual")
 *   - Item count + last loaded
 *   - Actions: Load → cart, Edit (rename + reschedule), Delete
 *
 * Empty state: actionable prompt directing the user to save from cart.
 *
 * Doctrine alignment: discipline #1 (predictable) — schedule chip
 * format and ordering is stable; discipline #3 (pre-commit
 * verification) — delete shows a confirm step; doctrine #5 (loud
 * failures) — load errors surface a clear message, not a silent fail.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { nonGlassContainerSuffix, packCountSuffix } from "../lib/container-label";
import {
  archiveOrderTemplate,
  listOrderTemplates,
  loadOrderTemplate,
  updateOrderTemplate,
  type OrderTemplate,
  type OrderTemplateItem,
} from "../api/orderTemplates";
import { searchProducts } from "../api/catalog";
import type { MlccProduct } from "../types";
import { useCart } from "../hooks/useCart";
import {
  IconCalendar,
  IconClipboardList,
  IconPencil,
  IconTrash,
  IconX,
} from "../components/Icons";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FULL = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function scheduleEyebrow(scheduleDow: number | null): string {
  if (scheduleDow == null) return "MANUAL";
  return `AUTO · EVERY ${DOW_FULL[scheduleDow] ?? "WEEK"}`;
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const cart = useCart();
  const storeId = getCurrentStoreId() ?? "none";
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrderTemplate | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrderTemplate | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);

  // Cached so reopening Templates is instant; revalidates in background.
  const res = useCachedResource<OrderTemplate[]>(
    `templates:${storeId}`,
    async () => {
      const r = await listOrderTemplates();
      if (!r.ok) throw new Error(r.error);
      // Sort: needs_review first, then alphabetical
      return [...r.data].sort((a, b) => {
        if (a.needs_review !== b.needs_review) return a.needs_review ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
  );

  const templates = res.data ?? null;
  // Surface either a fetch error or an action error (load/delete failures).
  const error =
    loadError ??
    (res.error
      ? res.error instanceof Error
        ? res.error.message
        : String(res.error)
      : null);
  const refresh = res.refresh;

  async function handleLoad(t: OrderTemplate) {
    setLoadingId(t.id);
    setLoadError(null);
    const r = await loadOrderTemplate(t.id);
    setLoadingId(null);
    if (!r.ok) {
      setLoadError(`Couldn't load "${t.name}": ${r.error}`);
      return;
    }
    // Add every item to the cart.
    for (const line of r.data.items) {
      cart.addItem(line.product, line.quantity);
    }
    const skipped =
      r.data.missingCodes.length > 0
        ? ` (${r.data.missingCodes.length} item${
            r.data.missingCodes.length === 1 ? "" : "s"
          } no longer in catalog)`
        : "";
    setToast(
      `Loaded ${r.data.items.length} item${
        r.data.items.length === 1 ? "" : "s"
      } into your cart${skipped}`,
    );
    setTimeout(() => setToast(null), 3200);
    setTimeout(() => navigate("/cart"), 600);
  }

  async function handleDelete(t: OrderTemplate) {
    setConfirmDelete(null);
    const r = await archiveOrderTemplate(t.id);
    if (!r.ok) {
      setLoadError(`Couldn't delete "${t.name}": ${r.error}`);
      return;
    }
    setToast(`Deleted "${t.name}"`);
    setTimeout(() => setToast(null), 2500);
    void refresh();
  }

  return (
    <div className="tplpg-page">
      <header className="tplpg-header">
        <h1 className="tplpg-title">Templates</h1>
        <p className="tplpg-subtitle">
          Save your weekly cart as a reusable template. Schedule one to
          auto-prepare every week.
        </p>
      </header>

      {error ? (
        <div className="tplpg-error">
          <div className="tplpg-error__title">Couldn&apos;t load templates</div>
          <div className="tplpg-error__msg">{error}</div>
          <button
            type="button"
            className="tplpg-error__retry"
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {templates === null && !error ? (
        <TemplatesSkeleton />
      ) : templates === null && error ? (
        /* error already rendered above; render nothing here */
        null
      ) : templates !== null && templates.length === 0 ? (
        <div className="tplpg-empty">
          <span className="tplpg-empty__icon" aria-hidden>
            <IconClipboardList size={28} strokeWidth={1.75} />
          </span>
          <p className="tplpg-empty__copy">
            No templates yet — build a cart and tap Save as template.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => navigate("/")}
          >
            Go to Scan
          </button>
        </div>
      ) : templates ? (
        <ul className="tplpg-list">
          {templates.map((t) => {
            const totalQty = t.items.reduce((s, i) => s + i.quantity, 0);
            const isLoading = loadingId === t.id;
            return (
              <li key={t.id} className="tplpg-row">
                <div className="tplpg-row__head">
                  <div className="tplpg-row__eyebrow">
                    <IconCalendar size={12} strokeWidth={2} aria-hidden />
                    {scheduleEyebrow(t.schedule_dow)}
                  </div>
                  <div className="tplpg-row__title-row">
                    <span className="tplpg-row__name">{t.name}</span>
                    {t.needs_review ? (
                      <span className="tplpg-review-badge">
                        <span className="tplpg-review-badge__dot" aria-hidden />
                        Ready to review
                      </span>
                    ) : null}
                  </div>
                  <div className="tplpg-row__meta">
                    {totalQty} bottle{totalQty === 1 ? "" : "s"} ·{" "}
                    {t.items.length} line{t.items.length === 1 ? "" : "s"}
                  </div>
                  {t.last_loaded_at ? (
                    <div className="tplpg-row__last">
                      Last loaded {formatRelative(t.last_loaded_at)}
                    </div>
                  ) : null}
                </div>

                <div className="tplpg-row__actions">
                  <button
                    type="button"
                    onClick={() => handleLoad(t)}
                    disabled={isLoading}
                    className="btn primary tplpg-row__load"
                  >
                    {isLoading ? "Loading…" : "Load into cart"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="tplpg-row__icon-btn"
                    aria-label={`Edit ${t.name}`}
                  >
                    <IconPencil size={18} strokeWidth={1.85} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(t)}
                    className="tplpg-row__icon-btn tplpg-row__icon-btn--danger"
                    aria-label={`Delete ${t.name}`}
                  >
                    <IconTrash size={18} strokeWidth={1.85} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {toast ? <div className="tplpg-toast">{toast}</div> : null}

      {editing ? (
        <EditTemplateModal
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {confirmDelete ? (
        <DeleteConfirmModal
          template={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      ) : null}
    </div>
  );
}

function TemplatesSkeleton() {
  return (
    <div className="tplpg-skeleton" aria-hidden>
      <div className="tplpg-shimmer tplpg-shimmer--row" />
      <div className="tplpg-shimmer tplpg-shimmer--row" />
      <div className="tplpg-shimmer tplpg-shimmer--row" />
    </div>
  );
}

function DeleteConfirmModal({
  template,
  onCancel,
  onConfirm,
}: {
  template: OrderTemplate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useLockBodyScroll();
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="confirm-overlay"
      onClick={onCancel}
    >
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-title">Delete this template?</h2>
        <p className="confirm-body">
          &ldquo;{template.name}&rdquo; will be removed. Templates are archived,
          not hard-deleted — they won&apos;t be recoverable from the UI but the
          data stays on our side for audit. (Doctrine #7.)
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary tplpg-btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: OrderTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLockBodyScroll();
  const [name, setName] = useState(template.name);
  const [scheduleDow, setScheduleDow] = useState<number | null>(
    template.schedule_dow ?? null,
  );
  const [items, setItems] = useState<OrderTemplateItem[]>(
    () => template.items.map((it) => ({ ...it })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Add-bottle search.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MlccProduct[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const found = await searchProducts(q, { limit: 8 });
        if (!cancelled) setResults(found);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function changeQty(code: string, delta: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.mlcc_code === code
          ? { ...it, quantity: Math.max(1, it.quantity + delta) }
          : it,
      ),
    );
  }
  function removeItem(code: string) {
    setItems((prev) => prev.filter((it) => it.mlcc_code !== code));
  }
  function addProduct(p: MlccProduct) {
    setItems((prev) => {
      if (prev.some((it) => it.mlcc_code === p.code)) {
        // Already in the template — bump its quantity instead of duplicating.
        return prev.map((it) =>
          it.mlcc_code === p.code ? { ...it, quantity: it.quantity + 1 } : it,
        );
      }
      return [
        ...prev,
        {
          mlcc_code: p.code,
          quantity: 1,
          name: p.name ?? undefined,
          bottle_size_ml: p.bottle_size_ml ?? undefined,
        },
      ];
    });
    setQuery("");
    setResults([]);
  }

  async function handleSave() {
    setErr(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Name can't be blank.");
      return;
    }
    if (items.length === 0) {
      setErr("A template needs at least one bottle.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await updateOrderTemplate(template.id, {
        name: trimmed,
        schedule_dow: scheduleDow,
        items,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      onSaved();
    } finally {
      // Never leave Save spinning if the call throws. (Stuck-spinner
      // sweep, 2026-06-09.)
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="confirm-overlay"
      onClick={onClose}
    >
      <div
        className="confirm-card tplpg-edit-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tplpg-edit-card__header">
          <h2 className="confirm-title">
            <IconPencil size={18} strokeWidth={2} aria-hidden />
            Edit template
          </h2>
          <button
            type="button"
            className="tplpg-edit-card__close"
            onClick={onClose}
            aria-label="Close edit template"
          >
            <IconX size={20} strokeWidth={2} />
          </button>
        </div>

        <label className="tplpg-field">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="tplpg-input"
            disabled={submitting}
          />
        </label>

        <div>
          <div className="tplpg-field__label">Auto-prepare every</div>
          <div className="tplpg-dow-chips">
            <button
              type="button"
              onClick={() => setScheduleDow(null)}
              className={`tplpg-dow-chip${scheduleDow === null ? " tplpg-dow-chip--active" : ""}`}
              disabled={submitting}
            >
              Never
            </button>
            {DOW_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => setScheduleDow(idx)}
                className={`tplpg-dow-chip${scheduleDow === idx ? " tplpg-dow-chip--active" : ""}`}
                disabled={submitting}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="tplpg-field__label">Bottles ({items.length})</div>
          <ul className="tplpg-edit-items">
            {items.map((it) => (
              <li key={it.mlcc_code} className="tplpg-edit-item">
                <div className="tplpg-edit-item__main">
                  <div className="tplpg-edit-item__name">
                    {it.name ?? it.mlcc_code}
                  </div>
                  <div className="tplpg-edit-item__meta">
                    {it.bottle_size_ml ? `${it.bottle_size_ml} mL · ` : ""}#
                    {it.mlcc_code}
                  </div>
                </div>
                <div className="tplpg-edit-item__qty">
                  <button
                    type="button"
                    onClick={() => changeQty(it.mlcc_code, -1)}
                    disabled={submitting}
                    aria-label="Decrease"
                    className="tplpg-step-btn"
                  >
                    −
                  </button>
                  <span className="tplpg-edit-item__qty-val">{it.quantity}</span>
                  <button
                    type="button"
                    onClick={() => changeQty(it.mlcc_code, 1)}
                    disabled={submitting}
                    aria-label="Increase"
                    className="tplpg-step-btn"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(it.mlcc_code)}
                  disabled={submitting}
                  aria-label={`Remove ${it.name ?? it.mlcc_code}`}
                  className="tplpg-edit-item__remove"
                >
                  <IconTrash size={16} strokeWidth={1.85} />
                </button>
              </li>
            ))}
            {items.length === 0 ? (
              <li className="tplpg-edit-item__empty">
                No bottles yet — search below to add some.
              </li>
            ) : null}
          </ul>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Add a bottle — search by name or code"
            className="tplpg-input"
            disabled={submitting}
            autoComplete="off"
          />
          {searching ? (
            <div className="tplpg-search-hint">Searching…</div>
          ) : null}
          {results.length > 0 ? (
            <ul className="tplpg-search-results">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addProduct(p)}
                    disabled={submitting}
                    className="tplpg-search-result"
                  >
                    <span className="tplpg-search-result__main">
                      <span className="tplpg-search-result__name">{p.name}</span>
                      <span className="tplpg-search-result__size">
                        {/* material + pack (2026-07-12 class sweep): a
                            template line becomes a future order line —
                            same identity truth as the cart. */}
                        {p.bottle_size_label ??
                          (p.bottle_size_ml ? `${p.bottle_size_ml} mL` : "")}
                        {nonGlassContainerSuffix(p.container)}
                        {packCountSuffix(p.pack_count)}
                      </span>
                    </span>
                    <span className="tplpg-search-result__add" aria-hidden>
                      +
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {err ? <div className="tplpg-error tplpg-error--inline">{err}</div> : null}

        <div className="confirm-actions">
          <button
            type="button"
            onClick={onClose}
            className="btn secondary"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn primary"
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
