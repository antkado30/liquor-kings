import express from "express";
import supabase from "../config/supabase.js";
import { getLatestPriceBookRun, ingestMlccPriceBook } from "../mlcc/mlcc-price-book-ingestor.js";

const router = express.Router();

function requireServiceRole(req, res) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: "Server misconfiguration" });
    return false;
  }
  const auth = req.headers.authorization?.trim();
  const expected = `Bearer ${key}`;
  if (auth !== expected) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

router.get("/status", async (req, res) => {
  try {
    const latestRun = await getLatestPriceBookRun(supabase);
    res.json({ ok: true, latestRun });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

router.post("/ingest", async (req, res) => {
  if (!requireServiceRole(req, res)) return;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const url = typeof body.url === "string" ? body.url : undefined;
    const dryRun = Boolean(body.dryRun);
    const result = await ingestMlccPriceBook(supabase, { url, dryRun });
    if (!result.ok) {
      return res.json({ ok: false, error: result.error || "Ingest failed" });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

function applyMlccItemsFilters(q, adaNumber, isNewItemQ) {
  let query = q;
  if (adaNumber) {
    query = query.eq("ada_number", adaNumber);
  }
  if (isNewItemQ === "true") {
    query = query.eq("is_new_item", true);
  } else if (isNewItemQ === "false") {
    query = query.eq("is_new_item", false);
  }
  return query;
}

/** Escape %, _, \\ for ilike patterns; strip commas so .or() filter stays valid. */
function escapeIlikeOrToken(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "");
}

router.get("/items", async (req, res) => {
  try {
    let page = Number.parseInt(String(req.query.page || "1"), 10);
    let limit = Number.parseInt(String(req.query.limit || "50"), 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, 200);

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const adaNumber = typeof req.query.adaNumber === "string" ? req.query.adaNumber.trim() : "";
    const isNewItemQ = req.query.isNewItem;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    if (search && /^\d+$/.test(search)) {
      let qExact = supabase.from("mlcc_items").select("*", { count: "exact" }).eq("code", search);
      qExact = applyMlccItemsFilters(qExact, adaNumber, isNewItemQ);
      const exactRes = await qExact.order("code", { ascending: true }).range(from, to);
      if (exactRes.error) {
        return res.status(500).json({ ok: false, error: exactRes.error.message });
      }
      if (exactRes.data?.length) {
        return res.json({
          ok: true,
          items: exactRes.data,
          total: exactRes.count ?? 0,
          page,
        });
      }

      let qName = supabase.from("mlcc_items").select("*", { count: "exact" }).ilike("name", `%${search}%`);
      qName = applyMlccItemsFilters(qName, adaNumber, isNewItemQ);
      const nameRes = await qName.order("code", { ascending: true }).range(from, to);
      if (nameRes.error) {
        return res.status(500).json({ ok: false, error: nameRes.error.message });
      }
      return res.json({
        ok: true,
        items: nameRes.data || [],
        total: nameRes.count ?? 0,
        page,
      });
    }

    let q = supabase.from("mlcc_items").select("*", { count: "exact" });

    if (search) {
      const token = escapeIlikeOrToken(search);
      q = q.or(`name.ilike.%${token}%,code.ilike.%${token}%`);
    }

    q = applyMlccItemsFilters(q, adaNumber, isNewItemQ);

    const { data: items, error, count } = await q.order("code", { ascending: true }).range(from, to);

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({
      ok: true,
      items: items || [],
      total: count ?? 0,
      page,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

export default router;
