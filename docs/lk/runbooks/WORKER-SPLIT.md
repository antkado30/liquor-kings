# Worker Split — Cutover Runbook (2026-06-08)

**Goal:** make API/web deploys fast by moving the heavy Chromium RPA worker out
of the `liquor-kings` app into its own `liquor-kings-worker` app on the heavy
Playwright image, while `liquor-kings` switches to a slim Node image.

**Why it's safe:** the API never launches Chromium (verified: `index.js` →
`app.js` → routes import zero Playwright/worker code). The worker claims runs
over HTTP (`API_BASE_URL`) and `claim-next` is atomic, so even with two workers
briefly running during cutover there are **no double-orders**.

**Do this when you're NOT placing a real order** (a ~10-min window). Use a
DRY-RUN validate as the test, not a real submit.

---

## What's already in the repo (done by Claude)

- `Dockerfile` — now the SLIM API/web image (node:22-bookworm-slim, no Chromium).
- `Dockerfile.worker` — the Playwright image, runs `run-rpa-worker.js`.
- `fly.toml` — `liquor-kings` now runs ONLY the `app` process (worker removed).
- `fly.worker.toml` — config for the new `liquor-kings-worker` app.
- `package.json` — `npm run deploy:worker` deploys the worker app.

## Step 1 — create the worker app (no deploy yet)

```bash
fly apps create liquor-kings-worker
```

## Step 2 — copy the secrets onto the worker app

The worker needs the SAME secret values as `liquor-kings`. See the exact values
your app already has (secrets are injected as env vars in the running machine):

```bash
fly ssh console -a liquor-kings -C "printenv" | grep -E 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|LK_CREDENTIAL_ENCRYPTION_KEY|LK_RPA_PERSIST_SESSION|LK_ALLOW_ORDER_SUBMISSION|MILO_'
```

Then set each one on the worker app. The worker REQUIRES:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LK_CREDENTIAL_ENCRYPTION_KEY`  (decrypts stored MLCC passwords)
- `LK_RPA_PERSIST_SESSION`  (set to whatever `liquor-kings` has — likely `yes`)
- `LK_ALLOW_ORDER_SUBMISSION`  (**critical** — must match `liquor-kings`'s
  effective value; if it's `yes` there it must be `yes` here, or real orders
  silently become dry-run)
- `MILO_LOGIN_URL` / `MILO_USERNAME` / `MILO_PASSWORD`  (only if they were set
  as the env-fallback credentials)

Set them with `fly secrets set KEY=VALUE -a liquor-kings-worker` using the
values printed above (one `fly secrets set` line per secret, real values — do
not paste the example text literally).

> `API_BASE_URL`, `LK_CHROMIUM_SANDBOX`, and the non-`yes` default of
> `LK_ALLOW_ORDER_SUBMISSION` are already in `fly.worker.toml [env]`, so you only
> need secrets for the sensitive values above.

## Step 3 — deploy the worker app

```bash
npm run deploy:worker
```

Verify it booted and is polling:

```bash
fly logs -a liquor-kings-worker
```

Look for `[rpa-worker] daemon starting — apiBaseUrl=https://liquor-kings.fly.dev`.

## Step 4 — prove the new worker processes a run (DRY RUN)

From the scanner, build a small cart and hit **Validate against MLCC** (this is
`validate_only` — never submits). Watch:

```bash
fly logs -a liquor-kings-worker
```

You should see it claim the run and run stages 1–4. The scanner should show the
validate result as usual. ✅ = the new worker is doing the job.

## Step 5 — deploy the slim API (removes the old in-app worker)

```bash
npm run deploy
```

This builds the slim image and, because `fly.toml` no longer has a `worker`
process, drops the old in-app worker from `liquor-kings`. Watch the build — it
should be noticeably faster, and `image size` much smaller than 821 MB.

## Step 6 — confirm + clean up

- Run one more DRY-RUN validate; confirm `liquor-kings-worker` handles it.
- Check for a leftover old worker machine on the API app:
  ```bash
  fly machine list -a liquor-kings
  ```
  If a machine that was running the old `worker` process is still listed,
  destroy it:
  ```bash
  fly machine destroy <id> -a liquor-kings
  ```

## Rollback (if anything's wrong)

`git revert` the split commit and `npm run deploy` — that restores the single
combined app (worker back inside `liquor-kings`). The `liquor-kings-worker` app
can be left stopped or deleted (`fly apps destroy liquor-kings-worker`).

## Scaling later

More order volume → more workers, safely (atomic claim):
```bash
fly scale count 3 -a liquor-kings-worker
```
