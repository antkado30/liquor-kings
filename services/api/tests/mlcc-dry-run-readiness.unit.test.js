import { describe, it, expect } from "vitest";

import {
  buildMlccDryRunReadinessReport,
  formatMlccDryRunReadinessText,
} from "../src/workers/mlcc-dry-run-readiness.js";

describe("mlcc-dry-run-readiness", () => {
  it("reports not ready when base credentials missing", () => {
    const report = buildMlccDryRunReadinessReport({
      payload: { store: { mlcc_username: "u" } },
      env: {},
    });

    expect(report.config_ready).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.phases).toEqual([]);
    const text = formatMlccDryRunReadinessText(report);
    expect(text).toMatch(/NOT READY/);
    expect(text).toMatch(/forbidden/i);
  });

  it("reports ready and phase rows when config matches worker happy path", () => {
    const payload = {
      store: { mlcc_username: "store_user" },
    };
    const env = {
      MLCC_PASSWORD: "secret",
      MLCC_LOGIN_URL: "https://example.com/login",
      MLCC_SAFE_TARGET_URL: "https://example.com/safe",
      MLCC_HEADLESS: "false",
    };

    const report = buildMlccDryRunReadinessReport({ payload, env });

    expect(report.config_ready).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.phases.length).toBeGreaterThan(5);
    expect(report.phases.some((p) => p.id === "2b" && p.status === "off")).toBe(
      true,
    );
    expect(
      report.phases.some((p) => p.id === "2a_nav" && p.status === "runnable"),
    ).toBe(true);

    const text = formatMlccDryRunReadinessText(report);
    expect(text).toMatch(/CONFIG: READY/);
    expect(text).toMatch(/2b/);
    expect(text).toMatch(/mlcc-dry-run-repeatability\.md/);
  });
});
