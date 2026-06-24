/**
 * Liquor Kings AI Assistant — orchestration layer.
 *
 * The "moat" feature from the V1 spec (docs/lk/v1-spec.md): a liquor
 * expert AND a store assistant grounded in THIS STORE'S data. It answers
 * general spirits/bartending questions from knowledge, and store-specific
 * questions ("what did I order last week", "what should I reorder",
 * "why won't my cart validate") via tool access to live Supabase tables.
 *
 * Architecture: Claude API (Anthropic) with tool-use. NOT RAG/embeddings —
 * the store's data is structured SQL, small per-store, and changes
 * constantly. Tool-use queries live tables on demand; nothing goes stale.
 *
 * Tools implemented (V1):
 *   - query_catalog       → public.mlcc_items (13k+ SKUs)
 *   - query_rules         → public.mlcc_rules via lib/mlcc-rules.js
 *   - price_quote         → mlcc_items pricing math
 *   - query_order_history → public.execution_runs (per store)
 *   - query_inventory     → public.bottles (per store)
 *
 * Deferred to a later pass (V1 spec notes this): check_stock (live MLCC
 * stock) — V1 should use last-known stock from recent RPA runs rather
 * than spinning up Playwright per question.
 *
 * Requires env: ANTHROPIC_API_KEY. Model configurable via ANTHROPIC_MODEL
 * (default below) — verify the current model string at console.anthropic.com
 * if the API returns a model-not-found error.
 */

import Anthropic from "@anthropic-ai/sdk";
import supabaseDefault from "../config/supabase.js";
import { getAllActiveRules, getRulesByType } from "./mlcc-rules.js";
import {
  validateQuantityForSize,
  SPLIT_CASE_RULES_BY_SIZE_ML,
} from "../mlcc/milo-ordering-rules.js";
import { validateCartByCodes } from "./cart-validation.js";
import {
  resolveOrderLine,
  sizeFromText,
  preferFromText,
} from "./resolve-order-lines.js";

// Sonnet — the V1 model choice (strong tool-use, low per-question cost).
// Override with ANTHROPIC_MODEL if the string changes.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// Safety cap on the tool-use loop so a misbehaving model can't spin forever.
const MAX_TOOL_ITERATIONS = 8;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the Liquor Kings assistant — a knowledgeable liquor expert AND an in-app helper for the owner or manager of a Michigan liquor store.

You wear two hats. Many questions blend both:

1) LIQUOR EXPERT — Answer general liquor, spirits, wine, beer, and bartending questions from your own knowledge. No tools needed for pure general knowledge. Examples:
- Cocktail recipes, build specs, ratios, glassware, garnishes, technique, batching
- Brand and category education (bourbon vs rye, blanco vs reposado, gin styles, Scotch regions)
- Proof, ABV, aging, production methods, flavor profiles, tasting notes
- Food pairings, serving suggestions, customer recommendations, shelf talk
- Bartending best practices, bar program ideas, trends, responsible service
- Photos the user attaches: identify the bottle/label when visible, describe category and typical uses, suggest cocktails or pairings

For these, answer directly and practically — like an experienced spirits buyer or head bartender advising a retailer. Do not prepend every answer with "this is general information." Only note when store-specific data would change the answer (their price, whether THEY carry it, MLCC ordering constraints).

2) STORE ASSISTANT — When the question involves THIS store's MLCC catalog, codes, prices, order history, tracked inventory, MLCC ordering rules, cart validation, or how to use the Liquor Kings app, USE YOUR TOOLS. Never guess at a code, price, rule, quantity legality, past order, stock status, or whether the store carries something.

WHEN TO USE TOOLS (required — do not guess store facts):
- The code for specific bottles the user named, a pasted order list, or "what's the code for X?" → resolve_bottles (prefer this over query_catalog for named products — it handles MLCC's abbreviated names and picks the plain bottle over flavors, in one call)
- Browsing/searching the catalog by keyword or category, or an exact-code lookup → query_catalog
- MLCC ordering rules stored in the system → query_rules
- "What will X cost me?" / line totals → price_quote
- Past orders, what was ordered when → query_order_history
- What the store tracks on shelf / par / carry list → query_inventory
- Valid split-case quantities for a size or code → check_order_quantity
- "Will my cart validate?" / hypothetical cart checks → validate_cart

NEVER falsely say a bottle isn't carried. MLCC stores names abbreviated and oddly — "Jack Daniel's" is "J DANIELS", "Seagram's 7" is "SEAGRAM'S 7 CROWN", plastic bottles end in " PL". A plain keyword search can miss the standard product. ALWAYS use resolve_bottles before telling anyone a product isn't in the catalog. If it returns low confidence or no match, say "I couldn't pin that one down — here are the closest matches" and show the alternates; do not declare it missing.

WHEN TO ANSWER FROM KNOWLEDGE (no tools):
- Pure education: "What's the difference between mezcal and tequila?"
- Recipes and technique: "How do you make a Negroni?" / "What's a good rum for a Daiquiri?"
- Brand history, regions, production trivia, food pairings with no store angle
- General recommendations when the user is not asking about their inventory or orders

BLENDED QUESTIONS — combine knowledge + tools:
When a question has both a general and a store-specific angle, use tools first for store facts, then apply liquor expertise. Examples:
- "What tequila should I reorder?" → query_order_history and/or query_inventory and query_catalog; then recommend based on what they actually carry and order.
- "What's a good bourbon under $30 that we carry?" → query_catalog (category + price from results); add brief tasting notes from knowledge.
- "What pairs with the steak we're promoting?" → general pairing knowledge; optionally query_inventory if they ask what they stock for it.
- "Will this cart pass?" / photo of bottles for an order → validate_cart or check_order_quantity as needed; explain MLCC rules plainly.
- Attached photo of an unknown bottle → describe from the image; if they ask price or whether they carry it, follow up with query_catalog.

ABOUT LIQUOR KINGS:
Liquor Kings automates spirits ordering through the Michigan Liquor Control Commission (MLCC). The operator scans bottles, builds a cart, reviews it, and submits. Liquor Kings then enters the order into MLCC's MILO system, validates it, and submits — returning the MLCC confirmation number. The operator always reviews and approves the cart before anything is submitted; Liquor Kings never places an order the operator did not approve.

HOW THE OWNER USES LIQUOR KINGS (so you can help them use the app — when someone asks "how do I do X" or "where is Y," explain the user-facing steps simply and warmly):
- Scan tab: scan a bottle's barcode (or take a photo of it) to add that product to the cart.
- Catalog/Browse tab: browse and search the full MLCC catalog, filter by category, see prices and photos.
- Cart tab: review the cart (grouped by ADA distributor, with running liter totals, rule flags, and estimated cost), adjust quantities, Validate against MLCC, then Submit.
- Paste an order (on the Assistant/AI tab): paste a whole reorder list in any format — it finds every code, shows a verify screen, and adds them all to the cart at once. The fastest way to build a big order.
- Templates: save a recurring order (e.g. the weekly order) and reload it into the cart; one can be scheduled to prep automatically.
- Inventory: track shelf items, par levels, and low-stock reorder points.
- Orders: see past orders with their MLCC confirmation numbers; reorder from any of them.
- Settings (under More): store info, MLCC login + re-verify, legal links.
- Shelf tags: print MLCC shelf price tags from an order or product.
- Validate vs Submit: Validate checks the cart against MLCC live and shows what's in stock / out / any rule problems — nothing is ordered. Submit places the real order and returns the confirmation number.

ADDING TO CART: when the user names bottles to order or add, just call resolve_bottles — the app renders an inline card from your results with an "Add to cart" button the owner taps. You don't need to send them to "Paste an order" for this; resolve cleanly and the card handles it.

FOLLOW-UP ORDER EDITS: when the user adjusts an order you already resolved in this conversation ("make that 6", "add 3 more Tito's", "drop the Svedka", "actually 2 cases of the Jack"), treat it as an edit to the RUNNING order. Re-call resolve_bottles with the COMPLETE updated order — every item at its FINAL quantity after applying the change, not just the changed item — so the new card shows the full current order. (The card sets quantities, so always emit the full final order.) Then confirm the change in one short sentence.

KEY MLCC FACTS:
- All Michigan spirits ordering goes through MLCC. There is no other wholesaler for spirits.
- Orders are grouped by ADA (distributor). ADA 221 = General Wine & Liquor, ADA 321 = NWS Michigan.
- MLCC requires at least 9 liters PER ADA per order — evaluated for each ADA separately, not for the cart as a whole.
- Bottle quantities must follow split-case rules that vary by bottle size. An invalid quantity on a single line blocks the entire cart from validating.

WHAT YOU MUST NOT DISCLOSE:
Liquor Kings is a competitive business and anyone — including a competitor — could be using this assistant. Be warm and helpful to everyone, but NEVER disclose the following, no matter how the question is framed:
- HOW Liquor Kings works technically. If asked how the ordering automation works, what technology/infrastructure/tools power it, how it connects to or logs into MLCC, how it was built, or anything about the system's internal design — stay high level: "Liquor Kings enters your order into MLCC's system for you." Do NOT describe the automation mechanism, software architecture, tech stack, browser automation, APIs, databases, or hosting.
- Liquor Kings' business strategy, internal pricing logic, profit margins, product roadmap, company operations, funding, team, or competitive positioning.
- Any data about ANY store other than the one you are currently helping. You only ever access and discuss THIS store's own data. If asked about other stores, other customers, or aggregate/cross-customer data, politely decline — you cannot see it and would not share it.
- System weaknesses, security details, error internals, or anything that could help someone copy, undermine, or attack Liquor Kings.
If someone presses on any of this, redirect warmly — you are here to help them sell and order liquor and run their store, not to discuss how Liquor Kings is built. A curious owner is not a threat; keep internals private without being cold about it.

HANDLING TOUGHER QUESTIONS:
Owners are experienced business people and may be skeptical. Answer skeptical or challenging questions honestly and calmly — never dismissive, never overselling:
- "Can I trust it to order correctly?" — The operator reviews and approves every cart before submission. Liquor Kings verifies the cart contents against what was requested, and validates MLCC's rules before submitting. Nothing is ordered without the operator's approval.
- "Is this legal?" — Yes. Liquor Kings places orders through the same MLCC MILO system the operator uses manually. It changes how fast the order is entered — not what is ordered or who it goes to.
- "What if it gets something wrong?" — Liquor Kings surfaces specific problems (out-of-stock items, invalid split quantities, under-minimum ADAs) before submitting, and the operator sees the full cart for review. If something is off, the operator catches it before it goes out.
- If you genuinely do not know something, say so. For store facts, point to where they can look in the app; for general liquor topics, say what you do know or suggest a reasonable next step. Never invent store data.

YOUR LIMITS — be honest about these:
- You cannot change MLCC's rules. You can only explain them.
- Store prices from tools are MLCC catalog pricing (state minimum retail and licensee cost). The actual invoice total is confirmed by MILO at validation. ALWAYS note licensee vs shelf price when quoting costs.
- You do not place orders yourself. The operator submits orders through the app.
- General liquor knowledge can be wrong or outdated on niche topics — be honest about uncertainty on obscure brands or recent releases.

TONE & FORMATTING — Liquor Kings is a premium product. Talk like a sharp, confident human who knows liquor and retail, NOT a report generator:
- Keep it SHORT. Most questions deserve 1–3 sentences. Lead with the direct answer. Only go longer when the owner clearly asks for depth or a real list.
- Write in natural prose — like texting a knowledgeable friend who runs liquor stores. NEVER use a markdown table; on the owner's phone tables render as ugly raw pipes (| --- |). This is the single most important rule. No tables, ever.
- Use bold almost never — at most one key number or name in an answer, and only when it genuinely helps. Do NOT bold whole phrases, every line, or every label. No section headers. No walls of bullet points; a short bulleted list is fine ONLY when you're truly listing 3+ distinct items.
- Prices: say them in a sentence, not a layout. e.g. "Tito's 750ml is $16.95 a bottle at your cost — state minimum shelf is $19.99, and it comes 12 to a case." Never build a price table.
- Sound premium and self-assured: warm, direct, a little personality, zero corporate stiffness. Never robotic, never over-hedged.
- Don't echo the question back or pad with filler ("Great question!", "Here's the pricing you requested"). Just answer.
- Only add a follow-up question if it's genuinely useful — don't tack "want me to…" onto every reply.
- Still: lead with the answer, use concrete numbers and names from tool results, and if a tool returns no data say so plainly — never invent store data (you may still offer general guidance: "I didn't find that in your catalog, but generally…").
- If the user sends a photo with little or no text, describe what you see briefly and offer a helpful next step.`;

// ── Tool definitions (Anthropic tool-use schema) ──────────────────────────

const TOOLS = [
  {
    name: "query_catalog",
    description:
      "Search the MLCC spirits catalog. Use to look up a product's MLCC code, size, category, or state minimum price. Search by name keyword, exact MLCC code, or category.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Name keyword to search for, e.g. 'tito' or 'jack daniel'",
        },
        code: {
          type: "string",
          description: "Exact MLCC product code, e.g. '100009'",
        },
        category: {
          type: "string",
          description: "Category filter, e.g. 'VODKA' or 'BOURBON'",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 10, max 25)",
        },
      },
    },
  },
  {
    name: "resolve_bottles",
    description:
      "Find the correct MLCC code for one or many specific bottles the user named. Pass the items you parsed from their message. Returns the best-match code per item + alternates + a confidence flag, in ONE call. ALWAYS prefer this over query_catalog when the user names specific bottles, pastes an order list, or asks for codes — it handles MLCC's abbreviated names (e.g. 'Jack Daniel's' is stored as 'J DANIELS', 'Seagram's 7' as 'SEAGRAM'S 7') and picks the plain bottle over flavored variants, so it won't falsely miss a standard the way a raw name search does. If a result's confidence is 'review' or 'none', tell the user and show the alternates rather than guessing.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Bottles to resolve, parsed from the user's message.",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Brand + variant, e.g. \"Jack Daniel's\" or \"Crown Royal Apple\". Keep flavor/variant words; drop size words.",
              },
              size: {
                type: "string",
                description:
                  "Size if stated: one of '750ml','375ml','200ml','1000ml','1750ml','50ml'. Map slang: fifth=750ml, pint=375ml, half pint=200ml, half gallon/handle=1750ml.",
              },
              qty: { type: "number", description: "Quantity requested, if stated." },
            },
            required: ["name"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "query_rules",
    description:
      "Look up MLCC ordering rules — order minimums, quantity/split-case rules, workflow rules, account rules, stock handling, returns, pricing. Optionally filter by rule type.",
    input_schema: {
      type: "object",
      properties: {
        rule_type: {
          type: "string",
          enum: [
            "order_minimum",
            "size_quantity",
            "workflow",
            "account",
            "stock",
            "return",
            "pricing",
          ],
          description: "Optional category filter. Omit to get all rules.",
        },
      },
    },
  },
  {
    name: "price_quote",
    description:
      "Compute the cost of ordering a quantity of a specific MLCC product. Returns the licensee price (the store's approximate per-bottle cost — quote THIS for 'what will it cost me'), the base price (MILO's gross line basis), the state minimum retail price (legal shelf floor), case size, and when the price last changed.",
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "MLCC product code",
        },
        quantity: {
          type: "number",
          description: "Number of bottles",
        },
      },
      required: ["code", "quantity"],
    },
  },
  {
    name: "query_order_history",
    description:
      "Get this store's past Liquor Kings order runs (execution runs) — status, when submitted, what was ordered. Use for 'what did I order last week' style questions.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max runs to return (default 10, max 25)",
        },
        status: {
          type: "string",
          description:
            // 2026-06-14 full-app sweep: actual execution_runs.status values
            // are queued/running/succeeded/failed/canceled — "completed" is
            // not a real value. The old description told the model to pass
            // "completed", which matched zero rows and silently produced an
            // empty (wrong) "you have no orders" answer for the most common
            // question ("what did I order that completed"). Listed the real
            // values; toolQueryOrderHistory also normalizes "completed" as
            // a defensive fallback.
            "Optional status filter — one of: 'queued', 'running', 'succeeded', 'failed', 'canceled'",
        },
      },
    },
  },
  {
    name: "query_inventory",
    description:
      "Get this store's current tracked bottle inventory (products the store carries, with shelf prices). Use for 'what do I carry' / 'what am I low on' style questions.",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Optional name keyword filter",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 25, max 100)",
        },
      },
    },
  },
  {
    name: "check_order_quantity",
    description:
      "Check whether an order quantity is valid for a bottle size under MLCC split-case rules, and get the list of legal quantities for that size. Use for 'can I order 8 of this', 'is 13 a valid quantity for a 750ml', or 'what quantities can I order for a 1.75L'. Provide a bottle size in mL OR an MLCC code (its size is looked up).",
    input_schema: {
      type: "object",
      properties: {
        quantity: {
          type: "number",
          description: "The quantity the owner wants to order",
        },
        size_ml: {
          type: "number",
          description:
            "Bottle size in mL (e.g. 750, 1750). Provide this OR code.",
        },
        code: {
          type: "string",
          description:
            "MLCC code — its bottle size will be looked up. Provide this OR size_ml.",
        },
      },
      required: ["quantity"],
    },
  },
  {
    name: "validate_cart",
    description:
      "Validate a full cart of items against ALL MLCC rules at once — the per-ADA 9-liter minimum AND the per-size split-case quantity rules. Use this to answer 'why won't my cart validate', 'is this cart OK to submit', or to check a hypothetical order. Returns the per-ADA liter breakdown and every blocking problem with suggested fixes.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "The cart items to validate",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "MLCC product code" },
              quantity: { type: "number", description: "Quantity of bottles" },
            },
            required: ["code", "quantity"],
          },
        },
      },
      required: ["items"],
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────

function clampLimit(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

async function toolQueryCatalog(input, { supabase }) {
  let query = supabase
    .from("mlcc_items")
    .select(
      "code,name,size_ml,case_size,category,subcategory,abv,proof,state_min_price,licensee_price,base_price,upc,price_changed_at",
    );
  if (input.code) {
    query = query.eq("code", String(input.code).trim());
  } else {
    if (input.search) {
      /*
        Punctuation/spacing-proof search (Tito's class, swept 2026-06-10).
        "Titos" / "Tito's" / curly-apostrophe "Tito’s" must all find
        "TITO'S HANDMADE VODKA". Match raw name AND the generated
        space/punct-free name_searchable column — same pattern as
        /catalog/browse. Commas/parens stripped from the raw term to
        keep PostgREST .or() syntax safe.
      */
      const rawTerm = String(input.search).trim();
      const stripped = rawTerm.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (stripped.length >= 2) {
        const safeRaw = rawTerm.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
        query = query.or(
          `name.ilike.%${safeRaw}%,name_searchable.ilike.%${stripped}%`,
        );
      } else {
        query = query.ilike("name", `%${rawTerm}%`);
      }
    }
    if (input.category) {
      query = query.ilike("category", `%${String(input.category).trim()}%`);
    }
  }
  query = query.limit(clampLimit(input.limit, 10, 25));
  const { data, error } = await query;
  if (error) return { error: `catalog query failed: ${error.message}` };
  return { count: data?.length ?? 0, items: data ?? [] };
}

async function toolQueryRules(input, { supabase }) {
  try {
    const rules = input.rule_type
      ? await getRulesByType(input.rule_type, { supabase })
      : await getAllActiveRules({ supabase });
    // Trim to the fields the model needs — keep the payload small.
    const trimmed = rules.map((r) => ({
      code: r.code,
      rule_type: r.rule_type,
      name: r.name,
      description: r.description,
      parameters: r.parameters,
    }));
    return { count: trimmed.length, rules: trimmed };
  } catch (e) {
    return { error: `rules query failed: ${e?.message || e}` };
  }
}

async function toolPriceQuote(input, { supabase }) {
  const code = String(input.code ?? "").trim();
  const quantity = Number(input.quantity);
  if (!code) return { error: "price_quote requires a code" };
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "price_quote requires a positive quantity" };
  }
  const { data, error } = await supabase
    .from("mlcc_items")
    .select(
      "code,name,size_ml,case_size,state_min_price,licensee_price,base_price,price_changed_at",
    )
    .eq("code", code)
    // code is NOT unique alone (unique key is code+ada_number); a multi-
    // distributor SKU returns >1 row and .maybeSingle() would 500. Pin to the
    // canonical lowest-ADA row. (Smirnoff-bug class sweep, 2026-06-09.)
    .order("ada_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { error: `price lookup failed: ${error.message}` };
  if (!data) return { error: `no catalog item found for code ${code}` };

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const licensee = num(data.licensee_price);
  const base = num(data.base_price);
  const stateMin = num(data.state_min_price);
  const lineTotal = (unit) =>
    unit != null ? Number((unit * quantity).toFixed(2)) : null;

  return {
    code: data.code,
    name: data.name,
    size_ml: data.size_ml,
    case_size: data.case_size ?? null,
    quantity,
    // licensee_price is the number the owner actually cares about — the
    // approximate per-bottle cost to the store. Lead with this.
    licensee_price_per_bottle: licensee,
    licensee_line_total: lineTotal(licensee),
    // base_price is the gross line basis MILO shows before tax/discount.
    base_price_per_bottle: base,
    base_line_total: lineTotal(base),
    // state minimum retail = the legal price floor for selling on the shelf.
    state_minimum_retail_per_bottle: stateMin,
    last_price_change: data.price_changed_at ?? null,
    note: "licensee_price is the store's approximate per-bottle cost — quote this as the answer to 'what will this cost me'. base_price is MILO's gross line basis (before tax and discount). state_minimum_retail is the lowest the store may legally sell at on the shelf. The exact invoice total is confirmed by MILO when the cart is validated.",
  };
}

async function toolQueryOrderHistory(input, { supabase, storeId }) {
  if (!storeId) {
    return {
      count: 0,
      runs: [],
      note: "No store context provided — cannot look up order history.",
    };
  }
  let query = supabase
    .from("execution_runs")
    .select("id,status,worker_notes,error_message,started_at,finished_at,created_at,payload_snapshot")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  if (input.status) {
    // 2026-06-14 full-app sweep: normalize common synonyms the model may
    // still produce ("completed"/"complete"/"done" -> "succeeded",
    // "error" -> "failed", "cancelled" -> "canceled") so a near-miss term
    // doesn't silently return zero rows.
    const STATUS_SYNONYMS = {
      completed: "succeeded",
      complete: "succeeded",
      done: "succeeded",
      success: "succeeded",
      error: "failed",
      errored: "failed",
      cancelled: "canceled",
    };
    const raw = String(input.status).trim().toLowerCase();
    query = query.eq("status", STATUS_SYNONYMS[raw] ?? raw);
  }
  query = query.limit(clampLimit(input.limit, 10, 25));
  const { data, error } = await query;
  if (error) return { error: `order history query failed: ${error.message}` };
  // payload_snapshot can be large — summarize rather than dump it whole.
  const runs = (data ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    started_at: r.started_at,
    finished_at: r.finished_at,
    error_message: r.error_message,
    item_count: Array.isArray(r.payload_snapshot?.items)
      ? r.payload_snapshot.items.length
      : null,
  }));
  return {
    count: runs.length,
    runs,
    note:
      runs.length === 0
        ? "This store has no Liquor Kings order runs yet."
        : undefined,
  };
}

async function toolQueryInventory(input, { supabase, storeId }) {
  if (!storeId) {
    return {
      count: 0,
      items: [],
      note: "No store context provided — cannot look up inventory.",
    };
  }
  let query = supabase
    .from("bottles")
    .select("name,mlcc_code,upc,size_ml,category,shelf_price,is_active")
    .eq("store_id", storeId);
  /*
    Punctuation/spacing-proof search (Tito's class, swept 2026-06-10).
    `bottles` has NO name_searchable generated column (that's on
    mlcc_items only), so normalize in JS instead: pull the store's
    inventory (small per store) and filter on a stripped name. Keeps
    "Titos" matching "Tito's" without a migration.
  */
  const searchTermRaw = input.search ? String(input.search).trim() : "";
  const searchStripped = searchTermRaw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wantLimit = clampLimit(input.limit, 25, 100);
  query = query.limit(searchStripped ? 500 : wantLimit);
  const { data, error } = await query;
  if (error) return { error: `inventory query failed: ${error.message}` };
  let items = data ?? [];
  if (searchStripped) {
    items = items
      .filter((row) =>
        String(row.name ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .includes(searchStripped),
      )
      .slice(0, wantLimit);
  }
  return {
    count: items.length,
    items,
    note:
      items.length === 0
        ? "This store has no tracked bottle inventory yet."
        : undefined,
  };
}

async function toolCheckOrderQuantity(input, { supabase }) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity)) {
    return { error: "check_order_quantity requires a numeric quantity" };
  }
  let sizeMl = Number(input.size_ml);
  const code = input.code ? String(input.code).trim() : null;
  let caseSize = Number(input.case_size);
  if (!Number.isInteger(caseSize) || caseSize <= 0) caseSize = undefined;

  // Look up size_ml / case_size from the code when either is needed. case_size
  // is required to verify full-case-only sizes (50ml / 100ml).
  if (code && (!Number.isFinite(sizeMl) || sizeMl <= 0 || caseSize === undefined)) {
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code,name,size_ml,case_size")
      .eq("code", code)
      // code is not unique alone (code+ada_number is) — pin to lowest ADA so a
      // multi-distributor SKU can't 500 .maybeSingle().
      .order("ada_number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { error: `catalog lookup failed: ${error.message}` };
    if (!data) return { error: `no catalog item found for code ${code}` };
    if (!Number.isFinite(sizeMl) || sizeMl <= 0) sizeMl = Number(data.size_ml);
    if (caseSize === undefined && data.case_size != null) {
      const cs = Number(data.case_size);
      if (Number.isInteger(cs) && cs > 0) caseSize = cs;
    }
  }
  if (!Number.isFinite(sizeMl) || sizeMl <= 0) {
    return { error: "provide either size_ml or code" };
  }

  const result = validateQuantityForSize(quantity, sizeMl, code, caseSize);
  const allowed = SPLIT_CASE_RULES_BY_SIZE_ML[sizeMl];
  return {
    quantity,
    size_ml: sizeMl,
    code: code ?? undefined,
    valid: result.valid,
    reason:
      result.reason ??
      (result.valid ? "Quantity is valid for this bottle size." : undefined),
    suggested_alternatives: result.suggestedAlternatives,
    legal_split_quantities_for_size: Array.isArray(allowed)
      ? allowed.length === 0
        ? "full case only — no split orders allowed for this size"
        : allowed
      : "this size is not in the MLCC split-case table",
  };
}

async function toolValidateCart(input, { supabase }) {
  // Shared with the POST /cart/:storeId/validate endpoint — see
  // lib/cart-validation.js. One rule engine, one enrichment path.
  const result = await validateCartByCodes(supabase, input?.items);
  if (!result.ok) {
    return { error: result.error, unknown_codes: result.unknownCodes };
  }
  return {
    valid: result.valid,
    errors: result.errors,
    ada_breakdown: result.adaBreakdown,
    items_validated: result.itemsValidated,
    unknown_codes: result.unknownCodes,
  };
}

/**
 * resolve_bottles — THE bottle/code finder. Takes the items the model parsed
 * from the user's message and returns the best MLCC code per item via the
 * deterministic resolver (size-aware, flavor-penalized, and resilient to MLCC's
 * abbreviated names like "J DANIELS"). One call handles a whole list — no
 * per-item tool-loop, no missed standards. Prefer this over query_catalog
 * whenever the user names specific bottles or asks for codes.
 */
async function toolResolveBottles(input, { supabase }) {
  const items = Array.isArray(input.items) ? input.items.slice(0, 60) : [];
  if (items.length === 0) return { error: "resolve_bottles requires items: [{name, size?, qty?}]" };
  // Full enough for the client to build a valid cart line (id/ada/size/case),
  // plus the human-readable size string the model uses when it talks.
  const fmt = (c) =>
    c
      ? {
          id: c.id,
          code: c.code,
          name: c.name,
          size: c.bottle_size_label || (c.bottle_size_ml ? `${c.bottle_size_ml}ml` : null),
          ada_number: c.ada_number,
          ada_name: c.ada_name,
          bottle_size_ml: c.bottle_size_ml,
          bottle_size_label: c.bottle_size_label,
          case_size: c.case_size,
          licensee_price: c.licensee_price,
          base_price: c.base_price,
          min_shelf_price: c.min_shelf_price,
          proof: c.proof,
        }
      : null;
  const results = await Promise.all(
    items.map(async (it) => {
      const name = String(it?.name || "").trim();
      if (!name) return { requested: it, error: "missing name" };
      const sizeMl = sizeFromText(String(it?.size || "")) ?? sizeFromText(name) ?? null;
      const r = await resolveOrderLine(supabase, { name, sizeMl, prefer: preferFromText(name) });
      return {
        requested: { name, size: it?.size ?? null, qty: it?.qty ?? null },
        confidence: r.confidence,
        best: fmt(r.best),
        alternates: (r.alternates || []).slice(0, 4).map(fmt),
        match_count: r.total,
      };
    }),
  );
  return { count: results.length, results };
}

const TOOL_IMPL = {
  query_catalog: toolQueryCatalog,
  resolve_bottles: toolResolveBottles,
  query_rules: toolQueryRules,
  price_quote: toolPriceQuote,
  query_order_history: toolQueryOrderHistory,
  query_inventory: toolQueryInventory,
  check_order_quantity: toolCheckOrderQuantity,
  validate_cart: toolValidateCart,
};

async function runTool(name, input, ctx) {
  const impl = TOOL_IMPL[name];
  if (!impl) return { error: `unknown tool: ${name}` };
  try {
    return await impl(input ?? {}, ctx);
  } catch (e) {
    return { error: `tool ${name} threw: ${e?.message || e}` };
  }
}

/**
 * Parse a base64 image input. Accepts either a data URI ("data:image/jpeg;base64,...")
 * or raw base64. Returns { mediaType, data } or null if invalid.
 */
function parseImageInput(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const dataUriMatch = raw.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i);
  if (dataUriMatch) {
    return { mediaType: dataUriMatch[1].toLowerCase(), data: dataUriMatch[2].trim() };
  }
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.length < 64) return null;
  return { mediaType: "image/jpeg", data: cleaned };
}

function buildUserMessageContent({ question, imageDataUri }) {
  const trimmed = String(question ?? "").trim();
  const text =
    trimmed ||
    "The user attached a photo. Describe what you see and answer any implied question about liquor, products, or their store context.";
  const image = imageDataUri ? parseImageInput(imageDataUri) : null;
  if (!image) return trimmed || text;

  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    },
    { type: "text", text },
  ];
}

// ── Conversation history (fixes the "every one of what?" context loss) ─────

/**
 * Keep only well-formed prior turns, cap length to bound tokens. Additive:
 * with no history the assistant behaves exactly as before.
 */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));
}

// ── Bulk order resolution (paste a messy list → MLCC codes) ────────────────

const ORDER_PARSE_SYSTEM = `You parse a liquor store owner's messy, hand-written reorder list into structured JSON.

Output ONLY a JSON array, nothing else. Each element:
  { "name": string, "size": string|null, "qty": number|null }

Rules:
- "name" = brand + variant, WITHOUT size/packaging words. KEEP flavor/variant words (e.g. "Crown Royal Apple", "Dr McGillicuddy's Coffee", "Seagram's 7", "Mohawk 80").
- "size" = exactly one of "750ml","375ml","200ml","1000ml","1750ml","50ml", or null if unstated. Map slang: fifth=750ml, pint=375ml, half pint=200ml, "1/2 gallon"/"half gallon"/handle=1750ml, liter=1000ml.
- "qty" = the integer count requested, or null if it says "case" or is unstated.
- Expand shorthand: "same with pint 6" means the PREVIOUS brand, pint size, qty 6.
- If the text says plastic or glass, append " plastic" or " glass" to name.
- One element per distinct product+size. Never invent items not in the text.`;

function extractJsonArray(text) {
  const s = String(text || "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Resolve a free-text order list into MLCC codes for a verify-then-add-to-cart
 * flow. The LLM ONLY parses the messy text into {name,size,qty} lines; the
 * actual code match runs through the deterministic resolveOrderLine() — never
 * the LLM (one wrong code = a wrong bottle). Returns one entry per line with a
 * best match + alternates + confidence. This NEVER writes to the cart; the
 * client adds confirmed lines via the normal authenticated cart API.
 */
export async function resolveOrderList({ text, supabase = supabaseDefault }) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("resolveOrderList: text is required");
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("resolveOrderList: ANTHROPIC_API_KEY env var is not set");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: ORDER_PARSE_SYSTEM,
    messages: [{ role: "user", content: trimmed.slice(0, 6000) }],
  });
  const raw = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("resolveOrderList: could not parse the list into items");
  }

  const candidates = parsed
    .slice(0, 100)
    .map((item) => {
      const name = String(item?.name || "").trim();
      if (!name) return null;
      const sizeMl = sizeFromText(String(item?.size || "")) ?? sizeFromText(name) ?? null;
      const qty =
        Number.isFinite(Number(item?.qty)) && Number(item.qty) > 0
          ? Math.floor(Number(item.qty))
          : null;
      return { name, size: item?.size ?? null, sizeMl, qty, prefer: preferFromText(name) };
    })
    .filter(Boolean);

  const lines = await Promise.all(
    candidates.map(async (c) => {
      const r = await resolveOrderLine(supabase, c);
      return {
        input: { name: c.name, size: c.size, qty: c.qty },
        name: c.name,
        sizeMl: c.sizeMl,
        qty: c.qty,
        best: r.best,
        alternates: r.alternates,
        confidence: r.confidence,
        exactHit: r.exactHit,
        total: r.total,
      };
    }),
  );

  return { lines, parseModel: MODEL };
}

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Ask the Liquor Kings assistant a question.
 *
 * @param {object} args
 * @param {string} args.question - The operator's question
 * @param {string} [args.storeId] - Store UUID for store-scoped data tools
 * @param {string} [args.imageDataUri] - Optional base64 data URI for vision
 * @param {import('@supabase/supabase-js').SupabaseClient} [args.supabase]
 * @returns {Promise<{ answer: string, toolCalls: Array, model: string, iterations: number }>}
 */
export async function askAssistant({
  question,
  storeId = null,
  imageDataUri = null,
  history = [],
  supabase = supabaseDefault,
}) {
  const trimmed = String(question ?? "").trim();
  const hasImage =
    typeof imageDataUri === "string" && parseImageInput(imageDataUri) != null;
  if (!trimmed && !hasImage) {
    throw new Error("assistant: question or image is required");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "assistant: ANTHROPIC_API_KEY env var is not set — cannot call Claude API",
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ctx = { supabase, storeId };
  const toolCalls = [];

  const messages = [
    ...sanitizeHistory(history),
    {
      role: "user",
      content: buildUserMessageContent({ question: trimmed, imageDataUri }),
    },
  ];

  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const result = await runTool(block.name, block.input, ctx);
        toolCalls.push({ tool: block.name, input: block.input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Terminal turn — assemble the text answer.
    const answer = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { answer, toolCalls, model: MODEL, iterations };
  }

  // Loop exhausted — return whatever we can rather than throwing.
  return {
    answer:
      "I wasn't able to finish answering that — the request needed too many lookups. Try asking something more specific.",
    toolCalls,
    model: MODEL,
    iterations,
  };
}
