import express from "express";
import cors from "cors";
import supabase from "./config/supabase.js";
import bottlesRouter from "./routes/bottles.routes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/bottles", bottlesRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Liquor Kings API running" });
});

app.get("/test-db", async (req, res) => {
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .limit(1);
  
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    res.json({ success: true, data });
  });
  app.get("/test-bottles", async (req, res) => {
    const { data, error } = await supabase
      .from("bottles")
      .select("*")
      .limit(5);
  
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    res.json({ success: true, data });
  });

  export default app;