import express from "express";
import supabase from "../config/supabase.js";

const router = express.Router();

router.get("/search", async (req, res) => {
  const q = req.query.q?.trim();

  if (!q) {
    return res.status(400).json({ error: "Search query is required" });
  }

  const { data, error } = await supabase
  .from("bottles")
  .select("id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active")
  .or(`name.ilike.%${q}%,mlcc_code.ilike.%${q}%,upc.ilike.%${q}%`)
  .limit(20);

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
router.get("/:id", async (req, res) => {
    const { id } = req.params;
  
    const { data, error } = await supabase
      .from("bottles")
      .select("id, name, mlcc_code, upc, image_url, size, size_ml, category, subcategory, state_min_price, shelf_price, is_active, created_at, updated_at")
      .eq("id", id)
      .single();
  
    if (error) {
      return res.status(404).json({ error: "Bottle not found" });
    }
  
    res.json({
      success: true,
      data,
    });
  });
export default router;