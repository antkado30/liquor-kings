import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const url = process.env.LK_PROD_SUPABASE_URL, key = process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY;
const s = createClient(url, key, { auth: { persistSession: false } });
const { data: carts, error: cErr } = await s.from("carts").select("id, store_id, status, created_at").order("created_at", { ascending: false }).limit(25);
if (cErr) { console.error("carts query failed:", cErr.message); process.exit(1); }
console.log(`found ${carts?.length ?? 0} carts total`);
for (const cart of carts ?? []) {
  const { data: items, error } = await s.from("cart_items").select("quantity, bottles ( name, mlcc_code, size_ml )").eq("cart_id", cart.id);
  if (error) { console.log(`cart ${cart.id.slice(0,8)} [${cart.status}] JOIN ERROR: ${error.message}`); continue; }
  console.log(`cart ${cart.id.slice(0,8)} [${cart.status}] created ${cart.created_at?.slice(0,10)} → ${items?.length ?? 0} lines`);
  if (!items?.length) continue;
  let n = 0;
  for (const it of items.sort((a,b)=>String(a.bottles?.name??"").localeCompare(String(b.bottles?.name??"")))) {
    const b = it.bottles ?? {};
    console.log(`  ${String(b.mlcc_code ?? "????").padEnd(8)} x${String(it.quantity).padEnd(4)} ${b.name ?? "?"} ${b.size_ml ? "(" + b.size_ml + "ml)" : ""}`);
    n += it.quantity;
  }
  console.log(`  TOTAL: ${items.length} lines, ${n} bottles\n`);
}
