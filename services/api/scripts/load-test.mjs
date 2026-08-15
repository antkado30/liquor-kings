#!/usr/bin/env node
/**
 * load-test.mjs — the Wednesday-herd rehearsal (2026-08-13, Tony's
 * launch-readiness mandate: "we have to be able to handle every store
 * ordering at the same time").
 *
 * Zero-dependency read-path load harness. Simulates N concurrent
 * "stores" hammering the hot READ endpoints (health, browse, search,
 * grouped search) and reports RPS + p50/p95/p99 + error counts per
 * path. READ-ONLY by design — it can never place, validate, or touch
 * a cart. The write path (execution runs) is exercised separately and
 * deliberately: that goes through MILO and real money.
 *
 * USAGE (from services/api/ on the Mac — prod is reachable there):
 *   node scripts/load-test.mjs                       # 20 virtual stores, 30s, public paths only
 *   LK_LOAD_BEARER=<jwt> LK_LOAD_STORE_ID=<uuid> \
 *     node scripts/load-test.mjs --vus 50 --secs 60  # + authed browse/search paths
 *
 * Flags: --vus N (concurrent virtual stores, default 20)
 *        --secs N (duration, default 30)
 *        --base URL (default https://liquor-kings.fly.dev)
 *
 * Reading results: the API app is 2 shared-cpu Fly machines. If p95
 * stays under ~750ms and errors are 0 at --vus 50, launch-scale reads
 * are fine (50 concurrent actives ≈ several hundred stores' Wednesday
 * traffic — real stores think between taps). Scale knob if not:
 * `fly scale count -a liquor-kings N` (stateless, safe).
 *
 * RUN OFF-PEAK. It is polite load, but it is load.
 */

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const VUS = Number(flag("vus", 20));
const SECS = Number(flag("secs", 30));
const BASE = String(flag("base", "https://liquor-kings.fly.dev")).replace(/\/$/, "");
const BEARER = process.env.LK_LOAD_BEARER || null;
const STORE_ID = process.env.LK_LOAD_STORE_ID || null;

const SEARCHES = [
  "tito", "captain morgan", "fireball", "crown royal", "jack daniels",
  "smirnoff", "hennessy", "casamigos", "grey goose", "jameson",
];

/** Each entry: { name, path(), headers } — weight by repetition. */
function buildPaths() {
  const paths = [
    { name: "health", path: () => "/health" },
    { name: "health", path: () => "/health" },
    { name: "landing", path: () => "/" },
  ];
  if (BEARER && STORE_ID) {
    const auth = { Authorization: `Bearer ${BEARER}`, "X-Store-Id": STORE_ID };
    const q = () => SEARCHES[Math.floor(Math.random() * SEARCHES.length)];
    paths.push(
      { name: "browse", path: () => "/catalog/browse?limit=30", headers: auth },
      { name: "browse", path: () => "/catalog/browse?limit=30", headers: auth },
      {
        name: "grouped-search",
        path: () => `/price-book/items/grouped?q=${encodeURIComponent(q())}&limit=30`,
        headers: auth,
      },
      {
        name: "grouped-search",
        path: () => `/price-book/items/grouped?q=${encodeURIComponent(q())}&limit=30`,
        headers: auth,
      },
      { name: "orders-list", path: () => "/orders?limit=10", headers: auth },
    );
  } else {
    console.log("(no LK_LOAD_BEARER/LK_LOAD_STORE_ID — public paths only)");
  }
  return paths;
}

const stats = new Map(); // name -> { count, errors, ms: [] }
function record(name, ms, ok) {
  if (!stats.has(name)) stats.set(name, { count: 0, errors: 0, ms: [] });
  const s = stats.get(name);
  s.count += 1;
  if (!ok) s.errors += 1;
  s.ms.push(ms);
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}

async function vu(paths, deadline) {
  while (Date.now() < deadline) {
    const pick = paths[Math.floor(Math.random() * paths.length)];
    const t0 = Date.now();
    let ok = false;
    try {
      const res = await fetch(`${BASE}${pick.path()}`, {
        headers: pick.headers ?? {},
        signal: AbortSignal.timeout(15_000),
      });
      ok = res.ok;
      await res.arrayBuffer(); // drain the body — realistic client cost
    } catch {
      ok = false;
    }
    record(pick.name, Date.now() - t0, ok);
    // Real store owners think between taps — 100-400ms pause keeps this
    // honest load, not a synthetic DoS of our own product.
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 300));
  }
}

async function main() {
  const paths = buildPaths();
  console.log(`Herd rehearsal: ${VUS} virtual stores × ${SECS}s against ${BASE}`);
  const started = Date.now();
  const deadline = started + SECS * 1000;
  await Promise.all(Array.from({ length: VUS }, () => vu(paths, deadline)));
  const wallSecs = (Date.now() - started) / 1000;

  console.log(`\n${"path".padEnd(16)} ${"reqs".padStart(6)} ${"rps".padStart(6)} ${"errs".padStart(5)} ${"p50".padStart(6)} ${"p95".padStart(6)} ${"p99".padStart(6)}`);
  let totalReqs = 0;
  let totalErrs = 0;
  for (const [name, s] of [...stats.entries()].sort()) {
    const sorted = [...s.ms].sort((a, b) => a - b);
    totalReqs += s.count;
    totalErrs += s.errors;
    console.log(
      `${name.padEnd(16)} ${String(s.count).padStart(6)} ${(s.count / wallSecs).toFixed(1).padStart(6)} ${String(s.errors).padStart(5)} ${String(pct(sorted, 50)).padStart(6)} ${String(pct(sorted, 95)).padStart(6)} ${String(pct(sorted, 99)).padStart(6)}`,
    );
  }
  console.log(
    `\nTOTAL ${totalReqs} reqs @ ${(totalReqs / wallSecs).toFixed(1)} rps · ${totalErrs} errors (${((totalErrs / Math.max(1, totalReqs)) * 100).toFixed(2)}%)`,
  );
  console.log(
    totalErrs === 0
      ? "VERDICT: zero errors — read path held."
      : "VERDICT: errors present — check Fly metrics/logs before scaling conclusions.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
