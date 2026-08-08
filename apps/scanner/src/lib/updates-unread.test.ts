/**
 * Bell-badge pins (2026-08-05). The badge must be honest and calm:
 * exact count when small, 9+ when big, gone at zero, everything-new on
 * first ever open, and the watermark survives storage failures.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  computeUnreadCount,
  unreadBadgeLabel,
  getLastSeenIso,
  markUpdatesSeen,
} from "./updates-unread";

const e = (at: string) => ({ at });

beforeEach(() => {
  localStorage.clear();
});

describe("computeUnreadCount", () => {
  it("null watermark = everything unread (honest first open)", () => {
    expect(computeUnreadCount([e("2026-08-05T10:00:00Z"), e("2026-08-04T10:00:00Z")], null)).toBe(2);
  });

  it("counts only entries strictly newer than the watermark", () => {
    const seen = "2026-08-04T12:00:00Z";
    expect(
      computeUnreadCount(
        [e("2026-08-05T10:00:00Z"), e("2026-08-04T12:00:00Z"), e("2026-08-03T10:00:00Z")],
        seen,
      ),
    ).toBe(1);
  });

  it("empty feed = zero regardless of watermark", () => {
    expect(computeUnreadCount([], null)).toBe(0);
  });
});

describe("unreadBadgeLabel", () => {
  it("zero and negatives render no badge", () => {
    expect(unreadBadgeLabel(0)).toBe(null);
    expect(unreadBadgeLabel(-3)).toBe(null);
  });
  it("small counts are exact, big counts cap at 9+", () => {
    expect(unreadBadgeLabel(4)).toBe("4");
    expect(unreadBadgeLabel(9)).toBe("9");
    expect(unreadBadgeLabel(37)).toBe("9+");
  });
});

describe("watermark storage", () => {
  it("round-trips through localStorage", () => {
    expect(getLastSeenIso()).toBe(null);
    markUpdatesSeen("2026-08-05T12:00:00Z");
    expect(getLastSeenIso()).toBe("2026-08-05T12:00:00Z");
  });
});
