/**
 * Smoke test for the AI Assistant (lib/assistant.js).
 *
 * Exercises the Claude tool-use loop against real data with a few
 * representative questions and prints the answers + which tools fired.
 *
 * Requires:
 *   - ANTHROPIC_API_KEY  (the Claude API key)
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loaded from .env via
 *     config/supabase.js)
 *   - @anthropic-ai/sdk installed (npm install @anthropic-ai/sdk)
 *
 * Usage (locally):
 *   cd services/api
 *   node scripts/test-assistant.mjs
 *
 * Usage (inside Fly container — env already set):
 *   node /app/services/api/scripts/test-assistant.mjs
 *
 * Optional: pass a store UUID as arg 1 to exercise store-scoped tools:
 *   node scripts/test-assistant.mjs <store-uuid>
 */

import "dotenv/config";
import { askAssistant } from "../src/lib/assistant.js";

const storeId = process.argv[2] || null;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n[test-assistant] ANTHROPIC_API_KEY is not set.\n" +
      "Set it in services/api/.env (local) or as a Fly secret (prod) before running.\n",
  );
  process.exit(1);
}

// Questions chosen to exercise different tools:
//  1. catalog lookup
//  2. rules lookup
//  3. price math (catalog + price_quote)
//  4. order history (store-scoped — empty until a store has runs)
//  5. general knowledge fallback
const QUESTIONS = [
  "What's the MLCC code for Fris Vodka?",
  "What's the minimum order size from each distributor?",
  "How much would 12 bottles of MLCC code 100009 cost at state minimum?",
  "What were my last few orders?",
  "What's a classic cocktail made with vodka?",
];

console.log(`\n[test-assistant] model: ${process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6 (default)"}`);
console.log(`[test-assistant] storeId: ${storeId || "(none — store-scoped tools will return empty)"}\n`);

let pass = 0;
let fail = 0;

for (let i = 0; i < QUESTIONS.length; i += 1) {
  const q = QUESTIONS[i];
  console.log(`── Q${i + 1}: ${q}`);
  try {
    const t0 = Date.now();
    const result = await askAssistant({ question: q, storeId });
    const ms = Date.now() - t0;
    const tools = result.toolCalls.map((t) => t.tool).join(", ") || "(none)";
    console.log(`   tools used: ${tools}`);
    console.log(`   iterations: ${result.iterations}, ${ms}ms`);
    console.log(`   answer: ${result.answer}\n`);
    if (result.answer && result.answer.length > 0) {
      pass += 1;
    } else {
      console.log("   ✘ empty answer\n");
      fail += 1;
    }
  } catch (e) {
    console.log(`   ✘ FAILED: ${e?.message || e}\n`);
    fail += 1;
  }
}

console.log(`[test-assistant] ${pass}/${QUESTIONS.length} questions answered`);
process.exit(fail > 0 ? 1 : 0);
