/**
 * Founder Console — Tony's god view (task #81, 2026-06-06).
 *
 * "If anything bad happens we know in an instant" — Tony's spec.
 * Single-page dashboard for the founder + future co-founders. Powered
 * by GET /admin/founder-console. Auto-refreshes every 60s so it can
 * sit open on a second monitor.
 *
 * Sections (top to bottom):
 *   1. Stats row — total stores, signups today/week/month, MRR
 *   2. Activity strip — last-7d GMV + confirmation count + active stores
 *   3. Runs panel — last 24h success rate + failure count
 *   4. Recent stores — newest 10 with signup date and status
 *   5. Recent failures — the "needs attention" list
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchFounderConsole,
  fetchSystemHealth,
  type FounderConsoleData,
  type SystemHealth,
} from "../api/founderConsole";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function moneyExact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function FounderConsolePage() {
  const [data, setData] = useState<FounderConsoleData | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, h] = await Promise.all([
      fetchFounderConsole(),
      fetchSystemHealth(),
    ]);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
    if (h.ok) setHealth(h.data);
    setLoading(false);
    setLastFetched(new Date());
  }, []);

  // Initial load + 60s auto-refresh.
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>🏰 Founder Console</h1>
          <p
            className="muted small"
            style={{ margin: "4px 0 0", opacity: 0.7 }}
          >
            Liquor Kings — god view. Auto-refreshes every 60s.
            {lastFetched ? (
              <span style={{ marginLeft: 8 }}>
                Last updated {lastFetched.toLocaleTimeString()}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {/* ─── System health strip — first thing you see ─── */}
      {health ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 20,
            padding: "14px 18px",
            borderRadius: 12,
            border: `1px solid ${health.status === "ok" ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.45)"}`,
            background:
              health.status === "ok"
                ? "rgba(34,197,94,0.08)"
                : "rgba(239,68,68,0.10)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: health.status === "ok" ? "#22c55e" : "#ef4444",
              flexShrink: 0,
              boxShadow: `0 0 10px ${health.status === "ok" ? "#22c55e" : "#ef4444"}`,
            }}
          />
          <strong style={{ fontSize: 16 }}>
            {health.status === "ok"
              ? "All systems healthy"
              : "System degraded — needs attention"}
          </strong>
          {health.reasons.length > 0 ? (
            <span style={{ fontSize: 13, opacity: 0.85 }}>
              {health.reasons.join(" · ")}
            </span>
          ) : null}
          <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
            queued {health.checks.queued} · running {health.checks.running} ·
            stuck {health.checks.stuck} · 24h {health.checks.succeeded24h}✓/
            {health.checks.failed24h}✗ ({100 - health.checks.failureRatePct}% ok)
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="banner banner-err" style={{ marginBottom: 16 }}>
          Load error: {error}
        </div>
      ) : null}

      {data ? (
        <>
          {/* ─── Stats row ─── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <StatCard
              label="Total stores"
              value={data.stores.total.toString()}
              sub={`${data.stores.active} active`}
              tone="purple"
            />
            <StatCard
              label="New today"
              value={data.stores.new_today.toString()}
              sub="signed up"
              tone={data.stores.new_today > 0 ? "green" : "neutral"}
            />
            <StatCard
              label="New this week"
              value={data.stores.new_this_week.toString()}
              sub="signed up"
              tone="neutral"
            />
            <StatCard
              label="Estimated MRR"
              value={money(data.financials.estimated_mrr_usd)}
              sub={`@ ${money(data.financials.price_per_store_usd)} / store`}
              tone="green"
            />
            <StatCard
              label="Active users"
              value={data.users.active.toString()}
              sub="store_users rows"
              tone="neutral"
            />
          </div>

          {/* ─── 7-day activity strip ─── */}
          <section
            style={{
              padding: 20,
              background:
                "linear-gradient(135deg, rgba(108,99,255,0.14), rgba(34,197,94,0.08))",
              border: "1px solid rgba(108,99,255,0.28)",
              borderRadius: 12,
              marginBottom: 24,
            }}
          >
            <div className="muted small" style={{ marginBottom: 6 }}>
              Last 7 days across all stores
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 24,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {moneyExact(data.activity.gmv_last_7d_usd)}
                </div>
                <div className="muted small">Platform GMV</div>
              </div>
              <div>
                <div style={{ fontSize: 32, fontWeight: 800 }}>
                  {data.activity.confirmations_last_7d}
                </div>
                <div className="muted small">Orders submitted</div>
              </div>
              <div>
                <div style={{ fontSize: 32, fontWeight: 800 }}>
                  {data.activity.active_stores_last_7d}
                </div>
                <div className="muted small">Stores placed ≥1 order</div>
              </div>
            </div>
          </section>

          {/* ─── Runs panel ─── */}
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>
              ⚙️ RPA runs — last 24 hours
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <StatCard
                label="Total runs"
                value={data.runs.last_24h_total.toString()}
                sub="all status"
                tone="neutral"
              />
              <StatCard
                label="Failed runs"
                value={data.runs.last_24h_failed.toString()}
                sub={
                  data.runs.last_24h_failed === 0
                    ? "✓ clean"
                    : "needs attention"
                }
                tone={data.runs.last_24h_failed === 0 ? "green" : "red"}
              />
              <StatCard
                label="Success rate"
                value={
                  data.runs.success_rate_pct == null
                    ? "—"
                    : `${data.runs.success_rate_pct}%`
                }
                sub="last 24h"
                tone={
                  data.runs.success_rate_pct == null
                    ? "neutral"
                    : data.runs.success_rate_pct >= 95
                      ? "green"
                      : data.runs.success_rate_pct >= 80
                        ? "yellow"
                        : "red"
                }
              />
            </div>
          </section>

          {/* ─── Recent stores ─── */}
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>
              🏪 Recent signups
            </h2>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {data.recent_stores.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>
                  No stores yet. They'll show up here as they sign up.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                  }}
                >
                  <thead style={{ background: "rgba(255,255,255,0.04)" }}>
                    <tr>
                      <th style={th}>Store</th>
                      <th style={th}>License #</th>
                      <th style={th}>Signed up</th>
                      <th style={th}>MLCC verified</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_stores.map((s) => (
                      <tr
                        key={s.id}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <td style={td}>
                          <strong>{s.store_name}</strong>
                          <div className="muted small">{s.mlcc_username}</div>
                        </td>
                        <td style={td}>
                          <span style={{ fontFamily: "monospace" }}>
                            {s.liquor_license}
                          </span>
                        </td>
                        <td style={td}>{fmtDate(s.created_at)}</td>
                        <td style={td}>
                          {s.mlcc_credentials_last_verified_at
                            ? fmtDate(s.mlcc_credentials_last_verified_at)
                            : "—"}
                        </td>
                        <td style={td}>
                          <span
                            style={{
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 700,
                              background: s.is_active
                                ? "rgba(34, 197, 94, 0.18)"
                                : "rgba(239, 68, 68, 0.18)",
                              color: s.is_active ? "#86efac" : "#fca5a5",
                            }}
                          >
                            {s.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* ─── Recent failures ─── */}
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>
              {data.recent_failures.length === 0 ? "✅" : "🚨"} Recent failures
              {data.recent_failures.length > 0
                ? ` (${data.recent_failures.length})`
                : ""}
            </h2>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {data.recent_failures.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    textAlign: "center",
                    opacity: 0.7,
                    color: "#86efac",
                  }}
                >
                  No failures right now. System running clean.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead style={{ background: "rgba(239, 68, 68, 0.08)" }}>
                    <tr>
                      <th style={th}>When</th>
                      <th style={th}>Store</th>
                      <th style={th}>Failure type</th>
                      <th style={th}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_failures.map((f) => (
                      <tr
                        key={f.id}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <td style={td}>{fmtDateTime(f.finished_at)}</td>
                        <td style={td}>
                          <strong>{f.store_name}</strong>
                        </td>
                        <td style={td}>
                          <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                            {f.failure_type ?? "—"}
                          </span>
                        </td>
                        <td style={{ ...td, maxWidth: 400 }}>
                          <div
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={f.error_message ?? ""}
                          >
                            {f.error_message ?? "—"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <p
            className="muted small"
            style={{ textAlign: "center", marginTop: 32, opacity: 0.5 }}
          >
            Liquor Kings — built behind the counter. Founder console v1.
          </p>
        </>
      ) : !error ? (
        <p className="muted" style={{ padding: 24, textAlign: "center" }}>
          Loading…
        </p>
      ) : null}
    </div>
  );
}

// ─── Reusable bits ───

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  opacity: 0.7,
};
const td: React.CSSProperties = {
  padding: "10px 14px",
  verticalAlign: "top",
};

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "purple" | "green" | "yellow" | "red" | "neutral";
}) {
  const toneStyles: Record<typeof tone, React.CSSProperties> = {
    purple: {
      background: "rgba(108,99,255,0.10)",
      borderColor: "rgba(108,99,255,0.28)",
    },
    green: {
      background: "rgba(34,197,94,0.08)",
      borderColor: "rgba(34,197,94,0.28)",
    },
    yellow: {
      background: "rgba(245,158,11,0.08)",
      borderColor: "rgba(245,158,11,0.28)",
    },
    red: {
      background: "rgba(239,68,68,0.10)",
      borderColor: "rgba(239,68,68,0.28)",
    },
    neutral: {
      background: "rgba(255,255,255,0.04)",
      borderColor: "rgba(255,255,255,0.08)",
    },
  };
  return (
    <div
      style={{
        padding: 18,
        border: "1px solid",
        borderRadius: 10,
        ...toneStyles[tone],
      }}
    >
      <div
        className="muted small"
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          opacity: 0.7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          margin: "4px 0",
        }}
      >
        {value}
      </div>
      <div className="muted small" style={{ opacity: 0.7 }}>
        {sub}
      </div>
    </div>
  );
}
