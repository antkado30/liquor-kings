# Liquor Kings — Deployment Runbook

Production target: **Fly.io**, app name `liquor-kings`, region `ord` (Chicago).
Production data: Supabase project `liquor-kings-prod` (us-east-1).

This document is the **single source of truth** for how to deploy, rollback, and configure the production environment. If something here is out of date, fix it in this file first, then act on it.

---

## Architecture summary

| Component | Where it runs |
|----------|----------------|
| Express API + RPA workers + admin SPA | Fly.io machine (`liquor-kings.fly.dev`) |
| Postgres + Auth + RLS | Supabase project `liquor-kings-prod` |
| Scanner SPA | (deferred — runs locally for now; deploy separately later) |
| Sentry | (optional — set `SENTRY_DSN` to enable) |

The API container is built from the root `Dockerfile` using the Playwright base image so RPA workers can spawn Chromium inside the container. Container-safe sandbox flags are applied when `LK_CHROMIUM_SANDBOX=off` (set in `fly.toml`).

---

## First-time setup (one-time)

Run these once. They establish the prod environment.

### 1. Apply migrations to production Supabase

From the repo root:
```bash
supabase link --project-ref eamoozfhqolshdztbrez
supabase db push
```

Verify by checking the migrations table:
```sql
-- in Supabase Studio SQL editor
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
```
Should show all 28 entries through `20260507120000`.

### 2. Create the Fly app

From repo root (Tony's Mac):
```bash
flyctl launch --no-deploy --copy-config --name liquor-kings --region ord
```
The `--copy-config` flag tells Fly to use our existing `fly.toml`. Decline any prompts to overwrite it. Decline the "set up Postgres" and "set up Redis" prompts — we use Supabase.

### 3. Set production secrets

Run each `flyctl secrets set` command — these never get committed. Paste real values one at a time:

```bash
# Supabase
flyctl secrets set SUPABASE_URL="https://eamoozfhqolshdztbrez.supabase.co"
flyctl secrets set SUPABASE_ANON_KEY="<from Supabase dashboard>"
flyctl secrets set SUPABASE_SERVICE_ROLE_KEY="<from Supabase dashboard>"

# Encryption key (32 bytes hex — generate fresh, save in 1Password)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
flyctl secrets set LK_CREDENTIAL_ENCRYPTION_KEY="<paste the new hex string>"

# Optional admin token for /admin/* endpoints
flyctl secrets set LK_ADMIN_TOKEN="<generate one or skip>"

# Sentry (optional, recommended)
flyctl secrets set SENTRY_DSN="<from Sentry dashboard or skip>"
```

After all secrets are set, verify:
```bash
flyctl secrets list
```

### 4. First deploy

```bash
flyctl deploy
```

Expect 3-8 minutes for the first build. The Dockerfile builds the admin SPA first, then pulls the Playwright base image, then installs API deps. Subsequent deploys are faster because layers cache.

Watch for:
- `[admin-builder] vite build` completing successfully
- `[production] installing api dependencies` step ending without error
- The final `Successfully prepared image` line
- `Machine started` and `Machine health checks passing`

### 5. Verify

```bash
# Health endpoint
curl https://liquor-kings.fly.dev/health
# Expected: {"status":"ok","message":"Liquor Kings API running"}

# Admin SPA shell
curl -I https://liquor-kings.fly.dev/operator-review/
# Expected: 302 redirect to /operator-review/app/
```

Then in a browser: `https://liquor-kings.fly.dev/operator-review/` — admin sign-in screen should load.

### 6. Smoke test Chromium-in-container

The risk we flagged: Chromium might fail to spawn inside the Fly machine. Test by triggering a single RPA run.

The cleanest way is to use the operator-review admin UI to manually queue a dry_run, but that requires a store/cart to exist. Simplest direct test:

```bash
# SSH into the running machine
flyctl ssh console

# Inside the machine:
cd /app/services/api
node -e "
import('playwright').then(async ({ chromium }) => {
  const { launchChromium } = await import('./src/lib/chromium-launch.js');
  const b = await launchChromium({ headless: true });
  const p = await b.newPage();
  await p.goto('https://example.com');
  console.log('PAGE_TITLE:', await p.title());
  await b.close();
});
"
exit
```
Expected output: `PAGE_TITLE: Example Domain`. If it errors with sandbox/setuid issues, double-check `LK_CHROMIUM_SANDBOX=off` is set in `fly.toml [env]`.

---

## Recurring operations

### Deploy a new version

After committing changes to `main`:
```bash
git push origin main
flyctl deploy
```

Or set up GitHub Actions (deferred — see "future work" below).

### View logs

```bash
flyctl logs           # follow live
flyctl logs -n 200    # last 200 lines
```

### Restart the machine

```bash
flyctl machine restart
```

### Rollback to previous release

```bash
flyctl releases                       # list recent releases
flyctl releases rollback <version>    # roll back to a specific one
```

### Update a secret

```bash
flyctl secrets set SECRET_NAME="new-value"
# Automatically triggers a redeploy.
```

### Arm submission for a specific store

When you're confident in a pilot store's RPA runs and want to flip from dry_run to real submission:
```bash
flyctl secrets set LK_ALLOW_ORDER_SUBMISSION="yes"
```
Note: this is currently a global flag. Per-store arming is a future enhancement.

### Apply new database migrations

```bash
# From repo root, after migration files added to supabase/migrations/
supabase db push
```

Verify in Studio: `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;`

---

## Local development still works

Nothing about this deployment touches your local stack. Local development still uses:
- Local Supabase at `127.0.0.1:54321` (via `supabase start`)
- Local API at `localhost:4000` (via `npm run dev`)
- Local scanner at `https://10.1.10.9:5174/scanner/` (via mkcert + `npm run dev`)

The `.env` in `services/api/` keeps your local config. Production secrets only live in Fly.

---

## Common failure modes

### "Machine failed to start" / `Error: failed to launch browser`
Likely cause: Chromium sandbox flags not active. Check `flyctl secrets list` for `LK_CHROMIUM_SANDBOX=off` — but wait, that's an env var in `fly.toml`, not a secret. Verify with:
```bash
flyctl ssh console
env | grep LK_CHROMIUM
```
Should print `LK_CHROMIUM_SANDBOX=off`. If missing, check `fly.toml [env]` section.

### Out-of-memory during RPA run
The machine has 1GB RAM. Chromium + Node + the admin SPA build can pressure this during peak load. Bump in `fly.toml`:
```toml
[[vm]]
  memory_mb = 2048
```
Then `flyctl deploy`.

### `Cannot reach Supabase`
Check that `SUPABASE_URL` is the **production** project URL, not local `127.0.0.1`. Confirm with `flyctl secrets list`.

### `Server misconfiguration` on `/admin/*` endpoints
`SUPABASE_SERVICE_ROLE_KEY` not set. Check `flyctl secrets list`.

### `LK_CREDENTIAL_ENCRYPTION_KEY env var not set`
Same issue, different secret. `flyctl secrets set` it.

### Build fails at `npm ci` step
Usually a `package-lock.json` mismatch. Delete the lock and `npm install`, commit, redeploy. Or, more surgical: check the build log for the specific module that failed.

### "Health check failing"
Machine started but the API isn't responding on port 8080. Check `flyctl logs` for stack traces. Common causes:
- A Supabase secret is wrong → API throws on startup
- `PORT` env not set to 8080 (we set it in `fly.toml [env]` AND `Dockerfile ENV PORT`)
- A required env var is missing

---

## Security checklist

After first deploy:
- [ ] Regenerate the Supabase `service_role` key (Settings → API → Regenerate) and update the Fly secret. Original is in chat history.
- [ ] Move `LK_CREDENTIAL_ENCRYPTION_KEY` to a managed KMS (Supabase Vault, AWS KMS, etc.) before any paying customer connects credentials. See `launch-readiness-audit.md` item #7.
- [ ] Set up Sentry alerts on RPA failures, auth failures, credential decrypt failures, DB errors, MLCC selector breakage.
- [ ] Enable Fly's audit log if available on your plan.

---

## Scanner deployment (deferred)

Scanner SPA is currently NOT bundled in the API container. It runs locally for development and via mkcert HTTPS for phone testing. Production options when ready:

- **Vercel / Netlify**: drop the `apps/scanner` build there. 5-minute setup. Point `VITE_API_BASE` env at `https://liquor-kings.fly.dev`. Free tier handles pilot-scale traffic easily.
- **Bundle into this same Fly container**: add a third Dockerfile stage that builds `apps/scanner/dist`, copy it into the image, serve via Express static middleware. Slightly tighter coupling but one fewer thing to manage.

Defer until you have 2+ pilot stores actively using the scanner from outside your house.

---

## Future work (not blocking pilot)

- GitHub Actions deploy workflow (deploy-on-push-to-main with `flyctl deploy --remote-only`)
- Per-store `LK_ALLOW_ORDER_SUBMISSION` arming (currently global)
- Automatic Supabase migrations on deploy
- Production Sentry release tagging
- Postgres backups configured (Supabase Pro tier needed for daily backups)
- Custom domain (`api.liquorkings.com` or similar) once you decide

---

*Last updated 2026-05-11. Update on every significant infrastructure change.*
