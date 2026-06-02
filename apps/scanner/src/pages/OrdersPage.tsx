/**
 * OrdersPage — historical MILO order confirmations (task #41,
 * 2026-06-02). Reads from /orders (the new milo_order_confirmations
 * table) instead of grepping execution_runs evidence jsonb.
 *
 * Layout: a summary card (last 30 days net spend + order count), then
 * a list of confirmations grouped visually by placed-at date. Tap a
 * row to open the detail page.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getOrdersSummary,
  listOrders,
  type MiloOrderListItem,
  type OrdersSummary,
} from "../api/orders";

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

function dayKey(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
}

export function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<MiloOrderListItem[]>([]);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [listRes, sumRes] = await Promise.all([
      listOrders({ limit: 25 }),
      getOrdersSummary(),
    ]);
    if (listRes.ok) {
      setOrders(listRes.orders);
      setCursor(listRes.nextCursor);
      setHasMore(Boolean(listRes.nextCursor));
    } else {
      setError(listRes.error);
    }
    if (sumRes.ok) {
      setSummary(sumRes.summary);
    }
    setLoading(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await listOrders({ limit: 25, cursor });
    if (res.ok) {
      setOrders((prev) => [...prev, ...res.orders]);
      setCursor(res.nextCursor);
      setHasMore(Boolean(res.nextCursor));
    } else {
      setError(res.error);
    }
    setLoadingMore(false);
  }, [cursor, loadingMore]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  /*
    Group rows by placed-at day so the list reads chronologically.
    Each group shows the date as a header, then the rows underneath.
  */
  const grouped: Array<{ day: string; rows: MiloOrderListItem[] }> = [];
  for (const o of orders) {
    const key = dayKey(o.placed_at ?? o.submitted_at);
    const last = grouped[grouped.length - 1];
    if (last && last.day === key) {
      last.rows.push(o);
    } else {
      grouped.push({ day: key, rows: [o] });
    }
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <Link to="/" className="page-header__back" aria-label="Back to scanner">
          ←
        </Link>
        <h1>Orders</h1>
      </header>

      {summary ? (
        <section className="orders-summary">
          <div className="orders-summary__metric">
            <span className="orders-summary__label">Net spend (30d)</span>
            <strong>{money(summary.netSpend)}</strong>
          </div>
          <div className="orders-summary__metric">
            <span className="orders-summary__label">Orders (30d)</span>
            <strong>{summary.distinctOrders}</strong>
          </div>
          <div className="orders-summary__metric">
            <span className="orders-summary__label">Confirmations</span>
            <strong>{summary.totalConfirmations}</strong>
          </div>
        </section>
      ) : null}

      {loading ? (
        <p className="muted small" style={{ padding: 24, textAlign: "center" }}>
          Loading orders…
        </p>
      ) : null}

      {error ? (
        <div className="banner banner-err">
          Couldn&apos;t load orders: {error}
        </div>
      ) : null}

      {!loading && orders.length === 0 && !error ? (
        <div className="banner banner-warn" style={{ marginTop: 16 }}>
          No orders yet. Your first MLCC submission will land here.
        </div>
      ) : null}

      <div className="orders-list">
        {grouped.map((g) => (
          <section key={g.day} className="orders-day-group">
            <h2 className="orders-day-header">{shortDate(g.day)}</h2>
            {g.rows.map((o) => (
              <button
                type="button"
                key={o.id}
                className="orders-row"
                onClick={() => navigate(`/orders/${o.id}`)}
              >
                <div className="orders-row__left">
                  <div className="orders-row__ada">
                    {o.ada_name || o.distributor_raw || "Unknown ADA"}
                  </div>
                  <div className="muted small">
                    #{o.confirmation_number}
                    {o.delivery_date ? (
                      <>
                        {" · "}
                        Delivery {shortDate(o.delivery_date)}
                      </>
                    ) : null}
                    {o.line_item_count ? (
                      <>
                        {" · "}
                        {o.line_item_count} line
                        {o.line_item_count === 1 ? "" : "s"}
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="orders-row__right">
                  <strong>{money(o.net_total ?? o.gross_total)}</strong>
                  <span className="muted small">→</span>
                </div>
              </button>
            ))}
          </section>
        ))}
      </div>

      {hasMore && !loading ? (
        <button
          type="button"
          className="btn secondary btn-block"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          style={{ marginTop: 12 }}
        >
          {loadingMore ? "Loading…" : "Load older orders"}
        </button>
      ) : null}
    </div>
  );
}
