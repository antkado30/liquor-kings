/**
 * Vitest environment setup (2026-07-11).
 *
 * jsdom DEFINES window.scrollTo but throws "Not implemented" when called —
 * so every component that restores scroll position on unmount (the
 * useLockBodyScroll cleanup under OrderStatusPill's sheets, drawers, etc.)
 * spewed a 10-line stderr stack per test while all tests passed. The fix
 * belongs HERE, not in prod code: production never bends to please a test
 * environment. Stubbed as a plain no-op (not vi.fn()) so no test can
 * accidentally assert framework-internal scroll calls.
 */
window.scrollTo = () => {};
