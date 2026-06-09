/**
 * Shared premium bottle artwork (2026-06-08).
 *
 * Used as the placeholder anywhere a real product photo (image_url) is
 * missing — the Browse grid and the ProductCard. A real glass bottle with a
 * dark cap, a liquid gradient + glass highlight, and the brand MONOGRAM on a
 * clean label so each one feels intentional instead of an identical grey
 * silhouette. Real photos render on top the moment image_url is set.
 */

const CATEGORY_TINTS: Record<string, string> = {
  Vodka: "#cfe2ff",
  Whiskey: "#e2b48a",
  Bourbon: "#d6a06b",
  Scotch: "#c5985a",
  Tequila: "#dfe8b0",
  Rum: "#d8bfa0",
  Gin: "#dde6df",
  Liqueur: "#e8cce0",
  Cordials: "#e8cce0",
  Brandy: "#d6b89a",
  Cognac: "#d6b89a",
  Mezcal: "#d8d0a8",
  Wine: "#e1bcc8",
  Cocktail: "#cfe2ff",
};

export function tintForCategory(category: string | null | undefined): string {
  if (!category) return "#d8dee5";
  const lc = category.toLowerCase();
  for (const [key, color] of Object.entries(CATEGORY_TINTS)) {
    if (lc.includes(key.toLowerCase())) return color;
  }
  return "#d8dee5";
}

/** 1–2 letter monogram from the brand name, for the placeholder label. */
export function monogram(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return name.slice(0, 1).toUpperCase() || "·";
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function PlaceholderBottle({
  tint,
  name,
  seed,
}: {
  tint: string;
  name: string;
  seed: string;
}) {
  // Seed the gradient ids so multiple bottles on one page don't collide.
  const safe = String(seed).replace(/[^a-zA-Z0-9_-]/g, "");
  const gid = `lkg-${safe}`;
  const hid = `lkh-${safe}`;
  return (
    <svg
      viewBox="0 0 60 120"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ width: "auto", height: "100%", display: "block" }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="24%" stopColor={tint} stopOpacity="0.96" />
          <stop offset="100%" stopColor={tint} stopOpacity="0.68" />
        </linearGradient>
        <linearGradient id={hid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Cap */}
      <rect x="24" y="4" width="12" height="9" rx="2" fill="#2c2c34" />
      {/* Neck */}
      <rect x="26" y="12" width="8" height="16" fill={`url(#${gid})`} />
      {/* Body */}
      <path
        d="M26 28 Q17 33 17 46 L17 110 Q17 116 23 116 L37 116 Q43 116 43 110 L43 46 Q43 33 34 28 Z"
        fill={`url(#${gid})`}
      />
      {/* Glass highlight down the left side */}
      <path
        d="M22 32 Q19 37 19 47 L19 107"
        fill="none"
        stroke={`url(#${hid})`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Label + monogram */}
      <rect x="20.5" y="66" width="19" height="26" rx="3" fill="#fbfbfd" opacity="0.96" />
      <text
        x="30"
        y="83"
        textAnchor="middle"
        fontSize="11"
        fontWeight="800"
        fill="#3a3a44"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      >
        {monogram(name)}
      </text>
    </svg>
  );
}
