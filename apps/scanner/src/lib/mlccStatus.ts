/**
 * MILO connection status — tiny module-level store (M3, 2026-08-08).
 *
 * WHY THIS EXISTS: AuthGate already fetches the store profile on boot
 * and sign-in (it needs mlcc_credentials_last_verified_at for the
 * activation gate). The connect-MILO nudge banner on the scanner home
 * needs the same fact. Rather than a second profile fetch per home
 * view or new context plumbing through the router, AuthGate WRITES the
 * status here and the banner SUBSCRIBES via useSyncExternalStore.
 *
 * Tri-state, deliberately conservative:
 *   null  → unknown (boot pending, fetch failed, signed out) → NO banner
 *   true  → MILO creds verified → no banner
 *   false → store confirmed credless ("connect later" signup) → banner
 *
 * Only an explicit `false` ever nags. A profile fetch failure stays
 * null, so a flaky connection never shows a wrong "not connected"
 * banner to a fully connected store.
 */

type Status = boolean | null;

let status: Status = null;
const listeners = new Set<() => void>();

export function setMlccConnected(next: Status): void {
  if (status === next) return;
  status = next;
  for (const l of listeners) l();
}

export function getMlccConnected(): Status {
  return status;
}

export function subscribeMlccConnected(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
