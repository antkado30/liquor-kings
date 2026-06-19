import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// quiet: dotenv 17 prints a promo banner on load; suppress it (server-log noise).
dotenv.config({ quiet: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default supabase;