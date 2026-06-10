/**
 * AnalyticsDashboard (task #77, 2026-06-06).
 *
 * Store-owner business intelligence — spend, distributors, top SKUs,
 * and week-over-week trends. Opens from More / ?view=dashboard.
 *
 * Data from GET /home/analytics, cached via useCachedResource so
 * reopening is instant.
 */
import {
  fetchAnalyticsDashboard,
  isAnalyticsEmpty,
  type AnalyticsDashboard as DashData,
} from "../api/home";
import { useHideTabBar } from "../hooks/useHideTabBar";
import { getCurrentStoreId } from "../lib/currentStore";
import { useCachedResource } from "../lib/swr";
import { useLockBodyScroll } from "../hooks/useLockBodyScroll";
import {
  IconBarChart,
  IconCalendar,
  IconPackage,
  IconStore,
  IconX,
} from "./Icons";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function moneyPrecise(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(pct: number | null): string {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

function trendTone(pct: number | null): "up" | "down" | "flat" {
  if (pct == null) return "flat";
  if (pct > 5) return "up";
  if (pct < -5) return "down";
  return "flat";
}

function moverTone(pct: number): "up" | "down" | "flat" {
  if (pct > 5) return "up";
  if (pct < -5) return "down";
  return "flat";
}

function IconTrendUp({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 2.5 2.5 7h7L6 2.5z" />
    </svg>
  );
}

function IconTrendDown({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 9.5 9.5 5h-7L6 9.5z" />
    </svg>
  );
}

function TrendBadge({
  pct,
  label,
}: {
  pct: number | null;
  label?: string;
}) {
  const tone = trendTone(pct);
  return (
    <div className={`andash-trend andash-trend--${tone}`}>
      {tone === "up" ? <IconTrendUp /> : tone === "down" ? <IconTrendDown /> : null}
      <span>{fmtPct(pct)}</span>
      {label ? <span className="andash-trend__label">{label}</span> : null}
    </div>
  );
}

function WeeklySpendChart({
  thisWeek,
  lastWeek,
}: {
  thisWeek: number;
  lastWeek: number;
}) {
  const max = Math.max(thisWeek, lastWeek, 1);
  const barMaxH = 96;
  const thisH = Math.max(4, (thisWeek / max) * barMaxH);
  const lastH = Math.max(4, (lastWeek / max) * barMaxH);
  const w = 280;
  const barW = 72;
  const gap = 48;
  const x1 = (w - barW * 2 - gap) / 2;
  const x2 = x1 + barW + gap;
  const baseY = 120;

  return (
    <div className="andash-chart">
      <svg
        className="andash-chart__svg"
        viewBox={`0 0 ${w} 140`}
        role="img"
        aria-label={`Spend comparison: last week ${moneyPrecise(lastWeek)}, this week ${moneyPrecise(thisWeek)}`}
      >
        <line
          x1={16}
          y1={baseY}
          x2={w - 16}
          y2={baseY}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
        />
        <rect
          x={x1}
          y={baseY - lastH}
          width={barW}
          height={lastH}
          rx={6}
          fill="rgba(148, 163, 184, 0.55)"
        />
        <rect
          x={x2}
          y={baseY - thisH}
          width={barW}
          height={thisH}
          rx={6}
          fill="var(--accent)"
        />
        <text
          x={x1 + barW / 2}
          y={baseY - lastH - 8}
          fill="rgba(255,255,255,0.75)"
          fontSize={11}
          fontWeight={700}
          textAnchor="middle"
        >
          {money(lastWeek)}
        </text>
        <text
          x={x2 + barW / 2}
          y={baseY - thisH - 8}
          fill="#c4b5fd"
          fontSize={11}
          fontWeight={700}
          textAnchor="middle"
        >
          {money(thisWeek)}
        </text>
        <text
          x={x1 + barW / 2}
          y={baseY + 18}
          fill="var(--text-muted)"
          fontSize={11}
          fontWeight={600}
          textAnchor="middle"
        >
          Last week
        </text>
        <text
          x={x2 + barW / 2}
          y={baseY + 18}
          fill="var(--text-muted)"
          fontSize={11}
          fontWeight={600}
          textAnchor="middle"
        >
          This week
        </text>
      </svg>
      <div className="andash-chart__legend">
        <span className="andash-chart__legend-item">
          <span
            className="andash-chart__swatch"
            style={{ background: "rgba(148, 163, 184, 0.55)" }}
          />
          Last week
        </span>
        <span className="andash-chart__legend-item">
          <span
            className="andash-chart__swatch"
            style={{ background: "var(--accent)" }}
          />
          This week
        </span>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="andash-body andash-body--skeleton" aria-hidden>
      <div className="andash-stats">
        <div className="andash-stat andash-stat--highlight andash-shimmer" />
        <div className="andash-stat andash-shimmer" />
        <div className="andash-stat andash-shimmer" />
        <div className="andash-stat andash-shimmer" />
      </div>
      <div className="andash-section">
        <div className="andash-shimmer andash-shimmer--line" />
        <div className="andash-shimmer andash-shimmer--block" />
      </div>
      <div className="andash-section">
        <div className="andash-shimmer andash-shimmer--line" />
        <div className="andash-shimmer andash-shimmer--row" />
        <div className="andash-shimmer andash-shimmer--row" />
        <div className="andash-shimmer andash-shimmer--row" />
      </div>
    </div>
  );
}

function DashboardBody({ data }: { data: DashData }) {
  const empty = isAnalyticsEmpty(data);
  const adaTotal = data.this_week.ada_breakdown.reduce(
    (sum, ada) => sum + ada.net_total,
    0,
  );
  const activeDistributors = data.this_week.ada_breakdown.length;
  const hasWeeklySpend =
    data.this_week.spend > 0 || data.last_week.spend > 0;

  if (empty) {
    return (
      <div className="andash-empty">
        <span className="andash-empty__icon" aria-hidden>
          <IconBarChart size={26} strokeWidth={1.9} />
        </span>
        <h3 className="andash-empty__title">No order history yet</h3>
        <p className="andash-empty__copy">
          Your data shows up here after your first order through Liquor Kings.
        </p>
      </div>
    );
  }

  return (
    <div className="andash-body">
      <section className="andash-stats" aria-label="This week summary">
        <div className="andash-stat andash-stat--highlight">
          <div className="andash-stat__head">
            <IconBarChart size={14} strokeWidth={2} aria-hidden />
            This week&apos;s spend
          </div>
          <div className="andash-stat__value">
            {moneyPrecise(data.this_week.spend)}
          </div>
          <TrendBadge pct={data.wow_change_pct} label="vs last week" />
        </div>

        <div className="andash-stat">
          <div className="andash-stat__head">
            <IconCalendar size={14} strokeWidth={2} aria-hidden />
            Orders
          </div>
          <div className="andash-stat__value">{data.this_week.order_count}</div>
          <div className="andash-stat__meta">Submitted this week</div>
        </div>

        <div className="andash-stat">
          <div className="andash-stat__head">
            <IconPackage size={14} strokeWidth={2} aria-hidden />
            Bottles
          </div>
          <div className="andash-stat__value">{data.this_week.bottle_count}</div>
          <div className="andash-stat__meta">Units ordered this week</div>
        </div>

        <div className="andash-stat">
          <div className="andash-stat__head">
            <IconStore size={14} strokeWidth={2} aria-hidden />
            Distributors
          </div>
          <div className="andash-stat__value">{activeDistributors}</div>
          <div className="andash-stat__meta">Active ADAs this week</div>
        </div>
      </section>

      {hasWeeklySpend ? (
        <section className="andash-section" aria-label="Weekly spend trend">
          <div className="andash-section__head">
            <h3 className="andash-section__title">Weekly spend</h3>
          </div>
          <WeeklySpendChart
            thisWeek={data.this_week.spend}
            lastWeek={data.last_week.spend}
          />
        </section>
      ) : null}

      {data.top_by_units.length > 0 ? (
        <section className="andash-section" aria-label="Top SKUs by units">
          <div className="andash-section__head">
            <h3 className="andash-section__title">Top SKUs</h3>
            <span className="andash-section__subtitle">Last 90 days · by units</span>
          </div>
          <ul className="andash-sku-list">
            {data.top_by_units.map((sku, i) => (
              <li key={sku.code} className="andash-sku-row">
                <span className="andash-sku-row__rank">{i + 1}</span>
                <div className="andash-sku-row__main">
                  <div className="andash-sku-row__name">{sku.name}</div>
                  <div className="andash-sku-row__meta">
                    {sku.orders} order{sku.orders === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="andash-sku-row__nums">
                  <span className="andash-sku-row__qty">{sku.units} units</span>
                  <span className="andash-sku-row__dollars">
                    {moneyPrecise(sku.dollars)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.top_by_dollars.length > 0 ? (
        <section className="andash-section" aria-label="Top SKUs by spend">
          <div className="andash-section__head">
            <h3 className="andash-section__title">Top spend</h3>
            <span className="andash-section__subtitle">Last 90 days · by dollars</span>
          </div>
          <ul className="andash-sku-list">
            {data.top_by_dollars.map((sku, i) => (
              <li key={`${sku.code}-$`} className="andash-sku-row">
                <span className="andash-sku-row__rank">{i + 1}</span>
                <div className="andash-sku-row__main">
                  <div className="andash-sku-row__name">{sku.name}</div>
                  <div className="andash-sku-row__meta">
                    {sku.units} units · {sku.orders} order
                    {sku.orders === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="andash-sku-row__nums">
                  <span className="andash-sku-row__qty">{sku.units} units</span>
                  <span className="andash-sku-row__dollars">
                    {moneyPrecise(sku.dollars)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.biggest_movers.length > 0 ? (
        <section className="andash-section" aria-label="Biggest movers">
          <div className="andash-section__head">
            <h3 className="andash-section__title">Biggest movers</h3>
            <span className="andash-section__subtitle">Vs 4-week average</span>
          </div>
          <ul className="andash-mover-list">
            {data.biggest_movers.map((m) => {
              const tone = moverTone(m.change_pct);
              return (
                <li key={m.code} className="andash-mover-row">
                  <div className="andash-mover-row__main">
                    <div className="andash-mover-row__name">{m.name}</div>
                    <div className="andash-mover-row__meta">
                      {m.this_week_units} this week · avg {m.avg_weekly_units}/wk
                    </div>
                  </div>
                  <span className={`andash-mover-row__change andash-mover-row__change--${tone}`}>
                    {tone === "up" ? <IconTrendUp /> : tone === "down" ? <IconTrendDown /> : null}
                    {fmtPct(m.change_pct)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {data.this_week.ada_breakdown.length > 0 ? (
        <section className="andash-section" aria-label="Distributor breakdown">
          <div className="andash-section__head">
            <h3 className="andash-section__title">ADA breakdown</h3>
            <span className="andash-section__subtitle">This week</span>
          </div>
          <ul className="andash-ada-list">
            {data.this_week.ada_breakdown.map((ada) => {
              const pct =
                adaTotal > 0
                  ? Math.round((ada.net_total / adaTotal) * 100)
                  : 0;
              return (
                <li key={ada.ada_number} className="andash-ada-row">
                  <div className="andash-ada-row__top">
                    <span className="andash-ada-row__name">
                      {ada.ada_name || `ADA ${ada.ada_number}`}
                    </span>
                    <span className="andash-ada-row__amount">
                      {moneyPrecise(ada.net_total)}
                    </span>
                  </div>
                  <div className="andash-ada-row__meta">
                    {ada.orders} order{ada.orders === 1 ? "" : "s"} · {pct}% of
                    spend
                  </div>
                  <div className="andash-ada-row__track">
                    <div
                      className="andash-ada-row__fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className="andash-footnote">
        Based on your last 90 days of LK-submitted orders
        {data.generated_at
          ? ` · updated ${new Date(data.generated_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : ""}
      </p>
    </div>
  );
}

export function AnalyticsDashboard({ onClose }: { onClose: () => void }) {
  useHideTabBar();
  useLockBodyScroll();
  const storeId = getCurrentStoreId() ?? "none";

  const analyticsRes = useCachedResource<DashData>(
    `analytics:${storeId}`,
    fetchAnalyticsDashboard,
    300_000,
  );

  const error =
    analyticsRes.error instanceof Error
      ? analyticsRes.error.message
      : analyticsRes.error
        ? String(analyticsRes.error)
        : null;

  return (
    <div
      className="andash-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="andash-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Analytics dashboard"
      >
        <div className="andash-sheet__grab" aria-hidden="true" />
        <div className="andash-sheet__header">
          <h2 className="andash-sheet__title">
            <span className="andash-sheet__icon" aria-hidden>
              <IconBarChart size={18} strokeWidth={2} />
            </span>
            Dashboard
          </h2>
          <button
            type="button"
            className="andash-sheet__close"
            onClick={onClose}
            aria-label="Close dashboard"
          >
            <IconX size={20} strokeWidth={2} />
          </button>
        </div>

        <div className="andash-sheet__scroll">
          {analyticsRes.loading ? (
            <DashboardSkeleton />
          ) : error ? (
            <div className="andash-error">
              <div className="banner banner-err">
                Couldn&apos;t load dashboard: {error}
              </div>
              <div className="andash-error__actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => void analyticsRes.refresh()}
                  disabled={analyticsRes.isValidating}
                >
                  {analyticsRes.isValidating ? "Retrying…" : "Retry"}
                </button>
              </div>
            </div>
          ) : analyticsRes.data ? (
            <DashboardBody data={analyticsRes.data} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
