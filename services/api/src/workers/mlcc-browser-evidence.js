/**
 * Truthful MLCC browser evidence helpers: URL/title/viewport metadata always;
 * optional PNG screenshots capped by byte size (stored as base64 in attributes).
 */

export async function buildPageSnapshotAttributes(page) {
  if (!page) {
    return { page_available: false };
  }

  try {
    const url = page.url();
    const title = await page.title().catch(() => null);
    const viewport = page.viewportSize();

    return {
      page_available: true,
      url,
      title: title || null,
      viewport_width: viewport?.width ?? null,
      viewport_height: viewport?.height ?? null,
    };
  } catch {
    return { page_available: false, snapshot_error: true };
  }
}

/**
 * @param {import('playwright').Page | null | undefined} page
 * @param {number} maxBytes - 0 disables
 * @returns {Promise<{ included: boolean, png_base64?: string, bytes?: number, reason?: string }>}
 */
export async function maybeScreenshotPngBase64(page, maxBytes) {
  if (!page || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { included: false, reason: "disabled_or_no_page" };
  }

  try {
    const buf = await page.screenshot({ type: "png", fullPage: false });

    if (buf.length > maxBytes) {
      return {
        included: false,
        reason: "over_size_limit",
        bytes: buf.length,
        max_bytes: maxBytes,
      };
    }

    return {
      included: true,
      png_base64: buf.toString("base64"),
      bytes: buf.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    return { included: false, reason: "screenshot_error", error: message };
  }
}

export function mergeSnapshotAndScreenshot(snapshotAttrs, shot) {
  const base = { ...snapshotAttrs };

  if (shot.included && shot.png_base64) {
    base.screenshot_png_base64 = shot.png_base64;
    base.screenshot_bytes = shot.bytes ?? null;
  } else if (shot.reason) {
    base.screenshot_skipped_reason = shot.reason;
    if (shot.bytes != null) {
      base.screenshot_would_be_bytes = shot.bytes;
    }
    if (shot.max_bytes != null) {
      base.screenshot_max_bytes = shot.max_bytes;
    }
  }

  return base;
}
