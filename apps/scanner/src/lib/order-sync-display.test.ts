/**
 * order-sync-display pins (#36 Phase A, 2026-08-08). The anchor case is
 * first-order night: GW&L placed at $5,209.14 net, edited in MILO to
 * $2,029.14 — the page must lead with MILO's truth and keep the placed
 * number visible, to the penny.
 */
import { describe, expect, it } from "vitest";
import {
  orderMoneyView,
  orderDeliveryDate,
  orderLineCount,
  lineMoney,
  detailLines,
  timeAgoShort,
} from "./order-sync-display";

const NOW = Date.parse("2026-08-08T02:00:00.000Z");

describe("orderMoneyView", () => {
  it("the 8/5 edit: current leads, placed preserved, edited-down flagged", () => {
    const v = orderMoneyView({
      net_total: 5209.14,
      synced_at: "2026-08-08T01:00:00.000Z",
      synced_net_total: 2029.14,
    });
    expect(v).toMatchObject({
      current: 2029.14,
      placed: 5209.14,
      edited: true,
      editedDown: true,
      synced: true,
    });
  });

  it("unsynced rows show placement money and never claim an edit", () => {
    const v = orderMoneyView({ net_total: 1349.53, synced_at: null });
    expect(v).toMatchObject({
      current: 1349.53,
      placed: 1349.53,
      edited: false,
      synced: false,
    });
  });

  it("synced-and-identical shows one number, no chip (penny-equal)", () => {
    const v = orderMoneyView({
      net_total: 1349.53,
      synced_at: "2026-08-08T01:00:00.000Z",
      synced_net_total: 1349.53,
    });
    expect(v.edited).toBe(false);
    expect(v.current).toBe(1349.53);
  });

  it("a backfilled hole (no placement money) can't honestly claim an edit", () => {
    const v = orderMoneyView({
      net_total: null,
      gross_total: null,
      synced_at: "2026-08-08T01:00:00.000Z",
      synced_net_total: 240,
    });
    expect(v.current).toBe(240);
    expect(v.edited).toBe(false);
  });

  it("sub-penny float noise is not an edit", () => {
    const v = orderMoneyView({
      net_total: 2029.14,
      synced_at: "2026-08-08T01:00:00.000Z",
      synced_net_total: 2029.140000001,
    });
    expect(v.edited).toBe(false);
  });
});

describe("delivery / line count / line money", () => {
  it("synced delivery date wins; placement fills before sync", () => {
    expect(
      orderDeliveryDate({
        delivery_date: "2026-08-11",
        synced_at: "2026-08-08T01:00:00.000Z",
        synced_delivery_date: "2026-08-12",
      }),
    ).toBe("2026-08-12");
    expect(orderDeliveryDate({ delivery_date: "2026-08-11", synced_at: null })).toBe("2026-08-11");
  });

  it("line count follows the same precedence", () => {
    expect(
      orderLineCount({
        line_item_count: 31,
        synced_at: "2026-08-08T01:00:00.000Z",
        synced_line_item_count: 30,
      }),
    ).toBe(30);
    expect(orderLineCount({ line_item_count: 31, synced_at: null })).toBe(31);
    expect(orderLineCount({})).toBe(0);
  });

  it("lineMoney reads both field eras", () => {
    expect(lineMoney({ lineTotal: 48.18 })).toBe(48.18);
    expect(lineMoney({ lineSubtotal: 48.18 })).toBe(48.18);
    expect(lineMoney({})).toBe(null);
  });

  it("detailLines prefers synced lines, falls back to placement", () => {
    const synced = detailLines({ line_items: [{ a: 1 }], synced_line_items: [{ b: 2 }] });
    expect(synced.source).toBe("synced");
    expect(synced.lines).toEqual([{ b: 2 }]);
    const placed = detailLines({ line_items: [{ a: 1 }], synced_line_items: [] });
    expect(placed.source).toBe("placed");
    expect(placed.lines).toEqual([{ a: 1 }]);
  });
});

describe("timeAgoShort", () => {
  it("buckets sanely", () => {
    expect(timeAgoShort("2026-08-08T01:59:40.000Z", NOW)).toBe("just now");
    expect(timeAgoShort("2026-08-08T01:56:00.000Z", NOW)).toBe("4m ago");
    expect(timeAgoShort("2026-08-07T23:00:00.000Z", NOW)).toBe("3h ago");
    expect(timeAgoShort("2026-08-05T02:00:00.000Z", NOW)).toBe("3d ago");
    expect(timeAgoShort(null, NOW)).toBe(null);
    expect(timeAgoShort("garbage", NOW)).toBe(null);
  });
});
