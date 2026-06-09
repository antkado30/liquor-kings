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

  // Collect every line's MLCC code and render all shelf tags at once.
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

  // Rebuild this whole order into the cart — resolve each line through the
  // catalog (for ADA + price), add it at the same quantity, then open the cart.
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
      <div className="page-shell">
        <header className="page-header">
          <Link to="/orders" className="page-header__back" aria-label="Back to orders">
            ←
          </Link>
          <h1>Order</h1>
        </header>
        <p className="muted small" style={{ padding: 24 }}>
          Loading order…
        </p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="page-shell">
        <header className="page-header">
          <Link to="/orders" className="page-header__back" aria-label="Back to orders">
            ←
          </Link>
          <h1>Order</h1>
        </header>
        <div className="banner banner-err">
          {error ?? "Order not found."}
        </div>
        <button
          type="button"
          className="btn secondary btn-block"
          onClick={() => navigate("/orders")}
        >
          Back to orders
        </button>
      </div>
    );
  }

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  return (
    <div className="page-shell">
      <header className="page-header">
        <Link to="/orders" className="page-header__back" aria-label="Back to orders">
          ←
        </Link>
        <h1>Order</h1>
      </header>

      <section className="order-detail-summary">
        <div className="order-detail-summary__ada">
          {order.ada_name || order.distributor_raw || "Unknown ADA"}
        </div>
        <dl className="order-detail-meta">
          <div>
            <dt>Confirmation #</dt>
            <dd className="mono">{order.confirmation_number}</dd>
          </div>
          {order.order_number ? (
            <div>
              <dt>Order #</dt>
              <dd className="mono">{order.order_number}</dd>
            </div>
          ) : null}
          <div>
            <dt>Placed</dt>
            <dd>{shortDate(order.placed_at ?? order.submitted_at)}</dd>
          </div>
          {order.delivery_date ? (
            <div>
              <dt>Delivery</dt>
              <dd>{shortDate(order.delivery_date)}</dd>
            </div>
          ) : null}
          {order.status_at_placement ? (
            <div>
              <dt>Status</dt>
              <dd>{order.status_at_placement}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="order-detail-totals">
        <div>
          <span className="muted">Gross</span>
          <strong>{money(order.gross_total)}</strong>
        </div>
        {order.discount != null ? (
          <div>
            <span className="muted">Discount</span>
            <strong>{money(order.discount)}</strong>
          </div>
        ) : null}
        {order.liquor_tax != null ? (
          <div>
            <span className="muted">Tax</span>
            <strong>{money(order.liquor_tax)}</strong>
          </div>
        ) : null}
        <div className="order-detail-totals__net">
          <span className="muted">Net</span>
          <strong>{money(order.net_total)}</strong>
        </div>
      </section>

      <h2 className="order-detail-section-title">
        Line items ({lineItems.length})
      </h2>
      <ul className="order-detail-lines">
        {lineItems.map((li, i) => (
          <li key={i} className="order-detail-line">
            <div className="order-detail-line__main">
              <div className="order-detail-line__name">
                {li.productName ?? li.liquorCode ?? "Unknown"}
              </div>
              <div className="muted small">
                {li.liquorCode ? `#${li.liquorCode}` : ""}
                {li.bottleSizeMl ? ` · ${li.bottleSizeMl} mL` : ""}
                {li.quantity ? ` · qty ${li.quantity}` : ""}
                {li.unitPrice ? ` · ${money(li.unitPrice)} ea` : ""}
              </div>
            </div>
            <div className="order-detail-line__total">
              {money(li.lineTotal)}
            </div>
          </li>
        ))}
      </ul>

      {lineItems.length > 0 ? (
        <button
          type="button"
          className="btn primary btn-block"
          style={{ marginTop: 16 }}
          disabled={reordering}
          onClick={() => void reorderAll(order.line_items)}
        >
          {reordering ? "Adding to order…" : "Reorder into cart"}
        </button>
      ) : null}

      {lineItems.length > 0 ? (
        <button
          type="button"
          className="btn secondary btn-block"
          style={{ marginTop: 8 }}
          disabled={printingTags}
          onClick={() => void printAllTags(order.line_items)}
        >
          {printingTags
            ? "Building tags…"
            : `Print all shelf tags (${lineItems.length})`}
        </button>
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
        <div
          style={{
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
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
