/**
 * AnalyticsDashboard (task #77, 2026-06-06).
 *
 * Dad's "morning view" — gives him a real read on his business at a
 * glance. Shows: this week's spend + week-over-week change, ADA
 * breakdown, top SKUs by units AND dollars, biggest movers vs. the
 * trailing 4-week average.
 *
 * Loads once on mount via GET /home/analytics. Hidden by default —
 * dad taps the "View dashboard" button on home to expand it. We don't
 * make it the very first thing he sees because the camera scanner is
 * still the primary action; the dashboard is the secondary "what's
 * going on with the business" view.
 *
 * Empty-state friendly: brand-new stores with no orders see "no
 * orders yet — your dashboard fills in as you submit through LK."
 */
import { useEffect, useState } from "react";
import {
  getAnalytics,
  type AnalyticsDashboard as DashData,
} from "../api/home";
import { useHideTabBar } from "../hooks/useHideTabBar";

function money(n: number): string {
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

function trendColor(pct: number | null): string {
  if (pct == null) return "var(--muted, #888)";
  if (pct > 5) return "#86efac"; // up — green
  if (pct < -5) return "#fca5a5"; // down — red
  return "var(--muted, #888)"; // flat
}

export function AnalyticsDashboard({
  onClose,
}: {
  onClose: () => void;
}) {
  // Hide tab bar — dashboard is full-screen, tab bar would overlap.
  useHideTabBar();
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAnalytics().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setData(r.data);
      } else {
        setError(r.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Analytics dashboard"
        style={{ overflowY: "auto" }}
      >
        <div className="drawer-header">
          <h2>📊 Dashboard</h2>
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close dashboard"
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="muted" style={{ padding: 24, textAlign: "center" }}>
            Loading your week…
          </p>
        ) : error ? (
          <div className="banner banner-err" style={{ margin: 16 }}>
            Couldn&apos;t load: {error}
          </div>
        ) : !data ? null : (
          <div style={{ padding: "0 16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Headline: this week's spend + WoW */}
            <div
              style={{
                padding: 16,
                background: "linear-gradient(135deg, rgba(108,99,255,0.18), rgba(34,197,94,0.10))",
                border: "1px solid rgba(108,99,255,0.32)",
                borderRadius: 10,
              }}
            >
              <div className="muted small" style={{ marginBottom: 4 }}>
                This week
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>
                {money(data.this_week.spend)}
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: trendColor(data.wow_change_pct),
                  }}
                >
                  {fmtPct(data.wow_change_pct)} vs last week
                </span>
                <span className="muted small">
                  ({money(data.last_week.spend)})
                </span>
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>
                {data.this_week.order_count} order{data.this_week.order_count === 1 ? "" : "s"}
                {" · "}
                {data.this_week.bottle_count} bottle{data.this_week.bottle_count === 1 ? "" : "s"}
              </div>
            </div>

            {data.this_week.order_count === 0 ? (
              <p className="muted small" style={{ textAlign: "center", padding: 16 }}>
                No orders yet this week. Your dashboard fills in as you submit through LK.
              </p>
            ) : null}

            {/* ADA breakdown */}
            {data.this_week.ada_breakdown.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  By distributor (this week)
                </h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.this_week.ada_breakdown.map((ada) => (
                    <li
                      key={ada.ada_number}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{ada.ada_name || `ADA ${ada.ada_number}`}</div>
                        <div className="muted small">{ada.orders} order{ada.orders === 1 ? "" : "s"}</div>
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {money(ada.net_total)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Biggest movers — the punch-line metric */}
            {data.biggest_movers.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  📈 Biggest movers
                </h3>
                <p className="muted small" style={{ marginBottom: 8 }}>
                  Vs your 4-week average
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.biggest_movers.map((m) => (
                    <li
                      key={m.code}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.name}
                        </div>
                        <div className="muted small">
                          {m.this_week_units} this week · avg {m.avg_weekly_units}
                        </div>
                      </div>
                      <div
                        style={{
                          fontWeight: 700,
                          color: trendColor(m.change_pct),
                          fontVariantNumeric: "tabular-nums",
                          minWidth: 60,
                          textAlign: "right",
                        }}
                      >
                        {fmtPct(m.change_pct)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Top SKUs — last 90 days */}
            {data.top_by_units.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  🥇 Top by units (last 90 days)
                </h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.top_by_units.map((s, i) => (
                    <li
                      key={s.code}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flex: 1 }}>
                        <span className="muted small" style={{ minWidth: 18 }}>#{i + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}
                          </div>
                          <div className="muted small">{money(s.dollars)}</div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {s.units}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Top SKUs by dollars */}
            {data.top_by_dollars.length > 0 ? (
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  💰 Top by spend (last 90 days)
                </h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.top_by_dollars.map((s, i) => (
                    <li
                      key={s.code}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flex: 1 }}>
                        <span className="muted small" style={{ minWidth: 18 }}>#{i + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}
                          </div>
                          <div className="muted small">{s.units} units</div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {money(s.dollars)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="muted small" style={{ textAlign: "center", marginTop: 16 }}>
              Data from your last 90 days of LK-submitted orders.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
