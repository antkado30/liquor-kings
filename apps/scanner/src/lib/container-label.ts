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

/**
 * Suffix for multi-bottle pack SKUs: " · 12-pack" when pack_count ≥ 2,
 * else "" (a single bottle is the default — labeling it would be noise).
 * Same contract as the container suffix: travels chip → cart line →
 * confirm modal, because a 12-pack of minis and a single mini share a
 * size and a material but are DIFFERENT orderable products with
 * different prices and case rules. Unlabeled, they render as identical
 * chips — which is exactly how Tito's 50 mL read as "the whole catalog
 * is corrupted" on 2026-07-12. The data was right; the label under-told.
 */
export function packCountSuffix(packCount: number | null | undefined): string {
  if (typeof packCount !== "number" || !Number.isFinite(packCount) || packCount < 2) {
    return "";
  }
  return ` · ${packCount}-pack`;
}
