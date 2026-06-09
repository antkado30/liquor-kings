/**
 * OrdersPage — historical MILO order confirmations (task #41,
 * 2026-06-02). Reads from /orders (milo_order_confirmations).
 *
 * Cached via useCachedResource for instant tab reopen; paginates
 * with loadMore + listOrders cursor.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getOrdersSummary,
  listOrders,
  type MiloOrderListItem,
  type OrdersSummary,
} from "../api/orders";
import {
  IconBarChart,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardList,
  IconLoader,
  IconStore,
} from "../components/Icons";
import { useCachedResource } from "../lib/swr";
import { getCurrentStoreId } from "../lib/currentStore";

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function moneyPrecise(n: number | null | undefined): string {
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

function orderTimestamp(o: MiloOrderListItem): string {
  return o.placed_at ?? o.submitted_at;
}

function formatDayHeader(day: string): string {
  if (day === "unknown") return "Unknown date";
  const todayKey = dayKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dayKey(yesterday.toISOString());
  if (day === todayKey) return "Today";
  if (day === yesterdayKey) return "Yesterday";
  return shortDate(day);
}

function startOfThisWeekLocal(): Date {
  const now = new Date();
  const day = now.getDay();
  const daysToMonday = day === 0 ? 6 : day - 1;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysToMonday);
  return start;
}

function startOfThisMonthLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

type DateFilter = "all" | "week" | "month";

type OrdersData = {
  orders: MiloOrderListItem[];
  summary: OrdersSummary | null;
  cursor: string | null;
  hasMore: boolean;
};

export function OrdersPage() {
  const navigate = useNavigate();
  const storeId = getCurrentStoreId() ?? "none";
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [adaFilter, setAdaFilter] = useState<string | null>(null);

  const res = useCachedResource<OrdersData>(`orders:${storeId}`, async () => {
    const [listRes, sumRes] = await Promise.all([
      listOrders({ limit: 25 }),
      getOrdersSummary(),
    ]);
    if (!listRes.ok) throw new Error(listRes.error);
    return {
      orders: listRes.orders,
      summary: sumRes.ok ? sumRes.summary : null,
      cursor: listRes.nextCursor,
      hasMore: Boolean(listRes.nextCursor),
    };
  });

  const orders = res.data?.orders ?? [];
  const summary = res.data?.summary ?? null;
  const cursor = res.data?.cursor ?? null;
  const hasMore = res.data?.hasMore ?? false;
  const loading = res.loading;
  const error = res.error
    ? res.error instanceof Error
      ? res.error.message
      : String(res.error)
    : null;

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || !res.data) return;
    setLoadingMore(true);
    const more = await listOrders({ limit: 25, cursor });
    if (more.ok) {
      res.mutate({
        ...res.data,
        orders: [...res.data.orders, ...more.orders],
        cursor: more.nextCursor,
        hasMore: Boolean(more.nextCursor),
      });
    }
    setLoadingMore(false);
  }, [cursor, loadingMore, res]);

  const adaOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      const key = (o.ada_number ?? o.ada_name ?? o.distributor_raw ?? "unknown").trim();
      if (!key || map.has(key)) continue;
      map.set(
        key,
        o.ada_name || o.distributor_raw || (o.ada_number ? `ADA ${o.ada_number}` : "Unknown"),
      );
    }
    return [...map.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let list = orders;
    const weekStart = startOfThisWeekLocal();
    const monthStart = startOfThisMonthLocal();

    if (dateFilter === "week") {
      list = list.filter((o) => new Date(orderTimestamp(o)) >= weekStart);
    } else if (dateFilter === "month") {
      list = list.filter((o) => new Date(orderTimestamp(o)) >= monthStart);
    }

    if (adaFilter) {
      list = list.filter((o) => {
        const key = (o.ada_number ?? o.ada_name ?? o.distributor_raw ?? "unknown").trim();
        return key === adaFilter;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        const ada = (o.ada_name || o.distributor_raw || "").toLowerCase();
        const conf = (o.confirmation_number || "").toLowerCase();
        const ord = (o.order_number || "").toLowerCase();
        return ada.includes(q) || conf.includes(q) || ord.includes(q);
      });
    }

    return list;
  }, [orders, dateFilter, adaFilter, searchQuery]);

  const grouped = useMemo(() => {
    const out: Array<{ day: string; rows: MiloOrderListItem[] }> = [];
    for (const o of filteredOrders) {
      const key = dayKey(orderTimestamp(o));
      const last = out[out.length - 1];
      if (last && last.day === key) {
        last.rows.push(o);
      } else {
        out.push({ day: key, rows: [o] });
      }
    }
    return out;
  }, [filteredOrders]);

  const hasActiveFilters =
    dateFilter !== "all" || adaFilter != null || searchQuery.trim().length > 0;
  const showEmpty =
    !loading && !error && orders.length === 0 && !hasActiveFilters;
  const showNoMatches =
    !loading && !error && orders.length > 0 && filteredOrders.length === 0;

  return (
    <div className="page-shell orders-page">
      <header className="page-header">
        <Link to="/" className="page-header__back" aria-label="Back to scanner">
          <IconChevronLeft size={20} strokeWidth={2} />
        </Link>
        <h1>Orders</h1>
      </header>

      {summary ? (
        <section className="orders-stats" aria-label="Last 30 days summary">
          <div className="orders-stat orders-stat--highlight">
            <div className="orders-stat__head">
              <IconBarChart size={14} strokeWidth={2} aria-hidden />
              Net spend
            </div>
            <div className="orders-stat__value">{moneyPrecise(summary.netSpend)}</div>
            <div className="orders-stat__meta">Last 30 days</div>
          </div>
          <div className="orders-stat">
            <div className="orders-stat__head">
              <IconCalendar size={14} strokeWidth={2} aria-hidden />
              Orders
            </div>
            <div className="orders-stat__value">{summary.distinctOrders}</div>
            <div className="orders-stat__meta">Distinct (30d)</div>
          </div>
          <div className="orders-stat">
            <div className="orders-stat__head">
              <IconClipboardList size={14} strokeWidth={2} aria-hidden />
              Confirmations
            </div>
            <div className="orders-stat__value">{summary.totalConfirmations}</div>
            <div className="orders-stat__meta">Submitted (30d)</div>
          </div>
        </section>
      ) : null}

      {!loading && orders.length > 0 ? (
        <div className="orders-toolbar">
          <label className="orders-search">
            <span className="visually-hidden">Search orders</span>
            <input
              type="search"
              className="orders-search__input"
              placeholder="Search ADA, confirmation #, order #…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>

          <div className="orders-chips" role="group" aria-label="Date filter">
            {(
              [
                ["all", "All"],
                ["week", "This week"],
                ["month", "This month"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`orders-chip${dateFilter === value ? " orders-chip--active" : ""}`}
                onClick={() => setDateFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {adaOptions.length > 1 ? (
            <div
              className="orders-chips orders-chips--ada"
              role="group"
              aria-label="Distributor filter"
            >
              <button
                type="button"
                className={`orders-chip${adaFilter == null ? " orders-chip--active" : ""}`}
                onClick={() => setAdaFilter(null)}
              >
                All distributors
              </button>
              {adaOptions.map((ada) => (
                <button
                  key={ada.key}
                  type="button"
                  className={`orders-chip${adaFilter === ada.key ? " orders-chip--active" : ""}`}
                  onClick={() => setAdaFilter(ada.key)}
                >
                  {ada.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {loading && !res.data ? (
        <div className="orders-loading">
          <span className="settings-spinner" aria-hidden>
            <IconLoader size={28} strokeWidth={2} />
          </span>
          <p className="muted">Loading order history…</p>
        </div>
      ) : null}

      {error ? (
        <div className="orders-error">
          <div className="banner banner-err">
            Couldn&apos;t load orders: {error}
          </div>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void res.refresh()}
            disabled={res.isValidating}
          >
            {res.isValidating ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="orders-empty">
          <span className="orders-empty__icon" aria-hidden>
            <IconStore size={26} strokeWidth={1.9} />
          </span>
          <h2 className="orders-empty__title">No orders yet</h2>
          <p className="orders-empty__copy">
            Your first MLCC submission lands here — confirmations, spend, and
            line items in one place.
          </p>
        </div>
      ) : null}

      {showNoMatches ? (
        <div className="orders-empty orders-empty--compact">
          <p className="orders-empty__copy">
            No orders match your search or filters. Try clearing filters or load
            older orders below.
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setSearchQuery("");
                setDateFilter("all");
                setAdaFilter(null);
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="orders-list">
        {grouped.map((g) => (
          <section key={g.day} className="orders-day-group">
            <h2 className="orders-day-header">
              <span className="orders-day-header__label">{formatDayHeader(g.day)}</span>
              <span className="orders-day-header__count">
                {g.rows.length} confirmation{g.rows.length === 1 ? "" : "s"}
              </span>
            </h2>
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
                  <div className="orders-row__meta muted small">
                    <span>Conf #{o.confirmation_number}</span>
                    {o.order_number ? (
                      <>
                        <span className="orders-row__dot" aria-hidden>
                          ·
                        </span>
                        <span>Order #{o.order_number}</span>
                      </>
                    ) : null}
                    {o.delivery_date ? (
                      <>
                        <span className="orders-row__dot" aria-hidden>
                          ·
                        </span>
                        <span>Delivery {shortDate(o.delivery_date)}</span>
                      </>
                    ) : null}
                    {o.line_item_count ? (
                      <>
                        <span className="orders-row__dot" aria-hidden>
                          ·
                        </span>
                        <span>
                          {o.line_item_count} line
                          {o.line_item_count === 1 ? "" : "s"}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="orders-row__right">
                  <strong>{money(o.net_total ?? o.gross_total)}</strong>
                  <IconChevronRight
                    size={18}
                    strokeWidth={2}
                    className="orders-row__chevron"
                    aria-hidden
                  />
                </div>
              </button>
            ))}
          </section>
        ))}
      </div>

      {hasMore && !loading ? (
        <button
          type="button"
          className="orders-load-more btn secondary btn-block"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Load older orders"}
        </button>
      ) : null}
    </div>
  );
}
