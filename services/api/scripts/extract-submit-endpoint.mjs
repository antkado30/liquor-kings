#!/usr/bin/env node
/**
 * extract-submit-endpoint.mjs — mine a Playwright network.har from an RPA run
 * for MILO's backend API calls, with one job above all: FIND THE SUBMIT /
 * CHECKOUT ENDPOINT the fast engine still lacks (the last unmapped call —
 * see docs/lk/architecture/ordering-speed-strategy.md).
 *
 * HOW IT DECIDES WHAT'S INTERESTING: every /LiquorOrderingApi/api/* call is
 * compared against the KNOWN endpoint map we already mined on 2026-06-28
 * (login, account, cart add/read/clear, inventory/check, validate, taxes,
 * distributor, products, orders history). Anything NOT in that map is flagged
 * NEW — on a real submitted order's HAR, the checkout call is by definition
 * new. Mutations (POST/PUT/PATCH/DELETE) among the new calls are promoted to
 * SUBMIT CANDIDATES, and any response whose body carries a non-null
 * confirmationNumber is flagged regardless of anything else.
 *
 * SAFETY: HARs from real runs hold live JWTs and the login password.
 * Everything printed or written is REDACTED first:
 *   - Authorization / Cookie / Set-Cookie header values
 *   - accessToken / refreshToken / password / token JSON fields (any depth)
 * The raw HAR itself never leaves disk, and this script never uploads,
 * deletes, or modifies anything — read-only + one local report file.
 *
 * Usage:
 *   node services/api/scripts/extract-submit-endpoint.mjs [path/to/network.har]
 *   (no arg: newest .har under ./rpa-captures/, falling back to
 *    ./services/api/rpa-output/<dir>/network.har)
 *
 * Output:
 *   1. stdout — compact timeline of every MILO API call, then the NEW
 *      endpoints in full (redacted) detail, then the submit-candidate verdict.
 *   2. <har-path>.analysis.json — the same, machine-readable, redacted, with
 *      longer body excerpts for offline digging.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const API_MARKER = "/LiquorOrderingApi/api/";

// The endpoint map mined 2026-06-28 (ordering-speed-strategy.md). method +
// path template; :x matches one segment, * matches a trailing remainder.
const KNOWN_ENDPOINTS = [
  ["POST", "auth/login"],
  ["POST", "auth/refresh"],
  ["GET", "account"],
  ["GET", "membership/group"],
  ["GET", "validate"],
  ["GET", "users/cart"],
  ["DELETE", "users/cart"],
  ["POST", "users/cart/items"],
  ["PUT", "users/cart"],
  ["PUT", "users/cart/taxes"],
  ["PUT", "inventory/check"],
  ["POST", "products/code/:code"],
  ["GET", "products"],
  ["GET", "products/liquortypes"],
  ["GET", "distributor/all"],
  ["GET", "distributor/delivery"],
  ["GET", "users/current/orders"],
  // Benign informational calls confirmed on the 2026-06-28 validate HAR —
  // mapped here so a real order's report shows ONLY true signal as NEW.
  // (announcement/findByEndDate is also where MILO posts holiday delivery
  // schedule changes — worth an eyeball every capture.)
  ["GET", "announcement/flagged"],
  ["GET", "announcement/findByEndDate"],
  ["GET", "pr/current"],
];

function apiPathOf(url) {
  const i = url.indexOf(API_MARKER);
  if (i === -1) return null;
  const rest = url.slice(i + API_MARKER.length);
  const qIdx = rest.indexOf("?");
  return {
    path: (qIdx === -1 ? rest : rest.slice(0, qIdx)).replace(/\/+$/, ""),
    query: qIdx === -1 ? "" : rest.slice(qIdx),
  };
}

function matchesTemplate(method, pathStr, [tMethod, template]) {
  if (method.toUpperCase() !== tMethod) return false;
  const p = pathStr.split("/").filter(Boolean);
  const t = template.split("/").filter(Boolean);
  if (p.length !== t.length) return false;
  return t.every((seg, i) => seg.startsWith(":") || seg === "*" || seg.toLowerCase() === p[i].toLowerCase());
}

function isKnown(method, pathStr) {
  return KNOWN_ENDPOINTS.some((k) => matchesTemplate(method, pathStr, k));
}

// ─── Redaction ───────────────────────────────────────────────────────────────
const SECRET_FIELD_RE = /"(accessToken|refreshToken|password|token|jwt)"\s*:\s*"([^"]*)"/gi;
const SECRET_HEADER_RE = /^(authorization|cookie|set-cookie|x-api-key)$/i;

function redactBody(text) {
  if (typeof text !== "string" || text.length === 0) return text ?? null;
  // Field-level redaction keeps the JSON shape readable while killing values.
  let out = text.replace(SECRET_FIELD_RE, (_m, k) => `"${k}":"«REDACTED»"`);
  // Belt-and-suspenders: anything that LOOKS like a JWT (three dot-joined
  // base64url runs) gets masked even outside a known field name.
  out = out.replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "«REDACTED-JWT»");
  return out;
}

function redactHeaders(headers) {
  return (headers ?? [])
    .filter((h) => h?.name)
    .map((h) => ({
      name: h.name,
      value: SECRET_HEADER_RE.test(h.name) ? "«REDACTED»" : h.value,
    }));
}

// ─── Input resolution ────────────────────────────────────────────────────────
function newestHar() {
  const candidates = [];
  const scanDirs = [
    path.resolve(process.cwd(), "rpa-captures"),
    path.resolve(process.cwd(), "services/api/rpa-captures"),
  ];
  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".har")) candidates.push(path.join(dir, f));
    }
  }
  const outRoots = [
    path.resolve(process.cwd(), "services/api/rpa-output"),
    path.resolve(process.cwd(), "rpa-output"),
  ];
  for (const root of outRoots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      const har = path.join(root, d, "network.har");
      if (existsSync(har)) candidates.push(har);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

const harPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : newestHar();
if (!harPath || !existsSync(harPath)) {
  console.error(
    "No HAR found. Pass a path, or pull one first:\n  node services/api/scripts/pull-latest-har.mjs",
  );
  process.exit(1);
}

// ─── Parse ───────────────────────────────────────────────────────────────────
let har;
try {
  har = JSON.parse(readFileSync(harPath, "utf8"));
} catch (e) {
  console.error(`Could not parse ${harPath} as JSON: ${e?.message || e}`);
  process.exit(1);
}

const entries = (har?.log?.entries ?? [])
  .filter((e) => apiPathOf(e?.request?.url ?? "") !== null)
  .sort((a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime));

if (entries.length === 0) {
  console.error(
    `Parsed ${harPath} but found 0 ${API_MARKER} calls — is this HAR from a run that reached MILO's app?`,
  );
  process.exit(1);
}

const CONFIRMATION_RE = /"confirmationNumber"\s*:\s*(?!null)("?[\w-]+"?)/i;

const calls = entries.map((e, idx) => {
  const { path: apiPath, query } = apiPathOf(e.request.url);
  const method = (e.request.method || "GET").toUpperCase();
  const known = isKnown(method, apiPath);
  const reqBody = redactBody(e.request?.postData?.text ?? null);
  const resBody = redactBody(e.response?.content?.text ?? null);
  const confirmationInResponse = typeof resBody === "string" && CONFIRMATION_RE.test(resBody);
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  return {
    seq: idx + 1,
    startedDateTime: e.startedDateTime,
    method,
    path: apiPath,
    query,
    status: e.response?.status ?? null,
    timeMs: Math.round(e.time ?? 0),
    known,
    isMutation,
    confirmationInResponse,
    requestHeaders: redactHeaders(e.request?.headers),
    requestBody: reqBody,
    responseBodyExcerpt: typeof resBody === "string" ? resBody.slice(0, 20_000) : null,
  };
});

const newCalls = calls.filter((c) => !c.known);
const submitCandidates = calls.filter(
  (c) => c.confirmationInResponse || (!c.known && c.isMutation),
);

// ─── stdout report ───────────────────────────────────────────────────────────
console.log(`HAR: ${harPath}`);
console.log(`MILO API calls: ${calls.length} (${newCalls.length} not in the known 06-28 map)\n`);
console.log("── Timeline ──");
for (const c of calls) {
  const flags = [
    c.known ? "     " : "NEW  ",
    c.confirmationInResponse ? "CONF#" : "     ",
  ].join("");
  console.log(
    `${String(c.seq).padStart(3)}  ${flags}  ${c.method.padEnd(6)} ${(c.status ?? "—")
      .toString()
      .padEnd(4)} ${Math.round(c.timeMs).toString().padStart(6)}ms  /${c.path}${c.query ? c.query.slice(0, 60) : ""}`,
  );
}

if (newCalls.length > 0) {
  console.log("\n── NEW endpoints (not in the 06-28 map) — full detail ──");
  for (const c of newCalls) {
    console.log(`\n#${c.seq}  ${c.method} /${c.path}${c.query}   → ${c.status} in ${c.timeMs}ms`);
    if (c.requestBody) console.log(`  request body: ${c.requestBody.slice(0, 2_000)}`);
    if (c.responseBodyExcerpt) console.log(`  response: ${c.responseBodyExcerpt.slice(0, 2_000)}`);
  }
}

console.log("\n── Verdict ──");
if (submitCandidates.length === 0) {
  console.log(
    "No submit/checkout candidate found. This HAR looks like a validate-only run\n(every call matches the known add/validate map, no confirmationNumber in any\nresponse). The submit endpoint is still unmapped — this is expected on any\nrun that never clicked Checkout.",
  );
} else {
  console.log(`SUBMIT CANDIDATE(S): ${submitCandidates.length}`);
  for (const c of submitCandidates) {
    console.log(
      `  #${c.seq}  ${c.method} /${c.path}${c.query}  → ${c.status}` +
        `${c.confirmationInResponse ? "   ← response carries a confirmationNumber" : ""}`,
    );
  }
  console.log("\nFull redacted request/response detail is in the analysis JSON below.");
}

// ─── JSON report (redacted) ──────────────────────────────────────────────────
const reportPath = `${harPath}.analysis.json`;
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      harPath,
      generatedAt: new Date().toISOString(),
      totalMiloApiCalls: calls.length,
      newEndpointCount: newCalls.length,
      submitCandidateSeqs: submitCandidates.map((c) => c.seq),
      calls,
    },
    null,
    2,
  ),
);
console.log(`\nWrote redacted analysis: ${reportPath}`);
