# HERD RUNBOOK — scaling Liquor Kings for the Wednesday rush

(2026-08-14, launch-readiness sweep. Tony's mandate: "we have to be
able to handle every store ordering at the same time.")

The real ceiling: Michigan has roughly 4,000–4,500 off-premise liquor
licensees TOTAL. "Everyone at once" = ~4.5k stores in the Wednesday
8–11am window. This runbook is how we grow into that with commands,
not rewrites. 100k+ stores = multi-state = a different era (other
states don't run MILO); not this document's problem.

## The architecture is already horizontal

- **API app** (`liquor-kings`): stateless Express serving API + both
  SPAs. 2 machines today, auto_stop OFF. Scale = one command, no code.
- **Worker** (`liquor-kings-worker`): claims runs via atomic
  `/execution-runs/claim-next` — N workers never double-claim by
  construction. 1 machine today. Scale = one command.
- **DB** (Supabase Pro, MICRO compute): trigram-indexed search,
  bounded queries everywhere, 60-row scans on history. Compute tier is
  the upgrade knob.
- **MILO**: per-store token cache (~30 min life), API-based engine
  (no Chromium on the hot path). Their infra is the one ceiling we
  don't control — the MLCC recognition lane is the mitigation.

## Scaling commands (Tony's terminal)

API machines (reads: browse/search/resolve/scanner):
    ~/.fly/bin/flyctl scale count -a liquor-kings 4

Worker machines (execution runs: validate + submit):
    ~/.fly/bin/flyctl scale count -a liquor-kings-worker 3

Supabase compute (DB headroom): Dashboard → Project → Settings →
Compute & Disk → upgrade MICRO → SMALL/MEDIUM. Brief restart; do it
off-peak, never on a Wednesday morning.

Verify after any scale change:
    curl -s https://liquor-kings.fly.dev/health/deep

## Measuring before believing (the load harness)

    cd ~/dev/liquor-kings/services/api && node scripts/load-test.mjs --vus 50 --secs 60

- Run OFF-PEAK. Read-only by construction (cannot touch carts).
- Healthy: 0 errors, p95 under ~750ms. 50 virtual stores ≈ several
  hundred real stores' Wednesday browsing (owners think between taps).
- Authed paths (browse/search/orders) need LK_LOAD_BEARER +
  LK_LOAD_STORE_ID env — grab a bearer from the scanner's network tab.
- If p95 blows out: check Fly metrics (CPU on API machines → scale
  API) vs Supabase dashboard (DB CPU/IO → upgrade compute).

## Wednesday capacity math (worker side)

One validate/submit run ≈ 30–90s wall (MILO round trips dominate).
One worker machine processes runs serially → ~40–80 runs/hour.
Rule of thumb: **1 worker machine per ~50 stores that order in the
same hour**, then add one for headroom. 10 stores = 1 worker (today's
setup is fine deep into Phase 2). 500 stores = ~10–12 workers — still
one `fly scale count` command, but MILO politeness at that volume is a
conversation to have WITH MLCC (the recognition letter lane).

## Alarms (what watches what)

- **cron-job.org → `/health/deep`** every 5 min, email on failure.
  Catches: API down, DB unreachable, catalog empty, WORKER DEAD
  (heartbeat stale > 5 min — the silent killer that would eat a
  Wednesday).
- **Sentry**: exceptions in API + both SPAs (DSNs baked at build).
- **Fly dashboard**: machine restarts, CPU. `fly logs -a
  liquor-kings-worker` when a run misbehaves.
- **Command Deck** (operator review): per-run evidence, failures,
  stuck-run recovery (self-healing reaper runs every 60s anyway).

## Backup / disaster posture

- Supabase Pro: daily backups, 7-day retention (verify in Dashboard →
  Database → Backups). PITR is the paid add-on — turn it on when
  paying stores exceed a handful; it converts "lose up to a day" into
  "lose up to 2 minutes".
- The catalog is REBUILDABLE from MLCC (price-book ingest); the
  irreplaceable tables are stores, credentials, confirmations, memory,
  templates. All in the same DB → same backup covers them.
- Org hygiene: THREE Supabase projects exist (Liquor Kings us-west-2,
  liquor-kings-prod us-east-1, Liquorkings-staging us-east-2). The
  LIVE one is where `brand_flagships` + `ops_heartbeats` exist. The
  other two are wrong-editor accidents waiting to happen — pause or
  clearly rename them.

## What does NOT scale by command (known, accepted, tracked)

- MILO's own rate tolerance (external; recognition letter + politeness).
- The in-memory signup rate limiter is per-machine (2 machines = 2×
  the stated limit; fine at this size, revisit at real signup volume).
- Anthropic spend scales with assistant/photo usage — linear, priced in.
