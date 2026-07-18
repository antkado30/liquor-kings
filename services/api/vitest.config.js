import { defineConfig } from "vitest/config";

/*
 * Two test tiers (2026-07-18 — "make the suite trustworthy"):
 *
 *   UNIT (default `npm test`): hermetic, no external deps. Pure logic, mocked
 *   I/O. Must be 100% green on any machine, any time — that's what makes a red
 *   run mean "a real regression," not "the usual 40 environmental fails."
 *
 *   SMOKE (`npm run test:smoke`): the *.smoke.test.js suites drive the Express
 *   app against a LIVE Supabase (real DB reachable + seeded). They can't pass
 *   without that backend, so they're excluded from the default run and gated
 *   behind their own command — run them only when a backend is up.
 *
 * Toggle with LK_TEST_SMOKE=1 (set by the test:smoke script).
 */
const smoke = process.env.LK_TEST_SMOKE === "1";

export default defineConfig({
  test: {
    include: smoke
      ? ["**/*.smoke.test.js"]
      : ["**/*.test.js", "**/*.unit.test.js"],
    exclude: smoke
      ? ["**/node_modules/**", "**/dist/**"]
      : ["**/node_modules/**", "**/dist/**", "**/*.smoke.test.js"],
  },
});
