/**
 * container-label — one source of truth for showing a bottle's container
 * material (family-tree plan, wired 2026-07-11).
 *
 * The Tony rule (decided 2026-07-01): "group for discovery, distinguish
 * for ordering." A size sold in both glass and plastic renders as two
 * labeled chips, and the label travels the WHOLE order path — size chip →
 * cart line → pre-submit confirm — so nobody ever orders glass and
 * receives plastic. 527 families in the live catalog mix materials.
 *
 * Data source: mlcc_items.container, written by the family engine
 * (services/api/src/mlcc/family-key.js). "glass" is the engine default;
 * missing/null means the row predates the column — treated as unknown
 * here and never labeled (an invented label would be a lie).
 */

/**
 * Human display name for a container value: "plastic" → "Plastic".
 * Returns null for empty/unknown input — callers skip the label rather
 * than guessing.
 */
export function containerDisplay(container: string | null | undefined): string | null {
  const c = typeof container === "string" ? container.trim().toLowerCase() : "";
  if (!c) return null;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * Suffix for cart lines and the confirm modal: " · Plastic" when the
 * container is known and NOT glass, else "" (glass is the default
 * material — labeling every glass line would be noise; a non-glass line
 * is exactly the case Tony fears missing).
 */
export function nonGlassContainerSuffix(container: string | null | undefined): string {
  const display = containerDisplay(container);
  if (!display || display === "Glass") return "";
  return ` · ${display}`;
}
