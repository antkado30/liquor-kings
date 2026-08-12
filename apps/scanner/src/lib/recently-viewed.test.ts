import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecentlyViewed,
  loadRecentlyViewed,
  recordRecentlyViewed,
  type RecentlyViewedEntry,
} from "./recently-viewed";

function entry(over: Partial<RecentlyViewedEntry> = {}): RecentlyViewedEntry {
  return {
    code: "12345",
    baseName: "Tito's Handmade Vodka",
    image_url: null,
    licensee_price: 19.98,
    bottle_size_label: "750 mL",
    category: "Vodka",
    ...over,
  };
}

describe("recently-viewed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records and loads, most-recent first", () => {
    recordRecentlyViewed(entry({ code: "1", baseName: "Tito's" }));
    recordRecentlyViewed(entry({ code: "2", baseName: "Fireball" }));
    const list = loadRecentlyViewed();
    expect(list.map((e) => e.baseName)).toEqual(["Fireball", "Tito's"]);
  });

  it("dedupes by family name case-insensitively, keeping the newest size", () => {
    recordRecentlyViewed(entry({ code: "1", baseName: "Tito's", bottle_size_label: "750 mL" }));
    recordRecentlyViewed(entry({ code: "2", baseName: "Fireball" }));
    recordRecentlyViewed(entry({ code: "3", baseName: "TITO'S", bottle_size_label: "1.75 L" }));
    const list = loadRecentlyViewed();
    expect(list).toHaveLength(2);
    expect(list[0].code).toBe("3"); // re-view moved family to front...
    expect(list[0].bottle_size_label).toBe("1.75 L"); // ...with the NEW size
  });

  it("caps at 12", () => {
    for (let i = 0; i < 20; i++) {
      recordRecentlyViewed(entry({ code: String(i), baseName: `Brand ${i}` }));
    }
    expect(loadRecentlyViewed()).toHaveLength(12);
    expect(loadRecentlyViewed()[0].baseName).toBe("Brand 19");
  });

  it("ignores empty code or name", () => {
    recordRecentlyViewed(entry({ code: "" }));
    recordRecentlyViewed(entry({ baseName: "  " }));
    expect(loadRecentlyViewed()).toHaveLength(0);
  });

  it("survives malformed storage", () => {
    localStorage.setItem("lk-recently-viewed-v1", "{not json");
    expect(loadRecentlyViewed()).toEqual([]);
    localStorage.setItem("lk-recently-viewed-v1", JSON.stringify({ nope: 1 }));
    expect(loadRecentlyViewed()).toEqual([]);
    localStorage.setItem(
      "lk-recently-viewed-v1",
      JSON.stringify([{ code: "1", baseName: "Good" }, { junk: true }, null]),
    );
    expect(loadRecentlyViewed().map((e) => e.baseName)).toEqual(["Good"]);
  });

  it("clears", () => {
    recordRecentlyViewed(entry());
    clearRecentlyViewed();
    expect(loadRecentlyViewed()).toEqual([]);
  });
});
