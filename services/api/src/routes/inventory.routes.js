import express from "express";
import supabase from "../config/supabase.js";
import { isUuid } from "../services/cart.service.js";
import {
  getInventoryByBottleId,
  getInventoryForStore,
  getInventoryItemById,
  getInventorySummaryForStore,
  getInventoryForStoreByLocation,
  getLowStockInventoryForStore,
  getOutOfStockInventoryForStore,
  getReorderCandidatesForStore,
  lookupInventoryForStore,
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

router.get("/:storeId/lookup", async (req, res) => {
  const { storeId } = req.params;
  const q = req.query.q?.trim();

  if (!q) {
    return res.status(400).json({ error: "Lookup query is required" });
  }

  const limit = req.query.limit;

  const { data, error } = await lookupInventoryForStore(
    supabase,
    storeId,
    q,
    limit,
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    storeId,
    query: q,
    count: data.length,
    data,
  });
});

router.get("/:storeId/bottle/:bottleId", async (req, res) => {
  const { storeId, bottleId } = req.params;

  if (!isUuid(bottleId)) {
    return res.status(404).json({ error: "Inventory item not found" });
  }

  const { data, error } = await getInventoryByBottleId(
    supabase,
    storeId,
    bottleId,
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    storeId,
    bottleId,
    count: data.length,
    data,
  });
});

router.get("/:storeId/low-stock", async (req, res) => {
  const { storeId } = req.params;
  const limit = req.query.limit;

  const { data, error } = await getLowStockInventoryForStore(
    supabase,
    storeId,
    limit,
  );

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

router.get("/:storeId/out-of-stock", async (req, res) => {
  const { storeId } = req.params;
  const limit = req.query.limit;

  const { data, error } = await getOutOfStockInventoryForStore(
    supabase,
    storeId,
    limit,
  );

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

router.get("/:storeId/reorder-candidates", async (req, res) => {
  const { storeId } = req.params;
  const limit = req.query.limit;

  const { data, error } = await getReorderCandidatesForStore(
    supabase,
    storeId,
    limit,
  );

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

router.get("/:storeId/location/:location", async (req, res) => {
  const { storeId, location } = req.params;
  const trimmed = location?.trim();

  if (!trimmed) {
    return res.status(400).json({ error: "Location is required" });
  }

  const limit = req.query.limit;

  const { data, error } = await getInventoryForStoreByLocation(
    supabase,
    storeId,
    trimmed,
    limit,
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({
    success: true,
    storeId,
    location: trimmed,
    count: data.length,
    data,
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
