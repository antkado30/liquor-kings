import { describe, it, expect } from "vitest";

import { mergeSnapshotAndScreenshot } from "../src/workers/mlcc-browser-evidence.js";

describe("mergeSnapshotAndScreenshot", () => {
  it("merges included screenshot fields", () => {
    const out = mergeSnapshotAndScreenshot(
      { url: "https://x", page_available: true },
      { included: true, png_base64: "QUJD", bytes: 3 },
    );

    expect(out.screenshot_png_base64).toBe("QUJD");
    expect(out.screenshot_bytes).toBe(3);
    expect(out.url).toBe("https://x");
  });

  it("records skip reason when over limit", () => {
    const out = mergeSnapshotAndScreenshot(
      { url: "https://x" },
      {
        included: false,
        reason: "over_size_limit",
        bytes: 999999,
        max_bytes: 200000,
      },
    );

    expect(out.screenshot_skipped_reason).toBe("over_size_limit");
    expect(out.screenshot_would_be_bytes).toBe(999999);
    expect(out.screenshot_max_bytes).toBe(200000);
  });
});
