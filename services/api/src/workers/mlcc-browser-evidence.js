/**
 * Truthful MLCC browser evidence helpers: URL/title/viewport metadata always;
 * optional PNG screenshots capped by byte size (stored as base64 in attributes).
 */

import fs from "node:fs/promises";
import path from "node:path";

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
 * @param {{ fullPage?: boolean }} [options]
 * @returns {Promise<{ included: boolean, png_base64?: string, bytes?: number, reason?: string, full_page?: boolean }>}
 */
export async function maybeScreenshotPngBase64(page, maxBytes, options = {}) {
  if (!page || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { included: false, reason: "disabled_or_no_page" };
  }

  const fullPage = options.fullPage === true;

  try {
    const buf = await page.screenshot({ type: "png", fullPage });

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
      full_page: fullPage,
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
    if (shot.full_page != null) {
      base.screenshot_full_page = shot.full_page;
    }
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

/**
 * Bounded visible text excerpt for SAFE MODE failure forensics (no full HTML dump).
 * @param {import('playwright').Page | null | undefined} page
 * @param {{ maxChars?: number }} [options]
 */
/**
 * Bounded `document.body.innerHTML` excerpt for validate / SAFE MODE forensics (capped; not a full DOM dump).
 * @param {import('playwright').Page | null | undefined} page
 * @param {{ maxChars?: number }} [options]
 */
export async function maybeCaptureSafeModeFailureBodyHtmlExcerpt(
  page,
  { maxChars = 8_000 } = {},
) {
  if (!page) {
    return { ok: false, reason: "no_page" };
  }

  const cap = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 8_000;

  try {
    const raw = await page.evaluate((max) => {
      const body = document.body;
      if (!body) {
        return "";
      }
      const h = (body.innerHTML || "").replace(/\s+/g, " ").trim();
      return h.slice(0, max + 1);
    }, cap);
    const truncated = raw.length > cap;
    const html_excerpt = truncated ? raw.slice(0, cap) : raw;
    return {
      ok: true,
      html_excerpt,
      html_excerpt_char_length: html_excerpt.length,
      html_excerpt_truncated: truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "evaluate_failed", error: message };
  }
}

export async function maybeCaptureSafeModeFailurePageExcerpt(
  page,
  { maxChars = 12_000 } = {},
) {
  if (!page) {
    return { ok: false, reason: "no_page" };
  }

  const cap = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 12_000;

  try {
    const raw = await page.evaluate((max) => {
      const body = document.body;
      if (!body) {
        return "";
      }
      const t = (body.innerText || "").replace(/\s+/g, " ").trim();
      return t.slice(0, max + 1);
    }, cap);
    const truncated = raw.length > cap;
    const text_excerpt = truncated ? raw.slice(0, cap) : raw;
    return {
      ok: true,
      text_excerpt,
      excerpt_char_length: text_excerpt.length,
      excerpt_truncated: truncated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "evaluate_failed", error: message };
  }
}

/**
 * Snapshot + optional capped screenshot + bounded page text for MLCC SAFE MODE failures.
 * @param {import('playwright').Page | null | undefined} page
 * @param {{ screenshotMaxBytes?: number, excerptMaxChars?: number, htmlExcerptMaxChars?: number }} [options]
 */
export async function collectSafeModeFailureEvidencePack(
  page,
  {
    screenshotMaxBytes = 0,
    excerptMaxChars = 12_000,
    htmlExcerptMaxChars = 8_000,
  } = {},
) {
  const base = await buildPageSnapshotAttributes(page);
  const excerpt = await maybeCaptureSafeModeFailurePageExcerpt(page, {
    maxChars: excerptMaxChars,
  });
  const htmlEx = await maybeCaptureSafeModeFailureBodyHtmlExcerpt(page, {
    maxChars: htmlExcerptMaxChars,
  });
  const mergedBase = {
    ...base,
    safe_mode_failure_text_excerpt: excerpt.ok ? excerpt.text_excerpt : null,
    safe_mode_failure_excerpt_meta: excerpt.ok
      ? {
          excerpt_char_length: excerpt.excerpt_char_length,
          excerpt_truncated: excerpt.excerpt_truncated,
        }
      : excerpt,
    safe_mode_failure_body_html_excerpt: htmlEx.ok ? htmlEx.html_excerpt : null,
    safe_mode_failure_html_excerpt_meta: htmlEx.ok
      ? {
          html_excerpt_char_length: htmlEx.html_excerpt_char_length,
          html_excerpt_truncated: htmlEx.html_excerpt_truncated,
        }
      : htmlEx,
  };

  const maxBytes = Number.isFinite(screenshotMaxBytes) ? screenshotMaxBytes : 0;
  const shot =
    maxBytes > 0
      ? await maybeScreenshotPngBase64(page, maxBytes, { fullPage: false })
      : { included: false, reason: "disabled_or_zero_max" };

  return mergeSnapshotAndScreenshot(mergedBase, shot);
}

/** On-disk run summary next to milestone PNGs when `MLCC_SAFE_FLOW_SCREENSHOT_DIR` is set. */
export const MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME = "mlcc_run_summary.json";

/**
 * Per-run directory under the configured safe-flow screenshot base (same layout as worker).
 * @param {string | null | undefined} baseScreenshotDir
 * @param {string | number | null | undefined} runId
 * @returns {string | null}
 */
export function buildMlccSafeFlowRunOutputDir(baseScreenshotDir, runId) {
  const base =
    typeof baseScreenshotDir === "string" ? baseScreenshotDir.trim() : "";
  if (!base || runId == null || String(runId).trim() === "") {
    return null;
  }
  return path.resolve(base, String(runId));
}

/**
 * Predictable milestone PNG names: order + stage slug + stable basename from tenant/worker hint.
 * @param {number} nextOrderIndex — 1-based index matching the next `order_index` written by milestone capture
 * @param {string} stage
 * @param {string} preferredFilename — e.g. mlcc_cart_settled.png
 */
export function buildMlccSafeFlowMilestoneDiskFilename(
  nextOrderIndex,
  stage,
  preferredFilename,
) {
  const ext = path.extname(preferredFilename) || ".png";
  const rawBase = path.basename(preferredFilename, ext);
  const base =
    rawBase
      .replace(/^mlcc_/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_|_$/g, "") || "capture";
  const stageSlug = String(stage ?? "stage")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64) || "stage";
  const idx = Math.max(1, Math.floor(Number(nextOrderIndex)) || 1);
  const idxStr = String(idx).padStart(3, "0");
  return `mlcc_ms_${idxStr}__${stageSlug}__${base}${ext}`;
}

/**
 * @param {unknown[]} evidenceEntries
 * @returns {Record<string, number>}
 */
export function tallyMlccEvidenceEntriesByKind(evidenceEntries) {
  const tally = {};
  if (!Array.isArray(evidenceEntries)) {
    return tally;
  }
  for (const row of evidenceEntries) {
    const k =
      row && typeof row === "object" && typeof row.kind === "string"
        ? row.kind
        : "unknown";
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return tally;
}

/**
 * @param {unknown[]} evidenceEntries
 */
export function countMlccSafeFlowMilestoneScreenshots(evidenceEntries) {
  if (!Array.isArray(evidenceEntries)) {
    return 0;
  }
  return evidenceEntries.filter((e) => e?.kind === "mlcc_safe_flow_milestone_screenshot")
    .length;
}

/**
 * Serializable audit row for `mlcc_run_summary.json` (worker dry-run only).
 */
export function buildMlccSafeFlowRunSummaryPayload({
  schemaVersion = 1,
  runId,
  storeId,
  workerId,
  outcome,
  startedAtIso,
  finishedAtIso,
  errorMessage,
  finalUrl,
  addByCodeProbe,
  dryRunSafeMode,
  guardStats,
  evidenceEntryCount,
  evidenceKindsTally,
  milestoneScreenshotEvidenceCount,
}) {
  return {
    schema_version: schemaVersion,
    run_id: runId,
    store_id: storeId,
    worker_id: workerId ?? null,
    outcome,
    started_at_iso: startedAtIso,
    finished_at_iso: finishedAtIso,
    error_message: errorMessage ?? null,
    final_page_url: finalUrl ?? null,
    mlcc_dry_run_safe_mode: dryRunSafeMode,
    add_by_code_probe_enabled: addByCodeProbe === true,
    network_guard_blocked_request_count:
      guardStats && typeof guardStats.blockedRequestCount === "number"
        ? guardStats.blockedRequestCount
        : null,
    evidence_entry_count: evidenceEntryCount,
    evidence_kinds_tally: evidenceKindsTally,
    milestone_screenshot_evidence_entries: milestoneScreenshotEvidenceCount,
    run_summary_basename: MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME,
  };
}

/**
 * @param {string} outputDirAbs
 * @param {Record<string, unknown>} payload
 * @returns {Promise<string>} absolute path written
 */
export async function writeMlccSafeFlowRunSummaryJson(outputDirAbs, payload) {
  if (!outputDirAbs || typeof outputDirAbs !== "string") {
    throw new Error("writeMlccSafeFlowRunSummaryJson: outputDirAbs required");
  }
  await fs.mkdir(outputDirAbs, { recursive: true });
  const target = path.join(outputDirAbs, MLCC_SAFE_FLOW_RUN_SUMMARY_BASENAME);
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return target;
}
