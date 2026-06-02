/**
 * OrderDetailPage — full breakdown of a single MILO confirmation
 * (task #41, 2026-06-02). Renders confirmation #, order #, delivery
 * date, totals, and the full line-item list.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getOrder, type MiloOrderDetail } from "../api/orders";

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
  const [order, setOrder] = useState<MiloOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    </div>
  );
}
