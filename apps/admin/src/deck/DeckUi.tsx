import type React from "react";
import type { ReactNode } from "react";

export function IconCrown({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 7l3.5 3L12 4l5.5 6L21 7l-1.6 11H4.6L3 7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="rgba(124,111,255,0.18)"
      />
    </svg>
  );
}

function IconGrid({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconList({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconImage({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="m21 15-5-5L8 18" />
    </svg>
  );
}

function IconRadar({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12 18 6M12 12V3" />
    </svg>
  );
}

function IconPilot({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export type DeckIcon = "crown" | "overview" | "pilot" | "queue" | "catalog" | "images" | "diagnostics";

const DECK_ICONS: Record<
  DeckIcon,
  (props: { size?: number }) => React.ReactElement
> = {
  crown: IconCrown,
  overview: IconGrid,
  pilot: IconPilot,
  queue: IconList,
  catalog: IconList,
  images: IconImage,
  diagnostics: IconRadar,
};

export function DeckPage({
  children,
  narrow,
}: {
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div className={`deck-page${narrow ? " deck-page--narrow" : ""}`}>{children}</div>
  );
}

export function DeckHeader({
  title,
  subtitle,
  icon = "crown",
  onRefresh,
  loading,
  loadingLabel = "Refreshing…",
  refreshLabel = "Refresh",
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: DeckIcon;
  onRefresh?: () => void;
  loading?: boolean;
  loadingLabel?: string;
  refreshLabel?: string;
}) {
  const Icon = DECK_ICONS[icon];
  return (
    <header className="deck-header">
      <div className="deck-header__main">
        <h1 className="deck-header__title">
          <span className="deck-header__badge" aria-hidden>
            <Icon size={20} />
          </span>
          {title}
        </h1>
        {subtitle ? <p className="deck-header__sub muted">{subtitle}</p> : null}
      </div>
      {onRefresh ? (
        <button
          type="button"
          className="secondary deck-header__refresh"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? loadingLabel : refreshLabel}
        </button>
      ) : null}
    </header>
  );
}

export function DeckSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`deck-section card${className ? ` ${className}` : ""}`}>
      {title ? <h2 className="deck-section__title">{title}</h2> : null}
      {children}
    </section>
  );
}

export type DeckStatTone = "purple" | "green" | "yellow" | "red" | "neutral";

export function DeckStatGrid({ children }: { children: ReactNode }) {
  return <div className="deck-stat-grid">{children}</div>;
}

export function DeckStat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: DeckStatTone;
}) {
  return (
    <div className={`deck-stat deck-stat--${tone}`}>
      <div className="deck-stat__label">{label}</div>
      <div className="deck-stat__value">{value}</div>
      {sub ? <div className="deck-stat__sub muted">{sub}</div> : null}
    </div>
  );
}

export function DeckSkeleton({
  rows = 3,
  variant = "card",
}: {
  rows?: number;
  variant?: "card" | "row" | "stat";
}) {
  return (
    <div className="deck-skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`deck-shimmer deck-shimmer--${variant}`} />
      ))}
    </div>
  );
}

export function DeckEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="deck-empty card">
      <h2 className="deck-empty__title">{title}</h2>
      {children ? <p className="deck-empty__copy muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function DeckBanner({
  kind,
  children,
}: {
  kind: "ok" | "err" | "warn";
  children: ReactNode;
}) {
  return <div className={`deck-banner deck-banner--${kind}`}>{children}</div>;
}

export function DeckPill({
  label,
  tone,
}: {
  label: string;
  tone:
    | "health-attention"
    | "health-degraded"
    | "health-ok"
    | "workflow-escalated"
    | "workflow-watching"
    | "workflow-resolved"
    | "workflow-default"
    | "overdue"
    | "follow-up"
    | "neutral";
}) {
  return <span className={`deck-pill deck-pill--${tone}`}>{label}</span>;
}

export function IconTrendUp({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M6 2.5 2.5 7h7L6 2.5z" />
    </svg>
  );
}

export function IconTrendDown({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M6 9.5 9.5 5h-7L6 9.5z" />
    </svg>
  );
}

export function IconTrendFlat({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden>
      <path d="M2.5 6h7v1.2h-7z" />
    </svg>
  );
}

export function DeckTrendGlyph({ code }: { code: string }) {
  if (code === "improving") {
    return (
      <span className="deck-trend deck-trend--up">
        <IconTrendUp /> improving
      </span>
    );
  }
  if (code === "worsening") {
    return (
      <span className="deck-trend deck-trend--down">
        <IconTrendDown /> worsening
      </span>
    );
  }
  return (
    <span className="deck-trend deck-trend--flat">
      <IconTrendFlat /> flat
    </span>
  );
}

export function IconExternal({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

export function IconChevronLeft({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function IconCheckSmall({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
