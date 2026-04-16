/**
 * DB-free: after selector resolution fails (ambiguous / no match), SAFE MODE forensics
 * must still be collectable via collectSafeModeFailureEvidencePack (same helper probe phases use).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";

import { collectSafeModeFailureEvidencePack } from "../src/workers/mlcc-browser-evidence.js";
import {
  resolveMlccProbeCodeFieldFillLocatorWithFallbackChain,
  resolveMlccProbeQuantityFillLocatorWithFallbackChain,
  resolveMlccProbeValidateClickLocatorWithFallbackChain,
} from "../src/workers/mlcc-browser-add-by-code-probe.js";

describe("RPA selector failure paths attach SAFE MODE forensics (DB-free)", {
  timeout: 60_000,
}, () => {
  let browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function assertForensicsAfterResolutionFailure(page, label) {
    const pack = await collectSafeModeFailureEvidencePack(page, {
      screenshotMaxBytes: 0,
      excerptMaxChars: 2000,
      htmlExcerptMaxChars: 4000,
    });
    expect(pack.safe_mode_failure_body_html_excerpt, `${label}: html excerpt`).toBeTruthy();
    expect(String(pack.safe_mode_failure_body_html_excerpt).length, `${label}: html length`).toBeGreaterThan(0);
    const text = String(pack.safe_mode_failure_text_excerpt ?? "").trim();
    expect(
      text.length > 0 || String(pack.safe_mode_failure_body_html_excerpt).length > 20,
      `${label}: expected bounded text or substantive html excerpt`,
    ).toBe(true);
  }

  it("order-critical validate: ambiguous resolution then forensics pack", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <main></main>
      <button type="button" class="amb" style="display:inline-block;width:40px;height:24px">Validate</button>
      <button type="button" class="amb" style="display:inline-block;width:40px;height:24px">Validate</button>
    </body></html>`);
    const r = await resolveMlccProbeValidateClickLocatorWithFallbackChain(page, ".amb", {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple_visible_validate_controls_ambiguous");
    await assertForensicsAfterResolutionFailure(page, "validate");
    await ctx.close();
  });

  it("order-critical quantity: ambiguous tenant match then forensics pack", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <p>lk-quantity-ambiguity-surface</p>
      <main>
        <input type="number" class="qty-tenant" value="" />
        <input type="number" class="qty-tenant" value="" />
      </main>
    </body></html>`);
    const r = await resolveMlccProbeQuantityFillLocatorWithFallbackChain(page, ".qty-tenant", {});
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple_visible_quantity_controls_ambiguous");
    await assertForensicsAfterResolutionFailure(page, "quantity");
    await ctx.close();
  });

  it("non-order-critical code field: ambiguous placeholder targets then forensics pack", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <p>lk-code-placeholder-ambiguity-surface</p>
      <main>
        <input type="text" placeholder="Search by code" />
        <input type="text" placeholder="Search by code" />
      </main>
    </body></html>`);
    const r = await resolveMlccProbeCodeFieldFillLocatorWithFallbackChain(
      page,
      ".nonexistent-tenant-only",
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("multiple_visible_code_placeholder_ambiguous");
    await assertForensicsAfterResolutionFailure(page, "code_field");
    await ctx.close();
  });
});
