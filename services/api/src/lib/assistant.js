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

// Sonnet — the V1 model choice (strong tool-use, low per-question cost).
// Override with ANTHROPIC_MODEL if the string changes.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

// Safety cap on the tool-use loop so a misbehaving model can't spin forever.
const MAX_TOOL_ITERATIONS = 8;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the Liquor Kings assistant — an in-app helper for the owner or manager of a Michigan liquor store.

Liquor Kings automates spirits ordering through the Michigan Liquor Control Commission (MLCC). The store operator uses it to scan bottles, build a cart, and submit orders to MLCC.

Your job: answer the operator's questions accurately and concisely, grounded in their REAL data. Always use the provided tools to look up facts — never guess at prices, codes, stock, order history, or rules.

Key MLCC facts you should know:
- All Michigan spirits ordering goes through MLCC. There is no other supplier.
- Orders are grouped by ADA (Authorized Distribution Agent / distributor). ADA 221 = General Wine & Liquor, ADA 321 = NWS Michigan.
- MLCC requires a minimum of 9 liters PER ADA per order — not per cart.
- Bottle quantities must follow split-case rules that vary by bottle size.

Style:
- Be concise and practical. Operators are busy.
- Lead with the answer, then supporting detail.
- When you use data from a tool, state the concrete numbers.
- If a tool returns no data (e.g. the store has no order history yet), say so plainly — do not invent data.
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
      "Compute the cost of ordering a quantity of a specific MLCC product, using the state minimum retail price from the catalog. Returns per-unit price and line total.",
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
    .select("code,name,size_ml,category,subcategory,abv,state_min_price,upc");
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
    .select("code,name,size_ml,state_min_price")
    .eq("code", code)
    .maybeSingle();
  if (error) return { error: `price lookup failed: ${error.message}` };
  if (!data) return { error: `no catalog item found for code ${code}` };
  const unitPrice = Number(data.state_min_price);
  const hasPrice = Number.isFinite(unitPrice) && unitPrice > 0;
  return {
    code: data.code,
    name: data.name,
    size_ml: data.size_ml,
    unit_price_state_minimum: hasPrice ? unitPrice : null,
    quantity,
    line_total_state_minimum: hasPrice
      ? Number((unitPrice * quantity).toFixed(2))
      : null,
    note: "Price is the MLCC state minimum retail price. Licensee cost is lower (licensee discount applies). This is a ballpark, not the exact licensee invoice total.",
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

const TOOL_IMPL = {
  query_catalog: toolQueryCatalog,
  query_rules: toolQueryRules,
  price_quote: toolPriceQuote,
  query_order_history: toolQueryOrderHistory,
  query_inventory: toolQueryInventory,
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
