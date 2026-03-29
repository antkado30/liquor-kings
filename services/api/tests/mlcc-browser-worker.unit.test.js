import { describe, it, expect } from "vitest";

import {
  buildMlccBrowserConfig,
  loginAndVerifyMlccLanding,
} from "../src/workers/mlcc-browser-worker.js";

describe("buildMlccBrowserConfig", () => {
  it("returns ready=true for valid synthetic payload + env", () => {
    const payload = {
      store: {
        mlcc_username: "  store_user  ",
      },
    };

    const env = {
      MLCC_PASSWORD: "  secret  ",
      MLCC_LOGIN_URL: "  https://example.com/login  ",
      MLCC_SAFE_TARGET_URL: "  https://example.com/safe  ",
      MLCC_HEADLESS: "false",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.config).toEqual({
      username: "store_user",
      password: "secret",
      loginUrl: "https://example.com/login",
      safeTargetUrl: "https://example.com/safe",
      headless: false,
    });
  });

  it("returns missing username error when store username absent", () => {
    const payload = {
      store: {},
    };

    const env = {
      MLCC_PASSWORD: "x",
      MLCC_LOGIN_URL: "https://example.com/login",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.config).toBe(null);
    expect(out.errors).toEqual([
      {
        type: "config",
        message: "Store is missing MLCC username",
      },
    ]);
  });

  it("returns missing password error when env.MLCC_PASSWORD absent", () => {
    const payload = {
      store: { mlcc_username: "u" },
    };

    const env = {
      MLCC_LOGIN_URL: "https://example.com/login",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.config).toBe(null);
    expect(out.errors).toEqual([
      {
        type: "config",
        message: "MLCC password is not configured",
      },
    ]);
  });

  it("returns missing login url error when env.MLCC_LOGIN_URL absent", () => {
    const payload = {
      store: { mlcc_username: "u" },
    };

    const env = {
      MLCC_PASSWORD: "p",
    };

    const out = buildMlccBrowserConfig({ payload, env });

    expect(out.ready).toBe(false);
    expect(out.config).toBe(null);
    expect(out.errors).toEqual([
      {
        type: "config",
        message: "MLCC login URL is not configured",
      },
    ]);
  });

  it("loginAndVerifyMlccLanding is not exercised against real MLCC in this suite", () => {
    expect(typeof loginAndVerifyMlccLanding).toBe("function");
  });
});
