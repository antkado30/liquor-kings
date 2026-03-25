import express from "express";
import supabase from "../config/supabase.js";
import { isUuid } from "../services/cart.service.js";
import {
  getInventoryForStore,
  getInventoryItemById,
  getInventorySummaryForStore,
} from "../services/inventory.service.js";

const router = express.Router();

router.get("/:storeId/summary", async (req, res) => {
  const { storeId } = req.params;

  const { data, error } = await getInventorySummaryForStore(supabase, storeId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    storeId,
    summary: data,
  });
});


router.get("/:storeId/:inventoryId", async (req, res) => {
  const { storeId, inventoryId } = req.params;

  if (!isUuid(inventoryId)) {
    return res.status(404).json({ error: "Inventory item not found" });
  }

  const { data, error } = await getInventoryItemById(
    supabase,
    storeId,
    inventoryId,
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(404).json({ error: "Inventory item not found" });
  }

  res.json({
    success: true,
    data,
  });
});


router.get("/:storeId", async (req, res) => {
  const { storeId } = req.params;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = req.query.limit;

  const { data, error } = await getInventoryForStore(supabase, storeId, {
    q,
    limit,
  });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    storeId,
    count: data.length,
    data,
  });
});

export default router;
