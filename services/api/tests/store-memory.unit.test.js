import { describe, it, expect } from "vitest";
import {
  normalizePhrase,
  memoryKey,
  fetchMemoryIndex,
  recordCorrections,
  listMemory,
  forgetMemory,
} from "../src/lib/store-memory.js";

/**
 * STORE MEMORY (the moat, Phase A — 2026-07-24). Tony's design: every swap
 * on the resolve card teaches the store silently; a remembered phrase pins
 * its bottle green on the next resolve. These pins cover the pure keying
 * (the whole system's correctness hinges on learn-time and resolve-time
 * producing IDENTICAL keys) and the upsert/fetch contracts against a fake
 * supabase.
 */

describe("store-memory — keying (learn key ≡ lookup key)", () => {
  it("normalizePhrase is stable across casing and punctuation", () => {
    expect(normalizePhrase("Olive Cherry Vodka")).toBe(normalizePhrase("olive  cherry vodka"));
    expect(normalizePhrase("Tito's")).toBe(normalizePhrase("titos"));
  });

  it("memoryKey folds null size to a single slot, distinct from real sizes", () => {
    expect(memoryKey("stoli vanilla", null)).toBe("stoli vanilla::-1");
    expect(memoryKey("stoli vanilla", 750)).toBe("stoli vanilla::750");
    expect(memoryKey("stoli vanilla", 750)).not.toBe(memoryKey("stoli vanilla", 1750));
  });
});

/** Chainable fake supabase capturing calls; resolves at the await points the
    lib actually uses (.select() after update, plain insert, .in() select). */
function fakeMemoryDb({ existingRows = [], updateMatches = [] } = {}) {
  const calls = { updates: [], inserts: [], selects: 0 };
  const client = {
    from: (table) => {
      if (table !== "store_resolver_memory") throw new Error("wrong table " + table);
      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: existingRows, error: null }),
          }),
        }),
        update: (patch) => {
          const rec = { patch, eqs: {} };
          calls.updates.push(rec);
          const chain = {
            eq: (col, val) => {
              rec.eqs[col] = val;
              return chain;
            },
            is: (col, val) => {
              rec.eqs[col] = val;
              return chain;
            },
            select: () => Promise.resolve({ data: updateMatches, error: null }),
          };
          return chain;
        },
        insert: (row) => {
          calls.inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, calls };
}

describe("store-memory — fetchMemoryIndex", () => {
  it("indexes rows by (phrase,size) and fails SOFT to an empty map", async () => {
    const { client } = fakeMemoryDb({
      existingRows: [
        { id: "m1", phrase: "olive cherry vodka", size_ml: 750, mlcc_code: "29162", times_used: 3 },
      ],
    });
    const idx = await fetchMemoryIndex(client, "store-1", ["olive cherry vodka"]);
    expect(idx.get(memoryKey("olive cherry vodka", 750)).mlcc_code).toBe("29162");
    // no store / no phrases → empty map, zero queries
    expect((await fetchMemoryIndex(client, null, ["x"])).size).toBe(0);
    expect((await fetchMemoryIndex(client, "store-1", [])).size).toBe(0);
  });
});

describe("store-memory — recordCorrections (learn-on-swap)", () => {
  it("inserts a new memory with normalized phrase + provenance", async () => {
    const { client, calls } = fakeMemoryDb({ updateMatches: [] });
    const r = await recordCorrections(client, "store-1", [
      { name: "Olive Cherry Vodka", sizeMl: 750, mlccCode: "29162" },
    ]);
    expect(r.saved).toBe(1);
    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0]).toMatchObject({
      store_id: "store-1",
      phrase: "olive cherry vodka",
      size_ml: 750,
      mlcc_code: "29162",
      source: "card_swap",
    });
  });

  it("updates (newest word wins) when the (phrase,size) already exists", async () => {
    const { client, calls } = fakeMemoryDb({ updateMatches: [{ id: "m1" }] });
    const r = await recordCorrections(client, "store-1", [
      { name: "olive cherry vodka", sizeMl: 750, mlccCode: "27399" },
    ]);
    expect(r.saved).toBe(1);
    expect(calls.inserts).toHaveLength(0); // update path, no insert
    expect(calls.updates[0].patch.mlcc_code).toBe("27399");
    expect(calls.updates[0].eqs.store_id).toBe("store-1");
  });

  it("skips garbage rows (no phrase / no code) without erroring", async () => {
    const { client, calls } = fakeMemoryDb();
    const r = await recordCorrections(client, "store-1", [
      { name: "", mlccCode: "1" },
      { name: "x", mlccCode: "" },
    ]);
    expect(r.saved).toBe(0);
    expect(r.errors).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });
});

/** Chainable fake for the Phase B list/forget shapes. */
function fakePhaseBDb({ listRows = [], deleteMatches = [] } = {}) {
  const calls = { deletes: [] };
  const client = {
    from: () => ({
      select: () => {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: listRows, error: null }),
        };
        return chain;
      },
      delete: () => {
        const rec = { eqs: {} };
        calls.deletes.push(rec);
        const chain = {
          eq: (col, val) => {
            rec.eqs[col] = val;
            return chain;
          },
          is: (col, val) => {
            rec.eqs[col] = val;
            return chain;
          },
          select: () => Promise.resolve({ data: deleteMatches, error: null }),
        };
        return chain;
      },
    }),
  };
  return { client, calls };
}

describe("store-memory — Phase B chat teaching (list/forget)", () => {
  it("listMemory returns rows; empty store → empty array, no store → no query", async () => {
    const { client } = fakePhaseBDb({
      listRows: [{ phrase: "limoncello", size_ml: 750, mlcc_code: "19366", source: "card_swap", times_used: 2 }],
    });
    const rows = await listMemory(client, "store-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].mlcc_code).toBe("19366");
    expect(await listMemory(client, null)).toEqual([]);
  });

  it("forgetMemory deletes by NORMALIZED phrase + size key and reports truthfully", async () => {
    const { client, calls } = fakePhaseBDb({ deleteMatches: [{ id: "m1" }] });
    const r = await forgetMemory(client, "store-1", "Tito's Minis", 50);
    expect(r.deleted).toBe(true);
    expect(calls.deletes[0].eqs.phrase).toBe("titos minis"); // apostrophe-proof key
    expect(calls.deletes[0].eqs.size_ml).toBe(50);
  });

  it("forgetMemory on a non-existent memory reports deleted:false (never a false success)", async () => {
    const { client } = fakePhaseBDb({ deleteMatches: [] });
    const r = await forgetMemory(client, "store-1", "unicorn juice", null);
    expect(r.deleted).toBe(false);
  });
});
