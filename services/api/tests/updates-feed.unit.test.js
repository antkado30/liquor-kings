/**
 * Updates-feed pins (2026-08-05, the bell). The feed is the store's
 * chronology — these pins hold: all four types shape correctly, price
 * moves show old → new when memory exists, newest-first ordering, the
 * cap, and junk rows (no timestamp / no confirmation) never render.
 */
import { describe, expect, it } from "vitest";
import { buildUpdatesFeed, FEED_CAP } from "../src/lib/updates-feed.js";

describe("buildUpdatesFeed", () => {
  it("shapes all four types and sorts newest-first across sources", () => {
    const feed = buildUpdatesFeed({
      priceRows: [
        {
          code: "1486",
          name: "GREY GOOSE VODKA",
          bottle_size_label: "1750 ML",
          licensee_price: 42.37,
          previous_licensee_price: 39.99,
          min_shelf_price: 49.99,
          price_changed_at: "2026-08-05T10:00:00Z",
        },
      ],
      newRows: [
        {
          code: "99999",
          name: "NEW BOTTLE",
          bottle_size_label: "750 ML",
          licensee_price: 19.99,
          upc: null,
          updated_at: "2026-08-05T09:00:00Z",
        },
      ],
      syncRows: [
        {
          kind: "full",
          price_book_date: "2026-08-02",
          total_items: 13828,
          updated_items: 214,
          new_items: 58,
          completed_at: "2026-08-05T11:00:00Z",
        },
      ],
      orderRows: [
        {
          ada_name: "NWS Michigan",
          confirmation_number: "A123",
          net_total: 2513.49,
          delivery_date: "2026-08-08",
          submitted_at: "2026-08-05T08:00:00Z",
        },
      ],
    });

    expect(feed.map((e) => e.type)).toEqual([
      "catalog_sync",
      "price_change",
      "new_bottle",
      "order_event",
    ]);
    expect(feed[0].title).toMatch(/Full price book ingested \(2026-08-02\)/);
    expect(feed[0].body).toBe("13828 items · 214 price changes · 58 new");
    expect(feed[1].body).toBe("Licensee $39.99 → $42.37 · shelf $49.99");
    expect(feed[2].body).toMatch(/barcode lands when MLCC posts it/);
    expect(feed[3].body).toBe("#A123 · $2513.49 · delivery 2026-08-08");
  });

  it("price change without memory says now-price instead of a fake arrow", () => {
    const feed = buildUpdatesFeed({
      priceRows: [
        {
          code: "1",
          name: "X",
          licensee_price: 10,
          previous_licensee_price: null,
          price_changed_at: "2026-08-05T10:00:00Z",
        },
      ],
    });
    expect(feed[0].body).toBe("Licensee now $10.00");
  });

  it("a new bottle WITH a upc says scannable now", () => {
    const feed = buildUpdatesFeed({
      newRows: [
        { code: "2", name: "Y", upc: "012345678905", updated_at: "2026-08-05T10:00:00Z" },
      ],
    });
    expect(feed[0].body).toMatch(/Scannable now\./);
    expect(feed[0].meta.scannable).toBe(true);
  });

  it("junk rows never render: missing timestamps and missing confirmations drop", () => {
    const feed = buildUpdatesFeed({
      priceRows: [{ code: "1", name: "X", price_changed_at: null }],
      newRows: [{ code: "2", name: "Y" }],
      syncRows: [{ kind: "full" }],
      orderRows: [{ submitted_at: "2026-08-05T10:00:00Z", confirmation_number: null }],
    });
    expect(feed).toHaveLength(0);
  });

  it("caps the merged feed", () => {
    const priceRows = Array.from({ length: 100 }, (_, i) => ({
      code: String(i),
      name: `B${i}`,
      licensee_price: 10,
      price_changed_at: `2026-08-05T10:${String(i % 60).padStart(2, "0")}:00Z`,
    }));
    const feed = buildUpdatesFeed({ priceRows });
    expect(feed).toHaveLength(FEED_CAP);
  });
});
