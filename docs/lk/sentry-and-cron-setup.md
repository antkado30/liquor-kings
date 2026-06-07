# Sentry + cron-job.org setup

Two 5-minute setup tasks. Both have all the code already wired — you
just need to paste a couple values.

---

## 1. Sentry error tracking (#31)

**What this does:** when something crashes in prod (API or scanner), the
error gets sent to a Sentry dashboard with the stack trace, the URL, and
which user was affected. Right now if something breaks, we have no idea
unless you spot it. After this, you get email alerts.

### Step 1: sign up at Sentry

1. Open https://sentry.io and click Sign Up
2. Pick the free plan (it gives you 5,000 errors/month — way more than
   we'll hit)
3. Create an organization called something like `liquor-kings`

### Step 2: create two projects

You need **two separate projects** because the API (Node.js) and the
scanner (React) get tracked differently.

1. Create a project → pick **Node.js** → name it `liquor-kings-api`
2. Create a project → pick **React** → name it `liquor-kings-scanner`

For each one, Sentry shows you a **DSN** (Data Source Name). It looks
like `https://abc123@o456.ingest.sentry.io/789012`. Copy both.

### Step 3: paste them into Fly secrets

```bash
# Backend DSN (Node project)
fly secrets set SENTRY_DSN="<your-node-dsn>" -a liquor-kings

# Frontend DSN (React project)
fly secrets set VITE_SENTRY_DSN="<your-react-dsn>" -a liquor-kings
```

### Step 4: deploy + verify

```bash
cd ~/dev/liquor-kings && npm run deploy
```

After deploy, check the API logs — you should see:

```
[sentry] initialized for environment production, release <git sha>
```

(Instead of the old `[sentry] SENTRY_DSN not set` line.)

**Smoke test:** Open `https://liquor-kings.fly.dev/health-crash` (or any
fake URL that 500s). The error should appear in your Sentry dashboard
within ~30 seconds.

---

## 2. cron-job.org daily price-book ping (#32)

**What this does:** every morning at 6 AM, automatically check if MLCC
published a new price book. If they did, ingest it. Right now you have
to manually trigger price-book updates. After this, it's automatic.

### Step 1: set up the cron secret on Fly

Pick a random string nobody could guess. Easiest way:

```bash
# Generate one + set it in one shot
fly secrets set LK_CRON_SECRET="$(openssl rand -hex 32)" -a liquor-kings
```

Then read back what you just set (you'll need it for cron-job.org):

```bash
fly ssh console -a liquor-kings -C "printenv LK_CRON_SECRET"
```

Copy that value somewhere safe — you'll paste it into cron-job.org next.

### Step 2: sign up at cron-job.org

1. Open https://cron-job.org and click Sign Up
2. Free plan is fine (unlimited jobs, 1-minute resolution)
3. Verify your email

### Step 3: create the cron job

1. Click **Create cronjob**
2. Fill it in:
   - **Title:** `Liquor Kings price-book check`
   - **URL:** `https://liquor-kings.fly.dev/price-book/check-updates`
   - **Schedule:** Daily at 6:00 AM (Eastern Time)
   - **Request method:** POST
   - **Notifications:** turn ON "Notify when job fails" — they'll email you if MLCC's site is down or our endpoint breaks
3. **Important — set the auth header:**
   - Click "Advanced" or "Headers"
   - Add header: `X-Cron-Token` = `<the LK_CRON_SECRET value from Step 1>`
   - Without this, the endpoint will return 401

### Step 4: test it

Click the **Run now** button in cron-job.org. Within ~30 seconds you
should see either:
- `200 OK` with a JSON response body — works.
- `401 Unauthorized` — your header is wrong, double-check the secret.
- `500` — paste the error message to Claude and we'll diagnose.

After it runs successfully, the `/price-book/status` endpoint should
show `daysSinceUpdate: 0` and the smart-cards staleness banner in the
scanner should go away.

---

---

## 3. cron-job.org template scheduler (#75)

**What this does:** every morning at 5 AM Eastern, check which saved
order templates are scheduled for today's day-of-week and mark them
"ready to review." Dad's scanner home then shows a banner: "📋 Your
Thursday order is ready to review (12 items)." One tap → cart loaded
→ he validates → submits.

This makes dad's recurring orders take 5 min instead of 30.

### Setup (~2 min if you already did Section 2)

Same cron-job.org account, same `LK_CRON_SECRET`. Just create a second
cron job:

1. Click **Create cronjob**
2. Fill in:
   - **Title:** `Liquor Kings template scheduler`
   - **URL:** `https://liquor-kings.fly.dev/order-templates/run-scheduler`
   - **Schedule:** Daily at 5:00 AM Eastern (so the banner is waiting
     for dad when he opens the app)
   - **Request method:** POST
   - **Notifications:** turn ON "Notify when job fails"
3. **Auth header:**
   - Add header: `X-Cron-Token` = `<the same LK_CRON_SECRET you used
     for the price-book cron>`

### Test it

Click **Run now**. Within 30 seconds you should see a JSON response:

```json
{ "ok": true, "scanned": N, "marked": M, "dow": <today's dow> }
```

- `scanned` = number of templates with a schedule_dow matching today
- `marked` = number that needed marking (not already marked today)

If you save a template scheduled for today's day-of-week and then run
the cron, refresh the scanner home — the banner should appear.

---

## Why this matters

- **Sentry**: catches bugs before customers do. The kind of bug where
  your dad's order silently fails at 9pm Tuesday and nobody knows until
  Friday morning.
- **cron-job.org**: keeps MLCC pricing fresh without you remembering.
  Shelf tags stay accurate, price-change smart-cards keep firing, and
  the order pipeline always validates against current pricing.

Both are foundational ops hygiene. Once they're set, you can forget
about them.
