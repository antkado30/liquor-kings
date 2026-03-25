import express from "express";
import supabase from "../config/supabase.js";
import {
  getBottleById,
  getBottleByMlccCode,
  getBottleByUpc,
  getRelatedBottles,
  searchBottles,
  searchBottlesCompact,
} from "../services/bottle.service.js";

const router = express.Router();

router.get("/search", async (req, res) => {
  const q = req.query.q?.trim();

  if (!q) {
    return res.status(400).json({ error: "Search query is required" });
  }

  const { data, error } = await searchBottles(supabase, q);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    query: q,
    count: data.length,
    data,
  });
});

router.get("/search/compact", async (req, res) => {
  const q = req.query.q?.trim();

  if (!q) {
    return res.status(400).json({ error: "Search query is required" });
  }

  const { data, error } = await searchBottlesCompact(supabase, q);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    query: q,
    count: data.length,
    data,
  });
});


router.get("/code/:mlccCode", async (req, res) => {
  const mlccCode = req.params.mlccCode?.trim();

  if (!mlccCode) {
    return res.status(400).json({ error: "MLCC code is required" });
  }

  const { data, error } = await getBottleByMlccCode(supabase, mlccCode);

  if (error) {
    return res.status(404).json({ error: "Bottle not found" });
  }

  res.json({
    success: true,
    data,
  });
});

router.get("/upc/:upc", async (req, res) => {
  const upc = req.params.upc?.trim();

  if (!upc) {
    return res.status(400).json({ error: "UPC is required" });
  }

  const { data, error } = await getBottleByUpc(supabase, upc);

  if (error) {
    return res.status(404).json({ error: "Bottle not found" });
  }

  res.json({
    success: true,
    data,
  });
});

router.get("/related/:id", async (req, res) => {
  const { id } = req.params;

  const { data: bottle, error: bottleError } = await getBottleById(supabase, id);

  if (bottleError) {
    return res.status(404).json({ error: "Bottle not found" });
  }

  const { data: related, error } = await getRelatedBottles(supabase, bottle);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    source: {
      id: bottle.id,
      name: bottle.name,
      mlcc_code: bottle.mlcc_code,
      upc: bottle.upc,
      size_ml: bottle.size_ml,
    },
    count: related.length,
    data: related,
  });
});


router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await getBottleById(supabase, id);

  if (error) {
    return res.status(404).json({ error: "Bottle not found" });
  }

  res.json({
    success: true,
    data,
  });
});

export default router;
