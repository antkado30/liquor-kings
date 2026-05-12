# Liquor Kings — Production Deployment Plan

**Status:** Decision doc + execution plan. Ready to act on once Tony confirms the choices below.

**Goal:** Move from "API runs on Tony's MacBook" to "API runs on a hosted instance that real customers can reach." This is launch-blocker #2 in the audit (`launch-readiness-audit.md`) and gates literally every paying customer.

---

## What "deployed" actually means for Liquor Kings

You have three deployable surfaces, not one:

1. **The Express API** (`services/api`) — needs to be reachable from customers' phones/laptops 24/7. Requires Node 22 + Playwright (Chromium) for RPA to work. This is the heavy one.
2. **The scanner SPA** (`apps/scanner`) — static build, served over HTTPS. Can live anywhere that serves static files.
3. **The admin SPA** (`apps/admin`) — same as scanner. Already served by the API in production (`/operator-review/app/`).

The API host has to support **long-lived processes** (RPA runs take 60+ seconds) and **Chromium** (because Playwright spawns it). That rules out most "serverless" hosts (Vercel, Cloudflare Workers, Netlify Functions — all have 30-60s execution caps and no headful browser support).

Hosts that DO work for this shape:

| Host | Cost (starter) | Chromium support | Long processes | Verdict |
|------|---------------|------------------|----------------|---------|
| **Fly.io** | ~$5-15/mo | Yes via Docker | Yes (machines) | **Recommended** |
| Railway | ~$5/mo + usage | Yes via Docker | Yes | Solid alternative |
| Render | ~$7/mo | Yes via Docker | Yes | Solid alternative |
| Heroku | $25+/mo | Buildpacks finicky | Yes | Overpriced, skip |
| Vercel/Netlify | — | No | No | Doesn't fit |
| Your own VPS | $5-20/mo | Yes | Yes | Most work, most flexibility |

### My recommendation: Fly.io

Why:
- Cheapest at small scale (~$5/mo for a single shared-cpu-1x machine with 1GB RAM)
- First-class Docker support, which we need for Chromium
- Machines (not just containers) — you can scale to zero when idle and wake on request, or keep a single always-on machine
- Built-in TLS + custom domain
- Easy GitHub Actions integration for deploy-on-push

The two real alternatives (Railway, Render) work just as well and have slightly nicer dashboards. If you have a preference, pick what you want and tell me — the deployment plan changes only in small ways.

**🟡 Decision #1: Hosting platform.** (Default: Fly.io. Tell me if you want different.)

---

## Production Supabase

Right now your `.env` points at `127.0.0.1:54321` (local Supabase via Docker). Production needs a separate Supabase project:

1. Sign up at [supabase.com](https://supabase.com) (free tier — 500MB DB, 50K monthly active users, 2GB egress)
2. Create a new project (region: us-east-1 unless you have a reason)
3. Copy the production URL, anon key, and service-role key
4. From your repo root: `supabase link --project-ref <your-project-id>` then `supabase db push` to apply all 28 migrations
5. (Optional) seed the production MLCC catalog by hitting `POST /price-book/ingest` against the deployed API once it's live

Free tier is fine until you have ~50 pilot stores. Then move to Pro ($25/mo).

**🟡 Decision #2: Supabase region.** (Default: `us-east-1` / Virginia. Tell me if you want us-west or eu.)

---

## Domain

You have three paths:

- **No domain.** Use Fly's auto-issued URL: `liquor-kings.fly.dev`. Free, works fine for pilot. URL is ugly and means scanner has to live on the same Fly domain or CORS gets hairy.
- **Subdomain on a domain you already own.** `api.liquorkings.com` or similar. ~$0 if you have the domain.
- **Buy a new domain.** ~$10-20/year. Cloudflare or Namecheap are easiest.

Pilot stores won't care which URL they hit — they'll mostly use the scanner via QR code or a shortcut you set up for them. But the admin dashboard URL is something you'll look at every day.

**🟡 Decision #3: Domain choice.** (Default: start with `liquor-kings.fly.dev` for week-1 pilot, point a custom domain at it later. No real cost to defer.)

---

## The Chromium-in-container question (the one most likely to bite)

This is the one technical risk that could eat half a day. Playwright spawns Chromium for every RPA run. In a container:

- The Playwright Docker image (`mcr.microsoft.com/playwright:v1.49.1-jammy`) ships with Chromium pre-installed. Use this as the Dockerfile base.
- Chromium needs ~1-2GB RAM for stable operation. A 256MB Fly machine will OOM. Spec at least 1GB.
- Sandbox flags: Chromium-in-Docker needs `--no-sandbox` or extra capabilities. Playwright handles this if you launch with `chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] })`. Need to verify our existing launch code does this.

I'll handle the Dockerfile + verify the launch flags as part of execution. Flagging it here so you know where the risk is.

---

## Env vars to migrate

Your `services/api/.env` currently has these. Each needs a production value:

| Env var | What it is | How to set in prod |
|---------|-----------|-------------------|
| `SUPABASE_URL` | Local Supabase URL | Set to production Supabase URL |
| `SUPABASE_ANON_KEY` | Local anon key | Set to production anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Local service role key | Set to production service role key |
| `LK_CREDENTIAL_ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM | **GENERATE FRESH** — don't reuse local. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Back it up somewhere safe.** Losing it = all stored credentials unrecoverable. |
| `LK_ALLOW_ORDER_SUBMISSION` | Gate on real submit vs dry_run | `no` initially. Flip to `yes` per-store once you trust the run. |
| `SENTRY_DSN` (if used) | Sentry project DSN | Get from Sentry dashboard |
| `LK_ADMIN_TOKEN` | Optional admin endpoint auth | Generate fresh, store somewhere safe |
| `PORT` | API port | Fly handles this — usually 8080 |

Plus any MLCC-specific env vars your workers use — I'll comb the codebase for those when we execute.

**🟡 Decision #4: Are you OK with `LK_ALLOW_ORDER_SUBMISSION=no` initially?** This means deployed instance does dry_run only — same as today's behavior. You flip it on per-store once you've watched their first few runs go green. (Default: yes, start dry-run-only.)

---

## What I do vs what you do

### You do (decision points — ~15 min total)
1. Confirm hosting platform (Fly.io recommended)
2. Create Supabase production project, send me the URL + keys (paste them in `services/api/.env.production` — I'll handle the rest)
3. Confirm domain preference (default: defer, use fly.dev URL)
4. Generate `LK_CREDENTIAL_ENCRYPTION_KEY` for prod and write it down somewhere safe
5. Sign up for Fly.io and run `flyctl auth login`

### I do (execution — ~2-4 hours over one or two sittings)
1. Write `Dockerfile` (Playwright base + our app)
2. Write `fly.toml` config
3. Write `.github/workflows/deploy.yml` for deploy-on-push-to-main
4. Verify Chromium launch flags are container-safe (audit existing playwright launch calls)
5. Build + deploy the first time together (real-time, you watch)
6. Run health check + manually trigger a dry_run RPA from the deployed API to verify Chromium works in container
7. Set up Sentry production project + DSN (15 min)
8. Document the deploy + rollback process in `docs/lk/deployment.runbook.md`

### Together
- First deploy: I drive the commands, you watch the output, we react to whatever breaks (probably something will — first deploys always surprise)
- Smoke test: scan a real UPC against the prod API from your phone, verify the chain works end-to-end

---

## Time + risk estimate

**Best case:** 3 hours total wall-clock if Fly Playwright base image and our launch flags Just Work.

**Realistic case:** 4-6 hours including 1-2 surprises (Chromium sandbox flag, memory tuning, migration order on the new Supabase project).

**Worst case:** 1 full day if we hit a Chromium-in-container failure mode that requires a different host image, OR if a migration assumes data that the production DB doesn't have.

**Rollback:** Fly auto-keeps the previous machine until the new deploy is healthy. If anything blows up, `fly releases rollback`. Customers see ~60s of downtime in the worst case.

---

## What changes after this deploys

- Pilot stores can hit your API from anywhere (not just your house)
- You stop being the single point of failure for "is the server running"
- The KMS migration (audit blocker #1) becomes natural to do — you wire the prod env to whatever KMS service before flipping `LK_ALLOW_ORDER_SUBMISSION=yes`
- The operator review UI becomes worth building because it runs on a real always-on backend
- You can give a pilot store a single URL and walk them through their first scan from a different room

---

## What I need from you to start tomorrow

Just decisions #1-4 above. Reply with anything like:

> "Fly.io. us-east-1. Skip domain for now. LK_ALLOW_ORDER_SUBMISSION=no to start."

And we go.

If you want to do the Supabase project creation first, that's 5 min of clicking on supabase.com — saves us a step when we sit down to execute.

---

*Generated 2026-05-10 night. Pick this up tomorrow when you're fresh.*
