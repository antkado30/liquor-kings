/**
 * Icons — the premium SVG icon set for the scanner (task #91, 2026-06-07).
 *
 * Replaces every emoji used in the UI with clean, stroke-based,
 * currentColor SVG. This is the visual-upgrade-per-line-of-code
 * winner — kills the "tacky / cheap / AI" feel Tony called out.
 *
 * Design rules (see [[feedback-premium-feel]]):
 *   - 24×24 viewBox, stroke-based geometry (Lucide style)
 *   - strokeWidth defaults to 1.75 (sharp without looking childish)
 *   - currentColor stroke so parent controls color via CSS
 *   - Rounded line caps + joins for premium feel
 *   - No fill on path shapes; outline-only by default
 *
 * Usage:
 *   <IconHome size={22} />
 *   <IconCart size={24} strokeWidth={2} />
 *   <span style={{ color: '#3a82f7' }}><IconSparkles size={20} /></span>
 */
import type { CSSProperties, SVGProps } from "react";

type IconProps = {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "size">;

function svg({
  children,
  size = 22,
  strokeWidth = 1.75,
  style,
  className,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ─── Tab bar icons ────────────────────────────────────────────────── */

export function IconHome(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
      </>
    ),
  });
}

export function IconCatalog(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M4 4h7v16H6a2 2 0 0 1-2-2V4z" />
        <path d="M13 4h7v14a2 2 0 0 1-2 2h-5V4z" />
        <path d="M11 8h2M11 12h2M11 16h2" />
      </>
    ),
  });
}

export function IconCart(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="9" cy="20" r="1.25" />
        <circle cx="18" cy="20" r="1.25" />
        <path d="M3 4h2l2.5 11.5a2 2 0 0 0 2 1.5h7.5a2 2 0 0 0 2-1.5L21 8H6" />
      </>
    ),
  });
}

export function IconCalendar(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17" />
        <path d="M8 3v4M16 3v4" />
      </>
    ),
  });
}

export function IconMore(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="4" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
  });
}

/* ─── More-page row icons ─────────────────────────────────────────── */

export function IconClipboardList(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <rect x="7" y="3.5" width="10" height="3" rx="1" />
        <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
        <path d="M8 11h.01M12 11h4M8 15h.01M12 15h4" />
      </>
    ),
  });
}

export function IconBarChart(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 21h18" />
        <rect x="6" y="11" width="3" height="7" rx="0.5" />
        <rect x="11" y="6" width="3" height="12" rx="0.5" />
        <rect x="16" y="14" width="3" height="4" rx="0.5" />
      </>
    ),
  });
}

/**
 * Sparkles icon — used for AI assistant. Says "magic, intelligence,
 * something special." Better than a chat bubble for the moat.
 */
export function IconSparkles(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <path d="m5.5 5.5 2 2M16.5 16.5l2 2M5.5 18.5l2-2M16.5 7.5l2-2" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
  });
}

export function IconPackage(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </>
    ),
  });
}

export function IconSettings(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  });
}

export function IconLogOut(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>
    ),
  });
}

/* ─── Action icons ────────────────────────────────────────────────── */

export function IconTrash(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 6h18" />
        <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </>
    ),
  });
}

export function IconPencil(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </>
    ),
  });
}

export function IconChevronRight(props: IconProps) {
  return svg({
    ...props,
    children: <path d="m9 6 6 6-6 6" />,
  });
}

export function IconChevronLeft(props: IconProps) {
  return svg({
    ...props,
    children: <path d="m15 6-6 6 6 6" />,
  });
}

export function IconLoader(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M12 2v4" />
        <path d="m16.24 7.76 2.83-2.83" opacity={0.5} />
        <path d="M18 12h4" opacity={0.35} />
        <path d="m16.24 16.24 2.83 2.83" opacity={0.2} />
      </>
    ),
  });
}

export function IconStore(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
        <path d="M3 9 5 3h14l2 6" />
        <path d="M9 21V12h6v9" />
      </>
    ),
  });
}

export function IconFileText(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h8M8 9h2" />
      </>
    ),
  });
}

export function IconCamera(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  });
}

export function IconCheck(props: IconProps) {
  return svg({
    ...props,
    children: <path d="M20 6 9 17l-5-5" />,
  });
}

export function IconAlert(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M12 2 2 21h20L12 2z" />
        <path d="M12 9v5M12 18h.01" />
      </>
    ),
  });
}

export function IconPlug(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M12 22v-5" />
        <path d="M9 7V2M15 7V2" />
        <path d="M6.6 7h10.8a1.4 1.4 0 0 1 1.4 1.4v3a6 6 0 0 1-6 6h-1.6a6 6 0 0 1-6-6v-3A1.4 1.4 0 0 1 6.6 7z" />
      </>
    ),
  });
}

export function IconPaperclip(props: IconProps) {
  return svg({
    ...props,
    children: (
      <path d="m16 6-8.5 8.5a2.1 2.1 0 1 0 3 3L19 9a3.5 3.5 0 0 0-5-5L5.5 12.5a5.5 5.5 0 1 0 7.8 7.8L21 13" />
    ),
  });
}

export function IconX(props: IconProps) {
  return svg({
    ...props,
    children: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
  });
}
