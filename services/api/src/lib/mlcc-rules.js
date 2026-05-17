/**
 * MLCC rules service module.
 *
 * Reads from the public.mlcc_rules table (seeded by migration 20260514230000)
 * and exposes a small typed query surface over it. This is the canonical
 * runtime entry point for MLCC business rules — replacing the hand-coded
 * constants in `services/api/src/mlcc/milo-ordering-rules.js` as we wire
 * callers over to it.
 *
 * Scope of this Phase 1 module:
 *   - Query helpers: getAllActiveRules, getRulesByType, getRuleByCode
 *   - Convenience accessors: getMinimumOrderLiters, getSplitCaseEligibilityRule
 *   - In-memory TTL cache so we don't hammer the DB on every cart validation
 *   - Falls back gracefully when DB rule rows are missing (keeps the hard-
 *     coded defaults from milo-ordering-rules.js as the safety net)
 *
 * NOT in scope yet:
 *   - validateCartAgainstRules (full validator — Phase 2, once we trust this)
 *   - Wiring this into the RPA Stage 3 pre-validation hook (separate commit)
 *   - Wiring this into scanner cart UI (separate commit)
 *
 * Reasoning: keep this module purely additive. No existing code path calls
 * into it. Building + shipping this commit can't regress production because
 * nothing depends on it yet. Once we've tested it standalone, we cut over
 * callers one at a time.
 *
 * Cache invalidation: clearMlccRulesCache() is exported for tests and for
 * any admin tool that mutates the rules table. The TTL is 5 minutes — rules
 * change ~never, but we don't want a stale process to ignore a fix for hours.
 */

import supabaseDefault from "../config/supabase.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const TABLE = "mlcc_rules";

let cache = { rules: null, expiresAt: 0 };

/**
 * Drop the in-memory cache. Useful in tests, after admin edits to the
 * rules table, or anywhere we suspect cache staleness.
 */
export function clearMlccRulesCache() {
  cache = { rules: null, expiresAt: 0 };
}

/**
 * Fetch all currently-active rules (deprecated_at IS NULL) from the DB,
 * cached for CACHE_TTL_MS.
 *
 * @param {object} [opts]
 * @param {import('@supabase/supabase-js').SupabaseClient} [opts.supabase] - Override the singleton client (for tests)
 * @param {boolean} [opts.forceRefresh] - Bypass cache, force a DB hit
 * @returns {Promise<Array<{
 *   id: string,
 *   rule_type: 'order_minimum'|'size_quantity'|'workflow'|'account'|'stock'|'return'|'pricing',
 *   code: string,
 *   name: string,
 *   description: string | null,
 *   parameters: Record<string, any>,
 *   source_url: string | null,
 *   source_quote: string | null,
 *   source_section: string | null,
 *   effective_date: string | null,
 *   deprecated_at: string | null,
 *   created_at: string,
 *   updated_at: string,
 * }>>}
 */
export async function getAllActiveRules(opts = {}) {
  const { supabase = supabaseDefault, forceRefresh = false } = opts;
  const now = Date.now();
  if (!forceRefresh && cache.rules && cache.expiresAt > now) {
    return cache.rules;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .is("deprecated_at", null);
  if (error) {
    throw new Error(`mlcc-rules: failed to fetch rules — ${error.message}`);
  }
  cache = { rules: data ?? [], expiresAt: now + CACHE_TTL_MS };
  return cache.rules;
}

/**
 * Filter active rules by type. Returns an empty array if no matches.
 *
 * @param {'order_minimum'|'size_quantity'|'workflow'|'account'|'stock'|'return'|'pricing'} type
 * @param {object} [opts] - Same options as getAllActiveRules
 */
export async function getRulesByType(type, opts) {
  if (!type) {
    throw new Error("mlcc-rules: getRulesByType requires a rule_type argument");
  }
  const all = await getAllActiveRules(opts);
  return all.filter((r) => r.rule_type === type);
}

/**
 * Get a single active rule by its short code slug. Returns null if not found.
 *
 * @param {string} code - e.g. 'min_9l_per_ada'
 * @param {object} [opts] - Same options as getAllActiveRules
 */
export async function getRuleByCode(code, opts) {
  if (!code) {
    throw new Error("mlcc-rules: getRuleByCode requires a code argument");
  }
  const all = await getAllActiveRules(opts);
  return all.find((r) => r.code === code) ?? null;
}

/**
 * Convenience: read the 9L-per-ADA minimum from the DB rule.
 * Falls back to 9 if the rule row is missing or malformed — keeps callers
 * safe during early adoption.
 *
 * @param {object} [opts] - Same options as getAllActiveRules
 * @returns {Promise<number>} liters
 */
export async function getMinimumOrderLiters(opts) {
  try {
    const rule = await getRuleByCode("min_9l_per_ada", opts);
    const mL = rule?.parameters?.min_volume_ml;
    if (typeof mL === "number" && mL > 0) return mL / 1000;
  } catch (e) {
    // Swallow DB errors — fall through to hardcoded default below.
    // The intent is that callers can always reach a sane number even
    // when the DB is unreachable; loud errors live in observability.
  }
  return 9;
}

/**
 * Convenience: get the split-case-eligibility-per-product rule.
 * Returns null if rule not found (means caller should treat all products
 * as full-case-only until we learn otherwise — defensive default).
 *
 * @param {object} [opts] - Same options as getAllActiveRules
 */
export async function getSplitCaseEligibilityRule(opts) {
  try {
    return await getRuleByCode("split_case_eligibility_per_product", opts);
  } catch {
    return null;
  }
}

/**
 * Diagnostic: which active rules carry `needs_verification: true`?
 * Used by audit tools to surface rules sourced from web-search snippets
 * (not directly verified PDF). Should be reviewed against original docs
 * when MLCC's PDFs become fully parseable.
 *
 * @param {object} [opts] - Same options as getAllActiveRules
 */
export async function getRulesNeedingVerification(opts) {
  const all = await getAllActiveRules(opts);
  return all.filter((r) => r?.parameters?.needs_verification === true);
}

/**
 * Diagnostic: summarize all active rules by category.
 * Returns { rule_type: count }. Used by health checks and admin diagnostics.
 *
 * @param {object} [opts] - Same options as getAllActiveRules
 */
export async function getRulesSummary(opts) {
  const all = await getAllActiveRules(opts);
  const summary = {};
  for (const r of all) {
    summary[r.rule_type] = (summary[r.rule_type] || 0) + 1;
  }
  return { total: all.length, byType: summary };
}
