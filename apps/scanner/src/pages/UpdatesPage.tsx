/**
 * UpdatesPage — the bell's feed (2026-08-05, Tony's design).
 *
 * "instead of those updates going there [Home], maybe make a updates
 * tab, and it has all the updates of what happened when it happened…
 * but we cant make it to crammed."
 *
 * Everything, chronologically, grouped by day: price changes (old →
 * new), new bottles (and whether they're scannable yet), catalog sync
 * events ("August book ingested — 13,828 items, 214 price changes"),
 * and order events (confirmations + delivery dates). Opening the page
 * marks everything seen — the bell badge clears.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUpdates, type UpdateEntry } from "../api/updates";
import { markUpdatesSeen } from "../lib/updates-unread";
import { IconBell, IconCart, IconChevronLeft, IconLoader, IconPackage, IconSparkles, IconTag } from "../components/Icons";

const TYPE_META: Record<string, { label: string; className: string }> = {
  price_change: { label: "Price", className: "updates-icon--price" },
  new_bottle: { label: "New", className: "updates-icon--new" },
  catalog_sync: { label: "Sync", className: "updates-icon--sync" },
  order_event: { label: "Order", className: "updates-icon--order" },
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function typeIcon(type: string) {
  switch (type) {
    case "price_change":
      return <IconTag size={16} />;
    case "new_bottle":
      return <IconSparkles size={16} />;
    case "catalog_sync":
      return <IconPackage size={16} />;
    case "order_event":
      return <IconCart size={16} />;
    default:
      return <IconBell size={16} />;
  }
}

export function UpdatesPage() {
  const navigate = useNavigate();
  const [updates, setUpdates] = useState<UpdateEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUpdates().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setUpdates(r.updates);
        // Seen = the moment the feed rendered. The badge clears from the
        // next Home visit onward.
        markUpdatesSeen();
      } else {
        setError(r.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    if (!updates) return [];
    const byDay = new Map<string, UpdateEntry[]>();
    for (const u of updates) {
      const key = dayLabel(u.at);
      const list = byDay.get(key) ?? [];
      list.push(u);
      byDay.set(key, list);
    }
    return [...byDay.entries()];
  }, [updates]);

  return (
    <div className="page updates-page">
      <header className="top-bar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <IconChevronLeft size={22} />
        </button>
        <h1 className="updates-title">Updates</h1>
        <span className="updates-title-spacer" />
      </header>

      {error ? (
        <div className="banner banner-warn" role="alert">
          Couldn&apos;t load updates — {error}. Pull back later; nothing is lost.
        </div>
      ) : null}

      {!updates && !error ? (
        <div className="updates-loading muted">
          <IconLoader size={18} className="rpa-progress__spin" /> Loading updates…
        </div>
      ) : null}

      {updates && updates.length === 0 ? (
        <p className="muted updates-empty">
          Nothing yet — price changes, new bottles, catalog syncs, and your
          orders will all land here as they happen.
        </p>
      ) : null}

      {groups.map(([day, entries]) => (
        <section key={day} className="updates-day">
          <h2 className="updates-day__label">{day}</h2>
          <ul className="updates-list">
            {entries.map((u) => {
              const meta = TYPE_META[u.type] ?? { label: "Update", className: "" };
              return (
                <li key={u.id} className="updates-row">
                  <span className={`updates-icon ${meta.className}`}>{typeIcon(u.type)}</span>
                  <div className="updates-row__text">
                    <div className="updates-row__title">{u.title}</div>
                    <div className="updates-row__body muted">{u.body}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
