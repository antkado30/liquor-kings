import { ingestMlccPriceBook } from "./mlcc-price-book-ingestor.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {() => void}
 */
export function startPriceBookScheduler(supabase) {
  console.log("[price-book-scheduler] started (daily check)");

  async function maybeIngestFirstOfMonth() {
    try {
      const now = new Date();
      if (now.getDate() !== 1) return;

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const startIso = startOfMonth.toISOString();
      const endIso = endOfMonth.toISOString();

      const { data: existing, error } = await supabase
        .from("mlcc_price_book_runs")
        .select("id")
        .eq("status", "complete")
        .gte("started_at", startIso)
        .lte("started_at", endIso)
        .limit(1);

      if (error) {
        console.log("[price-book-scheduler] skip: could not query runs:", error.message);
        return;
      }
      if (existing?.length) {
        console.log("[price-book-scheduler] skip: ingestion already completed this month");
        return;
      }

      console.log("[price-book-scheduler] triggering monthly price book ingestion");
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const result = await ingestMlccPriceBook(supabase, { priceBookDate: firstOfMonth });
      if (!result.ok) {
        console.log("[price-book-scheduler] ingestion failed:", result.error);
      } else {
        console.log("[price-book-scheduler] ingestion finished:", result);
      }
    } catch (e) {
      console.log("[price-book-scheduler] tick error:", e instanceof Error ? e.message : e);
    }
  }

  const id = setInterval(maybeIngestFirstOfMonth, DAY_MS);
  void maybeIngestFirstOfMonth();

  return () => {
    clearInterval(id);
    console.log("[price-book-scheduler] stopped");
  };
}
