/**
 * Bounded on-disk PNG milestones for MLCC safe-flow visual debugging (no OCR / no image processing).
 * Enabled only when the worker sets an output directory per run.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {object} args
 * @param {import('playwright').Page | null | undefined} args.page
 * @param {string} args.outputDirAbs
 * @param {string} args.filename
 * @param {string} args.stage
 * @param {{ n: number }} args.orderIndexRef
 * @param {unknown[]} args.evidenceCollected
 * @param {(o: { kind: string; stage: string; message: string; attributes: Record<string, unknown> }) => unknown} args.buildEvidence
 */
export async function captureMlccSafeFlowMilestoneScreenshot({
  page,
  outputDirAbs,
  filename,
  stage,
  orderIndexRef,
  evidenceCollected,
  buildEvidence,
}) {
  if (!page || !outputDirAbs || !filename || !stage) {
    return null;
  }

  const order_index = (orderIndexRef.n += 1);
  const file_path = path.join(outputDirAbs, filename);
  let url = "";

  try {
    url = page.url();
  } catch {
    url = "";
  }

  const timestamp_iso = new Date().toISOString();
  let screenshot_error = null;

  try {
    await fs.mkdir(outputDirAbs, { recursive: true });
    await page.screenshot({ path: file_path, type: "png" });
  } catch (e) {
    screenshot_error = e instanceof Error ? e.message : String(e);
  }

  const milestone_screenshot = {
    stage,
    file_path,
    url,
    timestamp_iso,
    order_index,
    ...(screenshot_error ? { screenshot_error } : {}),
  };

  evidenceCollected.push(
    buildEvidence({
      kind: "mlcc_safe_flow_milestone_screenshot",
      stage: "mlcc_safe_flow_milestone_screenshot",
      message: screenshot_error
        ? `Safe-flow milestone screenshot failed (${stage})`
        : `Safe-flow milestone screenshot: ${stage}`,
      attributes: { milestone_screenshot },
    }),
  );

  return milestone_screenshot;
}
