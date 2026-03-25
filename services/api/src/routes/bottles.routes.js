import express from "express";
import supabase from "../config/supabase.js";
import {
  getBottleById,
  getBottleByMlccCode,
  searchBottles,
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
