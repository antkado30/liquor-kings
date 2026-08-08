/**
 * updates-unread — the bell badge's brain (2026-08-05).
 *
 * Unread = entries newer than the last time the user OPENED the feed.
 * The watermark lives client-side (localStorage) — no server table,
 * no sync problem: the badge is per-device attention state, not data.
 *
 * Pure count function + tiny storage wrappers, pinned by tests.
 */
import type { UpdateEntry } from "../api/updates";

const STORAGE_KEY = "lk-updates-last-seen-v1";

/** Badge display caps at 9+ so the bell never gets crammed. */
export const UNREAD_DISPLAY_CAP = 9;

export function getLastSeenIso(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() !== "" ? v : null;
  } catch {
    return null;
  }
}

export function markUpdatesSeen(nowIso: string = new Date().toISOString()): void {
  try {
    localStorage.setItem(STORAGE_KEY, nowIso);
  } catch {
    /* storage full/blocked — badge just stays, harmless */
  }
}

/**
 * How many entries are newer than the watermark. Null watermark =
 * everything is new (first open shows the full count — that's honest:
 * the user has in fact never seen any of it).
 */
export function computeUnreadCount(
  updates: readonly Pick<UpdateEntry, "at">[],
  lastSeenIso: string | null,
): number {
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  if (!lastSeenIso) return updates.length;
  return updates.filter((u) => String(u.at) > lastSeenIso).length;
}

/** "9+" style label, or null when zero (no badge rendered). */
export function unreadBadgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > UNREAD_DISPLAY_CAP ? `${UNREAD_DISPLAY_CAP}+` : String(count);
}
