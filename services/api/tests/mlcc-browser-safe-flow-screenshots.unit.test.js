import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { captureMlccSafeFlowMilestoneScreenshot } from "../src/workers/mlcc-browser-safe-flow-screenshots.js";

describe("captureMlccSafeFlowMilestoneScreenshot", () => {
  it("writes PNG, bumps order index, and appends evidence with milestone_screenshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lk-mlcc-safe-flow-"));
    const evidenceCollected = [];
    const orderIndexRef = { n: 0 };

    const page = {
      url: () => "https://example.test/milo/products/bycode",
      screenshot: async ({ path: p }) => {
        await fs.writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      },
    };

    const buildEvidence = (o) => o;

    const rec = await captureMlccSafeFlowMilestoneScreenshot({
      page,
      outputDirAbs: dir,
      filename: "mlcc_bycode_loaded.png",
      stage: "bycode_page_loaded",
      orderIndexRef,
      evidenceCollected,
      buildEvidence,
    });

    expect(rec?.order_index).toBe(1);
    expect(rec?.stage).toBe("bycode_page_loaded");
    expect(rec?.file_path).toBe(path.join(dir, "mlcc_bycode_loaded.png"));
    expect(rec?.url).toBe("https://example.test/milo/products/bycode");
    expect(rec?.timestamp_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(orderIndexRef.n).toBe(1);

    const st = await fs.stat(path.join(dir, "mlcc_bycode_loaded.png"));
    expect(st.size).toBeGreaterThan(0);

    expect(evidenceCollected).toHaveLength(1);
    expect(evidenceCollected[0].kind).toBe("mlcc_safe_flow_milestone_screenshot");
    expect(evidenceCollected[0].attributes.milestone_screenshot.order_index).toBe(1);
  });

  it("records screenshot_error in evidence when screenshot throws", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lk-mlcc-safe-flow-err-"));
    const evidenceCollected = [];
    const orderIndexRef = { n: 0 };

    const page = {
      url: () => "https://example.test/x",
      screenshot: async () => {
        throw new Error("boom");
      },
    };

    const rec = await captureMlccSafeFlowMilestoneScreenshot({
      page,
      outputDirAbs: dir,
      filename: "x.png",
      stage: "on_failure",
      orderIndexRef,
      evidenceCollected,
      buildEvidence: (o) => o,
    });

    expect(rec?.screenshot_error).toBe("boom");
    expect(evidenceCollected[0].attributes.milestone_screenshot.screenshot_error).toBe("boom");
  });
});
