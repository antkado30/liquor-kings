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
 * verification) — delete shows a confirm step; discipline #5 (loud
 * failures) — load errors surface a clear message, not a silent fail.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  archiveOrderTemplate,
  listOrderTemplates,
  loadOrderTemplate,
  updateOrderTemplate,
  type OrderTemplate,
} from "../api/orderTemplates";
import { useCart } from "../hooks/useCart";
import { IconCalendar, IconTrash } from "../components/Icons";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function TemplatesPage() {
  const navigate = useNavigate();
  const cart = useCart();
  const [templates, setTemplates] = useState<OrderTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrderTemplate | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OrderTemplate | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const r = await listOrderTemplates();
    if (r.ok) {
      // Sort: needs_review first, then alphabetical
      const sorted = [...r.data].sort((a, b) => {
        if (a.needs_review !== b.needs_review) {
          return a.needs_review ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      setTemplates(sorted);
    } else {
      setError(r.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleLoad(t: OrderTemplate) {
    setLoadingId(t.id);
    setError(null);
    const r = await loadOrderTemplate(t.id);
    setLoadingId(null);
    if (!r.ok) {
      setError(`Couldn't load "${t.name}": ${r.error}`);
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
      setError(`Couldn't delete "${t.name}": ${r.error}`);
      return;
    }
    setToast(`Deleted "${t.name}"`);
    setTimeout(() => setToast(null), 2500);
    void refresh();
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>Templates</h1>
        <p style={subtitleStyle}>
          Save your weekly cart as a reusable template. Schedule one to
          auto-prepare every week.
        </p>
      </header>

      {error ? <div style={errorBannerStyle}>{error}</div> : null}

      {templates === null ? (
        <div style={emptyStyle}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={emptyCardStyle}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "rgba(58, 130, 247, 0.1)",
              color: "#b9d1ff",
              marginBottom: 12,
            }}
          >
            <IconCalendar size={28} strokeWidth={1.75} />
          </div>
          <div style={emptyTitleStyle}>No templates yet</div>
          <p style={emptyBlurbStyle}>
            Build a cart, then tap &ldquo;Save as template&rdquo; to add
            it here. Templates remember your bottles + quantities so you
            can reload them every week with one tap.
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={primaryBtnStyle}
          >
            Go to Scan
          </button>
        </div>
      ) : (
        <ul style={listStyle}>
          {templates.map((t) => {
            const totalQty = t.items.reduce((s, i) => s + i.quantity, 0);
            const scheduleLabel =
              t.schedule_dow != null
                ? `Auto every ${DOW_LABELS[t.schedule_dow]}`
                : "Manual";
            const isLoading = loadingId === t.id;
            return (
              <li key={t.id} style={cardStyle}>
                <div style={cardHeadStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={cardTitleRowStyle}>
                      <span style={cardTitleStyle}>{t.name}</span>
                      {t.needs_review ? (
                        <span style={reviewBadgeStyle}>● Ready to review</span>
                      ) : null}
                    </div>
                    <div style={cardMetaStyle}>
                      <span style={chipStyle}>{scheduleLabel}</span>
                      <span style={metaDotStyle}>·</span>
                      <span>
                        {totalQty} bottle{totalQty === 1 ? "" : "s"} ·{" "}
                        {t.items.length} line{t.items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {t.last_loaded_at ? (
                      <div style={cardLastLoadedStyle}>
                        Last loaded {formatRelative(t.last_loaded_at)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={cardActionsStyle}>
                  <button
                    type="button"
                    onClick={() => handleLoad(t)}
                    disabled={isLoading}
                    style={loadBtnStyle}
                  >
                    {isLoading ? "Loading…" : "Load into cart"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    style={secondaryBtnStyle}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(t)}
                    style={dangerBtnStyle}
                    aria-label={`Delete ${t.name}`}
                  >
                    <IconTrash size={18} strokeWidth={1.85} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {toast ? <div style={toastStyle}>{toast}</div> : null}

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
        <div
          role="dialog"
          aria-modal="true"
          style={backdropStyle}
          onClick={() => setConfirmDelete(null)}
        >
          <div style={confirmCardStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={confirmTitleStyle}>Delete this template?</h2>
            <p style={confirmBodyStyle}>
              &ldquo;{confirmDelete.name}&rdquo; will be removed. Templates
              are archived, not hard-deleted — they won&apos;t be
              recoverable from the UI but the data stays on our side for
              audit. (Doctrine #7.)
            </p>
            <div style={confirmActionsStyle}>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                style={secondaryBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDelete)}
                style={dangerSolidBtnStyle}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const [name, setName] = useState(template.name);
  const [scheduleDow, setScheduleDow] = useState<number | null>(
    template.schedule_dow ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setErr(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Name can't be blank.");
      return;
    }
    setSubmitting(true);
    const r = await updateOrderTemplate(template.id, {
      name: trimmed,
      schedule_dow: scheduleDow,
    });
    setSubmitting(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    onSaved();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={backdropStyle}
      onClick={onClose}
    >
      <div style={editCardStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={confirmTitleStyle}>Edit template</h2>

        <label style={editLabelStyle}>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={editInputStyle}
            disabled={submitting}
          />
        </label>

        <div>
          <div style={editLabelStyle}>Auto-prepare every</div>
          <div style={dowChipRowStyle}>
            <button
              type="button"
              onClick={() => setScheduleDow(null)}
              style={{
                ...dowChipStyle,
                ...(scheduleDow === null ? dowChipActiveStyle : {}),
              }}
              disabled={submitting}
            >
              Never
            </button>
            {DOW_LABELS.map((label, idx) => (
              <button
                key={label}
                type="button"
                onClick={() => setScheduleDow(idx)}
                style={{
                  ...dowChipStyle,
                  ...(scheduleDow === idx ? dowChipActiveStyle : {}),
                }}
                disabled={submitting}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {err ? <div style={errorBannerStyle}>{err}</div> : null}

        <div style={confirmActionsStyle}>
          <button
            type="button"
            onClick={onClose}
            style={secondaryBtnStyle}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={primaryBtnStyle}
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

/* ─── styles ──────────────────────────────────────────────────────────── */

const pageStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "18px 16px 110px",
  color: "#fff",
};

const headerStyle: React.CSSProperties = {
  marginBottom: 18,
};

const titleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  margin: "0 0 4px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.6)",
  margin: 0,
  lineHeight: 1.5,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: "14px 14px 12px",
};

const cardHeadStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
};

const cardTitleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  lineHeight: 1.25,
};

const reviewBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#fde6b3",
  background: "rgba(245, 158, 11, 0.18)",
  border: "1px solid rgba(245, 158, 11, 0.4)",
  borderRadius: 999,
  padding: "2px 8px",
  fontWeight: 700,
};

const cardMetaStyle: React.CSSProperties = {
  marginTop: 6,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  fontSize: 12,
  color: "rgba(255,255,255,0.65)",
};

const chipStyle: React.CSSProperties = {
  background: "rgba(58,130,247,0.13)",
  border: "1px solid rgba(58,130,247,0.32)",
  color: "#b9d1ff",
  fontWeight: 700,
  fontSize: 12,
  padding: "3px 9px",
  borderRadius: 999,
};

const metaDotStyle: React.CSSProperties = {
  opacity: 0.4,
};

const cardLastLoadedStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: "rgba(255,255,255,0.4)",
};

const cardActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 12,
};

const loadBtnStyle: React.CSSProperties = {
  flex: 1.4,
  background: "#3a82f7",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#fff",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "#3a82f7",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "12px 18px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const dangerBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ff7a7a",
  border: "1px solid rgba(255, 122, 122, 0.3)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 16,
  cursor: "pointer",
};

const dangerSolidBtnStyle: React.CSSProperties = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "12px 16px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const emptyStyle: React.CSSProperties = {
  padding: 30,
  textAlign: "center",
  color: "rgba(255,255,255,0.5)",
};

const emptyCardStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 14,
  padding: 24,
  textAlign: "center",
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  marginBottom: 6,
};

const emptyBlurbStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.6)",
  lineHeight: 1.5,
  margin: "0 0 16px",
};

const errorBannerStyle: React.CSSProperties = {
  background: "rgba(244, 63, 94, 0.1)",
  border: "1px solid rgba(244, 63, 94, 0.3)",
  color: "#fda4af",
  padding: 12,
  borderRadius: 10,
  fontSize: 13,
  marginBottom: 14,
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 100,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(11, 13, 18, 0.96)",
  color: "#fff",
  padding: "12px 18px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.12)",
  zIndex: 95,
  maxWidth: "90%",
  textAlign: "center",
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(6, 8, 12, 0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
  padding: 20,
};

const confirmCardStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 22,
  maxWidth: 440,
  width: "100%",
  color: "#fff",
};

const editCardStyle: React.CSSProperties = {
  ...confirmCardStyle,
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const confirmTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  margin: "0 0 8px",
};

const confirmBodyStyle: React.CSSProperties = {
  fontSize: 14,
  color: "rgba(255,255,255,0.7)",
  lineHeight: 1.5,
  margin: "0 0 18px",
};

const confirmActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

const editLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "rgba(255,255,255,0.85)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const editInputStyle: React.CSSProperties = {
  background: "#0d1017",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#fff",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 15,
  fontWeight: 500,
};

const dowChipRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 6,
};

const dowChipStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.16)",
  color: "#fff",
  borderRadius: 999,
  padding: "7px 12px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const dowChipActiveStyle: React.CSSProperties = {
  background: "rgba(58, 130, 247, 0.2)",
  borderColor: "#3a82f7",
};
