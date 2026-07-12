import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit-test config for apps/scanner (audit: zero frontend tests, flagged in
// launch-readiness-audit.md §Tests). Scoped to hooks/state-machine logic
// with mocked API modules — no real Supabase auth, no dev server, no
// network. Safe to run anytime, including right before the Thursday
// real-order mandate clock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    // Stubs jsdom's not-implemented window APIs (scrollTo) so unmount
    // cleanups don't spew stderr noise — see src/test/setup.ts.
    setupFiles: ["src/test/setup.ts"],
  },
});
