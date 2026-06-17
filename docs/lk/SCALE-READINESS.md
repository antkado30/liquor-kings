# LIQUOR KINGS — SCALE READINESS ASSESSMENT (100s of stores)

**Ordered by Tony, 2026-06-16:** "Start preparing our system to be ready for
100s and 100s of stores, capable of handling all of them with minimum breaks."

**The bar** (Quality Mandate + Integrity Doctrine): hundreds of stores can
order on the same morning and the system never lies, never silently wedges,
and never makes a store wait blind. Where we hit a real ceiling, it scales
with a lever we control, and the user always sees honest status.

---

## The headline (read this first)

**The hard part is already done.** Everything that makes concurrency
*correct* is built and deployed:

- **Atomic claim** — `claimNextQueuedExecutionRun` is a compare-and-swap on
  `status='queued'`; two workers can never claim the same run. No double-orders.
- **Per-store serialization (#21)** — partial unique index
  `one_running_run_per_store` + claim prefilter; two runs for one store can
  never execute at once (no two browsers fighting one MILO cart).
- **Orphan reaper** — `running` runs with a >15-min stale heartbeat are marked
  failed (never auto-requeued, so a partial submit can't double).
- **Duplicate-submit tripwire (#20)** + **boundary gate (#17)** — a retry
  after an ambiguous checkout death refuses to place a second order.

So **scaling out is SAFE** — it's an ops + capacity + security problem now,
not a correctness rewrite. That's the existential risk retired. What remains
is known-shape engineering, ranked below.

---

## Ledger (ranked by blast radius)

| # | Sev | Area | The ceiling at 100s of stores | Lever / fix | Effort |
|---|-----|------|-------------------------------|-------------|--------|
| S1 | P0 | RPA throughput | **1 run per worker machine, serial.** 2 machines today = 2 concurrent orders ≈ 40 runs/hr/machine | Horizontal scale (`fly scale count`) — SAFE per the guarantees above. Needs autoscaling for the order-day peak + memory math | Scale = trivial; autoscale = S/M |
| S2 | P0 | Peak load (herd) | Common order days (Thu) concentrate hundreds of orders into a 1–2 hr window. **NOT worsened by schedulers** (verified — see below) | Autoscale to peak (S1) + **queue-position/ETA UX** so a waiting store sees "#14, ~10 min", never a dead spinner | M |
| S3 | P0 | Load multiplier | **Each order = 2–3 worker runs** (background pre-validate + re-validates after edits + submit). 300 stores ≈ 600–900 runs, not 300 | Adaptive pre-validate: throttle/disable background pre-validate under high fleet queue depth; fall back to on-demand foreground validate | M |
| S4 | P1 | Credential security (KMS) | **All MLCC passwords encrypted with ONE symmetric key in an env var** (`LK_CREDENTIAL_ENCRYPTION_KEY`). One leak = every store's MILO login | Envelope encryption via real KMS. Pragmatic on this stack: **Supabase Vault (pgsodium)** or cloud KMS (AWS/GCP). Per-store data keys, master in KMS | M/L (architectural — needs approach decision) |
| S5 | P1 | Warm-session economics | Warm session is **per-machine, store-keyed**; round-robin claims across many machines = no store→machine affinity, so at scale **most runs go cold** (~42s Stage 1+2 tax). The 25s warm path is a small-fleet luxury | Accept cold (simplest) OR cut cold cost (Stage 1 login / Stage 2 nav) OR store-affinity routing (complex) | Varies |
| S6 | P1 | External: MILO/MLCC | Hundreds of concurrent browser logins to michigan.gov **from Fly's egress IPs** can trip rate limits / look like an attack / get IP-blocked. We don't control MILO | Spread load, watch for blocks, consider distributed egress; build a "MILO is rate-limiting us" detector that fails loud, not silent | Investigate |
| S7 | P2 | DB capacity | supabase-js is REST/PostgREST + Supavisor pooler, so JS clients don't each hold a PG connection — bounded by Supabase **plan limits**, not code. Worker also makes a new client per run (minor waste) | Confirm pooler/transaction mode; watch plan limits as store count climbs; hoist worker client to a singleton | S |
| S8 | P2 | Fleet observability | At 100s of stores you must know the instant a store's order fails. Sentry wired (#29); Founder Console + `/admin/health` show fleet stats/queue/failure rate | Add per-store failure alerting (tell the store) + queue-depth alert for the peak | M |

---

## The throughput math (S1 + S3, why this is #1)

- One worker machine runs **one** RPA run at a time. A real ~39-item submit
  run is ~90s (cold: Stage 1 ~31s + Stage 2 ~11s + Stage 3 ~1.4s/item + Stage
  4/5). So **~40 runs/hour/machine**.
- **But each store's order spends 2–3 runs**: the silent background
  pre-validate, any re-validates after editing the cart, then the submit. So
  effective load ≈ **2.5× the store count**.

Rough machines-needed for the peak hour (at ~40 runs/hr/machine, 2.5 runs/order):

| Stores ordering in the peak hour | ~Worker runs | Machines needed |
|---|---|---|
| 50 | ~125 | ~3–4 |
| 100 | ~250 | ~6–7 |
| 300 | ~750 | ~19 |
| 500 | ~1,250 | ~31 |

Memory is fine per machine (2 GB holds one Chromium + one ~200 MB warm
session); **scale out (more machines), not up**. The real cost lever is
running many machines only during the order-day peak and scaling to ~2 the
rest of the week.

**This is why S3 (adaptive pre-validate) matters:** the background
pre-validate is a fantastic instant-feel win at small scale but it's the
biggest load multiplier. Under heavy fleet queue depth, the system should
quietly stop pre-validating and just do an on-demand foreground validate —
trading a little instant-feel for fleet survival. Make it adaptive, not
all-or-nothing.

---

## What is NOT a problem (verified, so we don't waste effort)

- **Schedulers don't herd.** The order-template "run-scheduler" only *marks*
  today's scheduled templates as "ready for review" (a home-screen banner) —
  it does **not** auto-fire RPA runs. The price-book scheduler is a single
  global daily job, not per-store. So the system never stampedes itself; the
  only herd is organic human same-day ordering.
- **Double-orders / cart collisions / orphan runs** — all structurally
  prevented (see headline). Horizontal scaling won't reintroduce them.

---

## How to scale the worker fleet TODAY (the immediate lever)

Safe because claim is atomic + per-store serialized:

```
# See current machines
fly status -a liquor-kings-worker

# Scale out for an expected peak (example: 8 machines)
fly scale count 8 -a liquor-kings-worker

# Scale back down after the peak
fly scale count 2 -a liquor-kings-worker
```

Before relying on this at scale, **load-test to find the REAL ceiling** — we
have the throughput numbers by estimate, not measurement. We don't yet know:
the true per-machine run time distribution under load, the memory headroom at
2–3 stacked cold runs, or where MILO starts pushing back (S6).

**BUILT 2026-06-16: `services/api/scripts/load-test-rpa.mjs`** — fires N
`validate_only` runs (mode hard-locked, never submits), records per-run queue
wait + duration + status + observed concurrency, prints p50/p95 + throughput.
Run from your Mac on a quiet day (**not** within ~24h of an order day):
```
node scripts/load-test-rpa.mjs --store=<id> --cart=<id> --runs=10 --confirm
```
Single-store confirms per-store serialization (#21) held (observed concurrency
should be 1). `--carts=cartA:storeA,cartB:storeB` (one real MILO account each)
measures true fleet parallelism. Feed `duration p50` back into the
machines-needed math above.

---

## Recommended sequence

1. **Load-test harness — BUILT** (`scripts/load-test-rpa.mjs`). RUN it after
   Thursday's order (it adds MILO load). Measures real per-machine throughput,
   memory ceiling, and MILO's tolerance. Data, not guesses.
2. **Autoscaling + queue-position/ETA UX** (S1+S2+S3) — make the peak survivable
   *and* honest. This is the core "handle hundreds with minimum breaks" build.
3. **KMS** (S4) — before the first paying enterprise customers. Needs a decision:
   Supabase Vault vs cloud KMS.
4. **Fleet alerting + MILO-rate-limit detector** (S8 + S6) — ongoing, loud-not-silent.

All of this is hardening — it lives comfortably inside the feature freeze.
None of it touches the core order loop's correctness, which is already done.
