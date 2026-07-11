import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { makeBoundedFetch, resolveDbFetchTimeoutMs } from "../lib/bounded-fetch.js";

// quiet: dotenv 17 prints a promo banner on load; suppress it (server-log noise).
dotenv.config({ quiet: true });

/*
  Bounded DB calls (2026-07-11, claim-latency dig). Every Supabase call
  through this client now finishes or fails within the bound (default
  15s, emergency knob LK_DB_FETCH_TIMEOUT_MS) instead of hanging forever
  on a wedged socket — the 2026-06-14 wedge class, closed on the worker's
  API calls that day but never on the server's DB calls until now. A
  timeout surfaces as a normal DB error → existing handlers already fail
  loud. 15s < the worker's 20s claim abort, so the server always answers
  before the worker gives up on it. See src/lib/bounded-fetch.js.
*/
const dbFetchTimeoutMs = resolveDbFetchTimeoutMs(process.env.LK_DB_FETCH_TIMEOUT_MS);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { global: { fetch: makeBoundedFetch(dbFetchTimeoutMs) } }
);

export default supabase;