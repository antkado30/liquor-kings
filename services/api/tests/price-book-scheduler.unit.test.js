import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * Tests for checkAndIngestIfPriceBookChanged — the MLCC catalog
 * auto-update logic. It compares the URL MLCC currently publishes against
 * the source_url of our last completed ingest and re-ingests only when
 * they differ. The external cron hits this daily, so its branching has to
 * be exactly right: a false "changed" hammers MLCC + re-upserts 13.8k
 * rows; a false "no change" means the catalog silently goes stale.
 *
 * The ingestor + UPC-enrichment modules are mocked so this stays a pure
 * logic test — no network, no DB.
 */

vi.mock("../src/mlcc/mlcc-price-book-ingestor.js", () => ({
  discoverLatestPriceBookUrl: vi.fn(),
  discoverLatestNewItemListUrl: vi.fn(),
  discoverLatestRetailPriceChangesUrl: vi.fn(),
  discoverLatestAdaChangesUrl: vi.fn(),
  ingestMlccPriceBook: vi.fn(),
}));
vi.mock("../src/mlcc/mlcc-price-book-upc-enrichment.js", () => ({
  runUpcEnrichment: vi.fn(),
  discoverLatestPriceBookTxtUrl: vi.fn(),
}));

import {
  checkAndIngestIfPriceBookChanged,
  checkAndIngestBetweenBookLists,
  checkAndRunUpcEnrichmentIfTxtChanged,
} from "../src/mlcc/mlcc-price-book-scheduler.js";
import {
  discoverLatestPriceBookUrl,
  discoverLatestNewItemListUrl,
  discoverLatestRetailPriceChangesUrl,
  discoverLatestAdaChangesUrl,
  ingestMlccPriceBook,
} from "../src/mlcc/mlcc-price-book-ingestor.js";
import {
  runUpcEnrichment,
  discoverLatestPriceBookTxtUrl,
} from "../src/mlcc/mlcc-price-book-upc-enrichment.js";

/** Mock Supabase: getLastCompletedIngestUrl ends its chain at .maybeSingle(). */
function mockSupabase({ lastRunRow = null, lastRunError = null } = {}) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: lastRunRow, error: lastRunError }),
  };
  return { from: () => builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override what they exercise.
  discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/default.xlsx?rev=default" });
  ingestMlccPriceBook.mockResolvedValue({ ok: true, totalItems: 13800, newItems: 5, updatedItems: 10 });
  runUpcEnrichment.mockResolvedValue({ ok: true });
});

describe("checkAndIngestIfPriceBookChanged — no change", () => {
  it("does NOT ingest when the published URL matches the last completed run", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=AAA" });
    const supabase = mockSupabase({ lastRunRow: { source_url: "https://mlcc/book.xlsx?rev=AAA" } });

    const r = await checkAndIngestIfPriceBookChanged(supabase);

    expect(r.ingested).toBe(false);
    expect(r.reason).toMatch(/no change/i);
    expect(ingestMlccPriceBook).not.toHaveBeenCalled();
  });
});

describe("checkAndIngestIfPriceBookChanged — change detected", () => {
  it("ingests when MLCC publishes a new URL, then runs UPC enrichment", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=NEW" });
    const supabase = mockSupabase({ lastRunRow: { source_url: "https://mlcc/book.xlsx?rev=OLD" } });

    const r = await checkAndIngestIfPriceBookChanged(supabase);

    expect(r.ingested).toBe(true);
    expect(r.reason).toMatch(/ingested/i);
    expect(ingestMlccPriceBook).toHaveBeenCalledWith(supabase, {
      url: "https://mlcc/book.xlsx?rev=NEW",
    });
    expect(runUpcEnrichment).toHaveBeenCalledTimes(1);
  });

  it("ingests on the first-ever run (no prior completed ingest)", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=FIRST" });
    const supabase = mockSupabase({ lastRunRow: null });

    const r = await checkAndIngestIfPriceBookChanged(supabase);

    expect(r.ingested).toBe(true);
    expect(ingestMlccPriceBook).toHaveBeenCalledTimes(1);
  });

  it("force:true ingests even when the URL is unchanged", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=SAME" });
    const supabase = mockSupabase({ lastRunRow: { source_url: "https://mlcc/book.xlsx?rev=SAME" } });

    const r = await checkAndIngestIfPriceBookChanged(supabase, { force: true });

    expect(r.ingested).toBe(true);
    expect(ingestMlccPriceBook).toHaveBeenCalledTimes(1);
  });
});

describe("checkAndIngestIfPriceBookChanged — failure handling", () => {
  it("does not ingest when MLCC page discovery fails", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: false, error: "HTTP 503" });

    const r = await checkAndIngestIfPriceBookChanged(mockSupabase());

    expect(r.ingested).toBe(false);
    expect(r.reason).toMatch(/discovery failed/i);
    expect(ingestMlccPriceBook).not.toHaveBeenCalled();
  });

  it("does not ingest when the last-run query errors", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=X" });
    const supabase = mockSupabase({ lastRunError: { message: "db timeout" } });

    const r = await checkAndIngestIfPriceBookChanged(supabase);

    expect(r.ingested).toBe(false);
    expect(r.reason).toMatch(/last ingest run/i);
    expect(ingestMlccPriceBook).not.toHaveBeenCalled();
  });

  it("reports ingested:false when the ingest itself fails", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=NEW" });
    ingestMlccPriceBook.mockResolvedValue({ ok: false, error: "parse failed" });
    const supabase = mockSupabase({ lastRunRow: { source_url: "https://mlcc/book.xlsx?rev=OLD" } });

    const r = await checkAndIngestIfPriceBookChanged(supabase);

    expect(r.ingested).toBe(false);
    expect(r.reason).toMatch(/ingest failed/i);
    expect(runUpcEnrichment).not.toHaveBeenCalled();
  });

  it("a UPC-enrichment failure does NOT undo a successful ingest", async () => {
    discoverLatestPriceBookUrl.mockResolvedValue({ ok: true, url: "https://mlcc/book.xlsx?rev=NEW" });
    runUpcEnrichment.mockRejectedValue(new Error("upc enrichment boom"));
    const supabase = mockSupabase({ lastRunRow: { source_url: "https://mlcc/book.xlsx?rev=OLD" } });

    const r = await checkAndIngestIfPriceBookChanged(supabase);

    expect(r.ingested).toBe(true);
    expect(r.upcEnrichment.ok).toBe(false);
  });
});

/*
  Between-book auto-ingest (2026-08-04): new-item / retail-price-changes /
  ada-changes ride the same daily cron tick. Each kind compares against
  ITS OWN ledger row, ingests additively with its own kind stamp, and one
  kind's failure never blocks the others.
*/

/** Ledger mock that answers per-kind: .eq("kind", K) selects the row. */
function mockRunsLedgerByKind(urlByKind) {
  return {
    from: () => {
      const state = { kind: null };
      const b = {
        select: () => b,
        eq: (col, val) => {
          if (col === "kind") state.kind = val;
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: urlByKind[state.kind] ? { source_url: urlByKind[state.kind] } : null,
            error: null,
          }),
      };
      return b;
    },
  };
}

describe("checkAndIngestBetweenBookLists", () => {
  const URLS = {
    new_item_list: "https://mlcc/new-item.xlsx?rev=N1",
    retail_price_changes: "https://mlcc/retail-changes.xlsx?rev=R1",
    ada_changes: "https://mlcc/ada-changes.xlsx?rev=A1",
  };

  beforeEach(() => {
    discoverLatestNewItemListUrl.mockResolvedValue({ ok: true, url: URLS.new_item_list, label: "New Item" });
    discoverLatestRetailPriceChangesUrl.mockResolvedValue({ ok: true, url: URLS.retail_price_changes, label: "Retail Changes" });
    discoverLatestAdaChangesUrl.mockResolvedValue({ ok: true, url: URLS.ada_changes, label: "ADA Changes" });
    ingestMlccPriceBook.mockResolvedValue({ ok: true, totalItems: 42, updatedItems: 40 });
  });

  it("all three unchanged → zero ingests, three calm no-change results", async () => {
    const supabase = mockRunsLedgerByKind({ ...URLS });

    const r = await checkAndIngestBetweenBookLists(supabase);

    expect(ingestMlccPriceBook).not.toHaveBeenCalled();
    expect(r.results).toHaveLength(3);
    for (const row of r.results) expect(row).toMatchObject({ ingested: false, reason: "no change" });
  });

  it("a newly published retail-changes list ingests with ITS kind and url only", async () => {
    const supabase = mockRunsLedgerByKind({
      ...URLS,
      retail_price_changes: "https://mlcc/retail-changes.xlsx?rev=OLD",
    });

    const r = await checkAndIngestBetweenBookLists(supabase);

    expect(ingestMlccPriceBook).toHaveBeenCalledTimes(1);
    expect(ingestMlccPriceBook).toHaveBeenCalledWith(supabase, {
      kind: "retail_price_changes",
      url: URLS.retail_price_changes,
    });
    const retail = r.results.find((x) => x.kind === "retail_price_changes");
    expect(retail).toMatchObject({ ingested: true, updatedItems: 40 });
  });

  it("first-ever run of a kind (no ledger row) ingests", async () => {
    const supabase = mockRunsLedgerByKind({
      new_item_list: URLS.new_item_list,
      retail_price_changes: URLS.retail_price_changes,
      // ada_changes has never been ingested → no row
    });

    await checkAndIngestBetweenBookLists(supabase);

    expect(ingestMlccPriceBook).toHaveBeenCalledTimes(1);
    expect(ingestMlccPriceBook).toHaveBeenCalledWith(supabase, {
      kind: "ada_changes",
      url: URLS.ada_changes,
    });
  });

  it("one kind's discovery failure never blocks the others (fail-soft)", async () => {
    discoverLatestNewItemListUrl.mockResolvedValue({ ok: false, error: "not on page" });
    const supabase = mockRunsLedgerByKind({
      retail_price_changes: URLS.retail_price_changes,
      ada_changes: "https://mlcc/ada-changes.xlsx?rev=OLD",
    });

    const r = await checkAndIngestBetweenBookLists(supabase);

    const newItem = r.results.find((x) => x.kind === "new_item_list");
    expect(newItem.ingested).toBe(false);
    expect(newItem.reason).toMatch(/discovery/);
    expect(ingestMlccPriceBook).toHaveBeenCalledTimes(1);
    expect(ingestMlccPriceBook).toHaveBeenCalledWith(supabase, {
      kind: "ada_changes",
      url: URLS.ada_changes,
    });
  });

  it("an ingest failure is reported for that kind and the sweep continues", async () => {
    ingestMlccPriceBook.mockResolvedValue({ ok: false, error: "parse exploded" });
    const supabase = mockRunsLedgerByKind({
      new_item_list: "https://mlcc/new-item.xlsx?rev=OLD",
      retail_price_changes: "https://mlcc/retail-changes.xlsx?rev=OLD",
      ada_changes: "https://mlcc/ada-changes.xlsx?rev=OLD",
    });

    const r = await checkAndIngestBetweenBookLists(supabase);

    expect(ingestMlccPriceBook).toHaveBeenCalledTimes(3);
    expect(r.results.every((x) => x.ingested === false)).toBe(true);
    expect(r.results.every((x) => /ingest failed: parse exploded/.test(x.reason))).toBe(true);
  });
});

/*
  TXT-change UPC enrichment (2026-08-05, the barcode auto-currency
  mandate). Found live: the Aug 2 Excel book published while the TXT
  (the ONLY UPC source) was still May's — enrichment only ran on
  full-ingest day, so late TXTs left new bottles unscannable until the
  next book. These pins hold the watch: own ledger kind, re-run on URL
  change, success-only ledger rows so failures retry next tick.
*/

/** Ledger mock with per-kind rows AND an insert capture. */
function mockLedgerWithInsert(urlByKind) {
  const inserts = [];
  const client = {
    from: () => {
      const state = { kind: null };
      const b = {
        select: () => b,
        eq: (col, val) => {
          if (col === "kind") state.kind = val;
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: urlByKind[state.kind] ? { source_url: urlByKind[state.kind] } : null,
            error: null,
          }),
        insert: (row) => {
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
      return b;
    },
  };
  return { client, inserts };
}

describe("checkAndRunUpcEnrichmentIfTxtChanged", () => {
  const TXT_NEW = "https://mlcc/aug-price-book-txt.txt?rev=AUG";
  const TXT_OLD = "https://mlcc/may-price-book-txt.txt?rev=MAY";

  beforeEach(() => {
    discoverLatestPriceBookTxtUrl.mockResolvedValue({ ok: true, url: TXT_NEW });
    runUpcEnrichment.mockResolvedValue({
      ok: true,
      url: TXT_NEW,
      parse: { headerFound: true },
      apply: { updatedRows: 13409 },
    });
  });

  it("unchanged TXT → no enrichment run", async () => {
    const { client } = mockLedgerWithInsert({ upc_txt: TXT_NEW });

    const r = await checkAndRunUpcEnrichmentIfTxtChanged(client);

    expect(r).toMatchObject({ ran: false, reason: "no change" });
    expect(runUpcEnrichment).not.toHaveBeenCalled();
  });

  it("a NEW TXT runs enrichment and writes a success ledger row (kind upc_txt)", async () => {
    const { client, inserts } = mockLedgerWithInsert({ upc_txt: TXT_OLD });

    const r = await checkAndRunUpcEnrichmentIfTxtChanged(client);

    expect(runUpcEnrichment).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ran: true, updatedRows: 13409, currentUrl: TXT_NEW });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      kind: "upc_txt",
      status: "complete",
      source_url: TXT_NEW,
      total_items: 13409,
    });
  });

  it("first-ever run (no ledger row) enriches", async () => {
    const { client } = mockLedgerWithInsert({});

    const r = await checkAndRunUpcEnrichmentIfTxtChanged(client);

    expect(r.ran).toBe(true);
    expect(runUpcEnrichment).toHaveBeenCalledTimes(1);
  });

  it("discovery failure is calm — no run, no ledger write", async () => {
    discoverLatestPriceBookTxtUrl.mockResolvedValue({ ok: false, error: "page down" });
    const { client, inserts } = mockLedgerWithInsert({});

    const r = await checkAndRunUpcEnrichmentIfTxtChanged(client);

    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/discovery/);
    expect(runUpcEnrichment).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("a FAILED enrichment writes NO ledger row so the next tick retries", async () => {
    runUpcEnrichment.mockResolvedValue({ ok: false, error: "header row not found" });
    const { client, inserts } = mockLedgerWithInsert({ upc_txt: TXT_OLD });

    const r = await checkAndRunUpcEnrichmentIfTxtChanged(client);

    expect(r).toMatchObject({ ran: false });
    expect(r.reason).toMatch(/enrichment failed/);
    expect(inserts).toHaveLength(0);
  });
});
