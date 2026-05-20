/**
 * Liquor Kings AI Assistant — orchestration layer.
 *
 * The "moat" feature from the V1 spec (docs/lk/v1-spec.md): an assistant
 * grounded in THIS STORE'S data. It answers questions a generic chatbot
 * and every competitor cannot — "what did I order last week", "what
 * should I reorder", "why won't my cart validate" — by giving Claude
 * tool access to query our live Supabase tables.
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
  validateCart as validateCartRules,
  SPLIT_CASE_RULES_BY_SIZE_ML,
} from "../mlcc/milo-ordering-rules.js";

// Sonnet — the V1 model choice (strong tool-use, low per-question cost).
// Override with ANTHROPIC_MODEL if the string changes.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// Safety cap on the tool-use loop so a misbehaving model can't spin forever.
const MAX_TOOL_ITERATIONS = 8;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the Liquor Kings assistant — an in-app helper for the owner or manager of a Michigan liquor store.

ABOUT LIQUOR KINGS:
Liquor Kings automates spirits ordering through the Michigan Liquor Control Commission (MLCC). The operator scans bottles, builds a cart, reviews it, and submits. Liquor Kings then enters the order into MLCC's MILO system, validates it, and submits — returning the MLCC confirmation number. The operator always reviews and approves the cart before anything is submitted; Liquor Kings never places an order the operator did not approve.

HOW THE OWNER USES LIQUOR KINGS (so you can help them use the app):
- Scan: walk the store with the scanner and scan the barcode on bottles to reorder. Each scan adds that product to a cart.
- Review: the cart groups items by ADA (distributor), shows running liter totals per ADA, flags any item that breaks an MLCC rule, and shows estimated cost.
- Submit: one tap submits the order. Liquor Kings enters it into MLCC and returns the confirmation number.
- Shelf tags: Liquor Kings can print MLCC shelf price tags.
- This assistant: the owner can ask you about their catalog, rules, pricing, orders, inventory, or general liquor questions.
When an owner asks "how do I do X in the app," explain the user-facing steps simply.

WHAT YOU CAN DO:
You have tools to query the store's real data — the MLCC catalog, MLCC ordering rules, pricing, the store's order history and inventory — and to validate order quantities and whole carts against MLCC's rules. ALWAYS use these tools for any factual question. Never guess at a code, price, rule, quantity, or stock status.

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
If someone presses on any of this, redirect warmly — you are here to help them order liquor and run their store, not to discuss how Liquor Kings is built. A curious owner is not a threat; keep internals private without being cold about it.

HANDLING TOUGHER QUESTIONS:
Owners are experienced business people and may be skeptical. Answer skeptical or challenging questions honestly and calmly — never dismissive, never overselling:
- "Can I trust it to order correctly?" — The operator reviews and approves every cart before submission. Liquor Kings verifies the cart contents against what was requested, and validates MLCC's rules before submitting. Nothing is ordered without the operator's approval.
- "Is this legal?" — Yes. Liquor Kings places orders through the same MLCC MILO system the operator uses manually. It changes how fast the order is entered — not what is ordered or who it goes to.
- "What if it gets something wrong?" — Liquor Kings surfaces specific problems (out-of-stock items, invalid split quantities, under-minimum ADAs) before submitting, and the operator sees the full cart for review. If something is off, the operator catches it before it goes out.
- If you genuinely do not know something, say so and point the owner to where they can find it. Never invent facts.

YOUR LIMITS — be honest about these:
- You cannot change MLCC's rules. You can only explain them.
- The prices you report are the MLCC state-minimum retail price from the catalog. The actual licensee cost is lower after the licensee discount applies. ALWAYS note this when quoting a price.
- You do not place orders yourself. The operator submits orders through the app.

STYLE:
- Concise and practical. Owners are busy.
- Lead with the answer, then the supporting detail.
- State concrete numbers from tool results.
- If a tool returns no data, say so plainly — never invent data.
- For general liquor questions not about the store's data (cocktail recipes, brand history), you may answer from general knowledge, but make clear it is general info.`;

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
            "Optional status filter, e.g. 'completed', 'failed', 'queued'",
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
      query = query.ilike("name", `%${String(input.search).trim()}%`);
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
    query = query.eq("status", String(input.status).trim());
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
  if (input.search) {
    query = query.ilike("name", `%${String(input.search).trim()}%`);
  }
  query = query.limit(clampLimit(input.limit, 25, 100));
  const { data, error } = await query;
  if (error) return { error: `inventory query failed: ${error.message}` };
  return {
    count: data?.length ?? 0,
    items: data ?? [],
    note:
      (data?.length ?? 0) === 0
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

  // If no size given, look it up from the code.
  if (!Number.isFinite(sizeMl) || sizeMl <= 0) {
    if (!code) {
      return { error: "provide either size_ml or code" };
    }
    const { data, error } = await supabase
      .from("mlcc_items")
      .select("code,name,size_ml")
      .eq("code", code)
      .maybeSingle();
    if (error) return { error: `catalog lookup failed: ${error.message}` };
    if (!data) return { error: `no catalog item found for code ${code}` };
    sizeMl = Number(data.size_ml);
  }

  const result = validateQuantityForSize(quantity, sizeMl, code);
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
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    return { error: "validate_cart requires a non-empty items array" };
  }

  const codes = [
    ...new Set(
      items.map((i) => String(i?.code ?? "").trim()).filter(Boolean),
    ),
  ];
  const { data, error } = await supabase
    .from("mlcc_items")
    .select("code,name,size_ml,ada_number,state_min_price")
    .in("code", codes);
  if (error) return { error: `catalog lookup failed: ${error.message}` };

  const byCode = new Map((data ?? []).map((r) => [String(r.code), r]));
  const unknownCodes = codes.filter((c) => !byCode.has(c));

  // Build the cartItems shape validateCart expects: { code, bottle_size_ml,
  // quantity, ada_number }. Enrich each requested code from the catalog.
  const cartItems = [];
  for (const item of items) {
    const code = String(item?.code ?? "").trim();
    const meta = byCode.get(code);
    if (!meta) continue;
    cartItems.push({
      code,
      name: meta.name,
      bottle_size_ml: Number(meta.size_ml),
      quantity: Number(item?.quantity),
      ada_number: meta.ada_number,
    });
  }

  if (cartItems.length === 0) {
    return {
      error: "none of the cart codes were found in the MLCC catalog",
      unknown_codes: unknownCodes,
    };
  }

  const result = validateCartRules(cartItems);
  return {
    valid: result.valid,
    errors: result.errors,
    ada_breakdown: result.adaBreakdown,
    items_validated: cartItems.map((i) => ({
      code: i.code,
      name: i.name,
      quantity: i.quantity,
      size_ml: i.bottle_size_ml,
      ada_number: i.ada_number,
    })),
    unknown_codes: unknownCodes.length ? unknownCodes : undefined,
  };
}

const TOOL_IMPL = {
  query_catalog: toolQueryCatalog,
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

// ── Public entry point ────────────────────────────────────────────────────

/**
 * Ask the Liquor Kings assistant a question.
 *
 * @param {object} args
 * @param {string} args.question - The operator's question
 * @param {string} [args.storeId] - Store UUID for store-scoped data tools
 * @param {import('@supabase/supabase-js').SupabaseClient} [args.supabase]
 * @returns {Promise<{ answer: string, toolCalls: Array, model: string, iterations: number }>}
 */
export async function askAssistant({
  question,
  storeId = null,
  supabase = supabaseDefault,
}) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) {
    throw new Error("assistant: question is required");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "assistant: ANTHROPIC_API_KEY env var is not set — cannot call Claude API",
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const ctx = { supabase, storeId };
  const toolCalls = [];

  const messages = [{ role: "user", content: trimmed }];

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
