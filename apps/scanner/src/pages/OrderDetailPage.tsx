/**
 * OrderDetailPage — full breakdown of a single MILO confirmation
 * (task #41, 2026-06-02). Renders confirmation #, order #, delivery
 * date, totals, and the full line-item list.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, type MiloOrderDetail } from "../api/orders";
import { getProductFamily } from "../api/catalog";
import { fetchTagsHtml } from "../api/tags";
import { useCart } from "../hooks/useCart";
import { TagPrintPreview } from "../components/TagPrintPreview";
import {
  IconAlert,
  IconBarChart,
  IconCalendar,
  IconChevronLeft,
  IconClipboardList,
  IconLoader,
  IconPackage,
  IconStore,
} from "../components/Icons";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(n));
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSize(ml: number | null | undefined): string | null {
  if (ml == null || !Number.isFinite(Number(ml))) return null;
  return `${ml} mL`;
}

function DetailShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page-shell order-detail-page">
      <header className="page-header">
        <Link to="/orders" className="page-header__back" aria-label="Back to orders">
          <IconChevronLeft size={20} strokeWidth={2} />
        </Link>
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const cart = useCart();
  const [order, setOrder] = useState<MiloOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tagsHtml, setTagsHtml] = useState<string | null>(null);
  const [printingTags, setPrintingTags] = useState(false);

  async function printAllTags(items: MiloOrderDetail["line_items"]) {
    const codes = (Array.isArray(items) ? items : [])
      .map((li) => (li.liquorCode ? String(li.liquorCode) : ""))
      .filter((c) => c.length > 0);
    if (codes.length === 0) {
      setToast("No printable codes on this order.");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    setPrintingTags(true);
    const res = await fetchTagsHtml(codes);
    setPrintingTags(false);
    if (!res.ok) {
      setToast(`Couldn't build tags — ${res.error}`);
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setTagsHtml(res.html);
  }

  async function reorderAll(items: MiloOrderDetail["line_items"]) {
    const lines = (Array.isArray(items) ? items : []).filter(
      (li) => li.liquorCode && Number(li.quantity) > 0,
    );
    setReordering(true);
    let added = 0;
    let skipped = (Array.isArray(items) ? items.length : 0) - lines.length;
    const resolved = await Promise.all(
      lines.map(async (li) => {
        const code = String(li.liquorCode);
        const fam = await getProductFamily(code);
        const product = fam?.sizes.find((s) => s.code === code) ?? null;
        return { product, qty: Number(li.quantity) };
      }),
    );
    for (const r of resolved) {
      if (r.product) {
        cart.addItem(r.product, r.qty);
        added += 1;
      } else {
        skipped += 1;
      }
    }
    setReordering(false);
    setToast(
      `Added ${added} item${added === 1 ? "" : "s"} to your order` +
        (skipped > 0 ? ` · ${skipped} no longer in catalog` : ""),
    );
    setTimeout(() => navigate("/?view=cart"), 900);
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    void getOrder(id).then((r) => {
      if (r.ok) setOrder(r.order);
      else setError(r.error);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <DetailShell title="Order">
        <div className="order-detail-loading">
          <span className="settings-spinner" aria-hidden>
            <IconLoader size={28} strokeWidth={2} />
          </span>
          <p className="muted">Loading order…</p>
        </div>
      </DetailShell>
    );
  }

  if (error || !order) {
    return (
      <DetailShell title="Order">
        <div className="order-detail-error">
          <p className="banner banner-err" role="alert">
            <IconAlert
              size={16}
              strokeWidth={2}
              style={{ verticalAlign: "middle", marginRight: 8 }}
              aria-hidden
            />
            {error ?? "Order not found."}
          </p>
          <button
            type="button"
            className="btn secondary btn-block"
            onClick={() => navigate("/orders")}
          >
            Back to orders
          </button>
        </div>
      </DetailShell>
    );
  }

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const adaLabel = order.ada_name || order.distributor_raw || "Unknown ADA";

  return (
    <DetailShell title={`Conf #${order.confirmation_number}`}>
      <section className="order-detail-hero" aria-label="Order summary">
        <div className="order-detail-hero__ada">
          <span className="order-detail-hero__ada-icon" aria-hidden>
            <IconStore size={18} strokeWidth={1.9} />
          </span>
          {adaLabel}
        </div>
        <dl className="order-detail-hero__meta">
          <div className="order-detail-hero__field">
            <dt>
              <IconClipboardList size={12} strokeWidth={2} aria-hidden />
              Confirmation
            </dt>
            <dd className="mono">{order.confirmation_number}</dd>
          </div>
          {order.order_number ? (
            <div className="order-detail-hero__field">
              <dt>Order #</dt>
              <dd className="mono">{order.order_number}</dd>
            </div>
          ) : null}
          <div className="order-detail-hero__field">
            <dt>
              <IconCalendar size={12} strokeWidth={2} aria-hidden />
              Placed
            </dt>
            <dd>{shortDate(order.placed_at ?? order.submitted_at)}</dd>
          </div>
          {order.delivery_date ? (
            <div className="order-detail-hero__field">
              <dt>Delivery</dt>
              <dd>{shortDate(order.delivery_date)}</dd>
            </div>
          ) : null}
          {order.status_at_placement ? (
            <div className="order-detail-hero__field">
              <dt>Status</dt>
              <dd>{order.status_at_placement}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="orders-stats order-detail-spend" aria-label="Spend summary">
        <div className="orders-stat orders-stat--highlight">
          <div className="orders-stat__head">
            <IconBarChart size={14} strokeWidth={2} aria-hidden />
            Net total
          </div>
          <div className="orders-stat__value">{money(order.net_total)}</div>
          <div className="orders-stat__meta">After tax &amp; discounts</div>
        </div>
        <div className="orders-stat">
          <div className="orders-stat__head">Gross</div>
          <div className="orders-stat__value">{money(order.gross_total)}</div>
          <div className="orders-stat__meta">Before adjustments</div>
        </div>
        <div className="orders-stat">
          <div className="orders-stat__head">
            <IconPackage size={14} strokeWidth={2} aria-hidden />
            Lines
          </div>
          <div className="orders-stat__value">{lineItems.length}</div>
          <div className="orders-stat__meta">
            {order.discount != null
              ? `Discount ${money(order.discount)}`
              : order.liquor_tax != null
                ? `Tax ${money(order.liquor_tax)}`
                : "Line items"}
          </div>
        </div>
      </section>

      {(order.discount != null || order.liquor_tax != null) ? (
        <div className="order-detail-adjustments">
          {order.discount != null ? (
            <span className="order-detail-adjustments__item">
              Discount <strong>{money(order.discount)}</strong>
            </span>
          ) : null}
          {order.liquor_tax != null ? (
            <span className="order-detail-adjustments__item">
              Liquor tax <strong>{money(order.liquor_tax)}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="order-detail-lines-head">
        <h2 className="order-detail-lines-head__title">
          <IconPackage size={16} strokeWidth={2} aria-hidden />
          Line items
        </h2>
        <span className="order-detail-lines-head__count">{lineItems.length}</span>
      </div>

      <ul className="order-detail-line-list">
        {lineItems.map((li, i) => {
          const size = formatSize(li.bottleSizeMl);
          const qty = li.quantity ? Number(li.quantity) : null;
          return (
            <li key={i} className="order-detail-line-card">
              <div className="order-detail-line-card__main">
                <div className="order-detail-line-card__name">
                  {li.productName ?? li.liquorCode ?? "Unknown"}
                </div>
                <div className="order-detail-line-card__meta muted small">
                  {li.liquorCode ? (
                    <span className="mono">#{li.liquorCode}</span>
                  ) : null}
                  {size ? (
                    <>
                      {li.liquorCode ? (
                        <span className="order-detail-line-card__dot" aria-hidden>
                          ·
                        </span>
                      ) : null}
                      <span>{size}</span>
                    </>
                  ) : null}
                  {qty != null && qty > 0 ? (
                    <>
                      <span className="order-detail-line-card__dot" aria-hidden>
                        ·
                      </span>
                      <span>
                        Qty {qty}
                        {li.unitPrice ? ` × ${money(li.unitPrice)}` : ""}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="order-detail-line-card__total">
                {money(li.lineTotal)}
              </div>
            </li>
          );
        })}
      </ul>

      {lineItems.length > 0 ? (
        <div className="order-detail-actions">
          <button
            type="button"
            className="btn primary btn-block"
            disabled={reordering}
            onClick={() => void reorderAll(order.line_items)}
          >
            {reordering ? "Adding to order…" : "Reorder into cart"}
          </button>
          <button
            type="button"
            className="btn secondary btn-block"
            disabled={printingTags}
            onClick={() => void printAllTags(order.line_items)}
          >
            {printingTags
              ? "Building tags…"
              : `Print all shelf tags (${lineItems.length})`}
          </button>
        </div>
      ) : null}

      {tagsHtml ? (
        <TagPrintPreview
          html={tagsHtml}
          mlccCode={
            lineItems.find((li) => li.liquorCode)?.liquorCode
              ? String(lineItems.find((li) => li.liquorCode)?.liquorCode)
              : ""
          }
          onClose={() => setTagsHtml(null)}
        />
      ) : null}

      {toast ? (
        <div className="order-detail-toast" role="status">
          {toast}
        </div>
      ) : null}
    </DetailShell>
  );
}
