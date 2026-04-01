/** Vite base is e.g. `/operator-review/app/` — normalize for path parsing. */
export function adminPathBase(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") || "";
}

/**
 * Extract run id for the review detail route.
 * `location.pathname` from React Router is usually basename-relative (e.g. `/review/:id`);
 * fall back to stripping `adminPathBase()` for full document paths.
 */
export function runIdFromReviewDetailPath(pathname: string): string | null {
  const pathNorm = pathname.replace(/\/$/, "") || "/";
  const rel = pathNorm.match(/^\/review\/([^/]+)$/);
  if (rel) return decodeURIComponent(rel[1]);
  const base = adminPathBase();
  if (base && pathNorm.startsWith(base)) {
    const rest = pathNorm.slice(base.length);
    const m = rest.match(/^\/review\/([^/]+)$/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}
