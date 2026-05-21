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
  ingestMlccPriceBook: vi.fn(),
}));
vi.mock("../src/mlcc/mlcc-price-book-upc-enrichment.js", () => ({
  runUpcEnrichment: vi.fn(),
}));

import { checkAndIngestIfPriceBookChanged } from "../src/mlcc/mlcc-price-book-scheduler.js";
import {
  discoverLatestPriceBookUrl,
  ingestMlccPriceBook,
} from "../src/mlcc/mlcc-price-book-ingestor.js";
import { runUpcEnrichment } from "../src/mlcc/mlcc-price-book-upc-enrichment.js";

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
