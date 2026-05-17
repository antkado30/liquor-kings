/**
 * Smoke test for the mlcc-rules service module.
 *
 * Exercises every exported function against the real DB (local or prod)
 * and prints a pass/fail report. No mocks — we want to know the module
 * works against actual rule data.
 *
 * Usage (locally, supabase running on default ports):
 *
 *   cd services/api
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
 *   node scripts/test-mlcc-rules.mjs
 *
 * Usage (inside the Fly container — env vars already set):
 *
 *   node /app/services/api/scripts/test-mlcc-rules.mjs
 *
 * Exits with code 0 on full pass, non-zero on any failure.
 */

import {
  getAllActiveRules,
  getRulesByType,
  getRuleByCode,
  getMinimumOrderLiters,
  getSplitCaseEligibilityRule,
  getRulesNeedingVerification,
  getRulesSummary,
  clearMlccRulesCache,
} from "../src/lib/mlcc-rules.js";

const checks = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✔" : "✘"} ${name}${detail ? "  — " + detail : ""}`);
}

console.log("\n[test-mlcc-rules] starting smoke test\n");

console.log("── 1. getAllActiveRules ───────────────────────");
let allRules;
try {
  allRules = await getAllActiveRules({ forceRefresh: true });
  record("returns an array", Array.isArray(allRules));
  record(
    "returns the expected ~29 active rules",
    allRules.length >= 25 && allRules.length <= 40,
    `got ${allRules.length}`,
  );
  if (allRules.length > 0) {
    const first = allRules[0];
    record(
      "first row has expected shape",
      first.id && first.rule_type && first.code && first.name && first.parameters,
      `keys: ${Object.keys(first).join(",")}`,
    );
  }
} catch (e) {
  record("DB query did not throw", false, e.message);
}

console.log("\n── 2. getRulesByType ───────────────────────");
try {
  const orderMin = await getRulesByType("order_minimum");
  record(
    "order_minimum returns at least the 9L rule",
    orderMin.length >= 1 && orderMin.some((r) => r.code === "min_9l_per_ada"),
    `got ${orderMin.length} rules`,
  );
  const workflow = await getRulesByType("workflow");
  record(
    "workflow returns multiple rules",
    workflow.length >= 5,
    `got ${workflow.length} rules`,
  );
  const empty = await getRulesByType("nonexistent_type");
  record("unknown type returns empty array", Array.isArray(empty) && empty.length === 0);
} catch (e) {
  record("type filter did not throw", false, e.message);
}

console.log("\n── 3. getRuleByCode ───────────────────────");
try {
  const min9 = await getRuleByCode("min_9l_per_ada");
  record(
    "min_9l_per_ada rule found",
    min9 && min9.rule_type === "order_minimum",
    min9 ? `params: ${JSON.stringify(min9.parameters)}` : "null",
  );
  record(
    "min_9l_per_ada has min_volume_ml param",
    min9?.parameters?.min_volume_ml === 9000,
    `got ${min9?.parameters?.min_volume_ml}`,
  );
  const missing = await getRuleByCode("nonexistent_rule_code");
  record("unknown code returns null", missing === null);
} catch (e) {
  record("getRuleByCode did not throw", false, e.message);
}

console.log("\n── 4. getMinimumOrderLiters ───────────────────────");
try {
  const liters = await getMinimumOrderLiters();
  record(
    "returns 9 from DB rule",
    liters === 9,
    `got ${liters}`,
  );
} catch (e) {
  record("getMinimumOrderLiters did not throw", false, e.message);
}

console.log("\n── 5. getSplitCaseEligibilityRule ───────────────────────");
try {
  const splitRule = await getSplitCaseEligibilityRule();
  record(
    "split-case-eligibility rule found",
    splitRule && splitRule.code === "split_case_eligibility_per_product",
  );
} catch (e) {
  record("getSplitCaseEligibilityRule did not throw", false, e.message);
}

console.log("\n── 6. getRulesNeedingVerification ───────────────────────");
try {
  const flagged = await getRulesNeedingVerification();
  record(
    "returns non-empty array (web-search-sourced rules flagged)",
    Array.isArray(flagged) && flagged.length > 0,
    `got ${flagged.length} flagged rules`,
  );
} catch (e) {
  record("getRulesNeedingVerification did not throw", false, e.message);
}

console.log("\n── 7. getRulesSummary ───────────────────────");
try {
  const summary = await getRulesSummary();
  record(
    "summary returns total + byType",
    typeof summary.total === "number" && typeof summary.byType === "object",
    `summary: ${JSON.stringify(summary)}`,
  );
  record(
    "summary has all 7 expected categories",
    [
      "order_minimum",
      "size_quantity",
      "workflow",
      "account",
      "stock",
      "return",
      "pricing",
    ].every((t) => summary.byType[t] > 0),
  );
} catch (e) {
  record("getRulesSummary did not throw", false, e.message);
}

console.log("\n── 8. Cache behavior ───────────────────────");
try {
  clearMlccRulesCache();
  const t0 = Date.now();
  await getAllActiveRules({ forceRefresh: true });
  const cold = Date.now() - t0;
  const t1 = Date.now();
  await getAllActiveRules(); // should hit cache
  const warm = Date.now() - t1;
  record(
    "cached call is faster than cold call",
    warm < cold,
    `cold=${cold}ms warm=${warm}ms`,
  );
} catch (e) {
  record("cache test did not throw", false, e.message);
}

const failed = checks.filter((c) => !c.ok);
console.log(
  `\n[test-mlcc-rules] ${checks.length - failed.length}/${checks.length} checks passed`,
);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ✘ ${f.name} — ${f.detail}`);
  process.exit(1);
}
process.exit(0);
