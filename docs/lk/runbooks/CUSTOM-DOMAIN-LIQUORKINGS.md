# Runbook: Point liquorkings.com at Fly

> Goal: serve liquor-kings.fly.dev from liquorkings.com (and www) with
> a valid SSL cert. ~5–15 min hands-on; cert provisioning happens in
> the background after DNS propagates.

## Prerequisites

- You own `liquorkings.com` at a registrar (Namecheap, Cloudflare,
  GoDaddy, Google Domains, etc.). If not, register it first (~$10–15/year).
- You have access to that registrar's DNS settings panel.
- `fly` CLI installed and logged in (`fly auth whoami`).

## Step 1 — get Fly's IPs for the app

From the repo root:

```
fly ips list -a liquor-kings
```

Note the **IPv4 (A record target)** and **IPv6 (AAAA record target)**.
Example output looks like:

```
VERSION  IP                  TYPE    REGION  CREATED AT
v4       66.241.xxx.xxx      public  global  2026-04-22T22:00:00Z
v6       2a09:8280:1::xx:xx  public  global  2026-04-22T22:00:00Z
```

If you only see an IPv6 and want a shared IPv4 (lower cost, fine for
LK's traffic level), Fly should already have one allocated; if not:

```
fly ips allocate-v4 --shared -a liquor-kings
```

## Step 2 — tell Fly to issue certs for both apex + www

```
fly certs add liquorkings.com -a liquor-kings
fly certs add www.liquorkings.com -a liquor-kings
```

Fly will return the DNS records you need to set at your registrar.
It's an A + AAAA for the apex, and a CNAME for `www`.

## Step 3 — add DNS records at your registrar

Open your registrar's DNS panel for liquorkings.com and create:

| Type  | Host | Value                                  | TTL  |
| ----- | ---- | -------------------------------------- | ---- |
| A     | @    | (the IPv4 from `fly ips list`)         | 3600 |
| AAAA  | @    | (the IPv6 from `fly ips list`)         | 3600 |
| CNAME | www  | liquor-kings.fly.dev                   | 3600 |

If your registrar doesn't allow CNAME on the apex (some don't), the A
+ AAAA setup on `@` is fine; just use CNAME for `www`.

## Step 4 — wait for cert + verify

Fly auto-provisions a Let's Encrypt cert once DNS resolves. Check
status:

```
fly certs show liquorkings.com -a liquor-kings
fly certs show www.liquorkings.com -a liquor-kings
```

When both show `Status: Ready` and `Configured: true`, hit
https://liquorkings.com in a browser — you should see the landing
page with a green padlock.

DNS can take 5 min to 1 hour to propagate depending on registrar.
Cloudflare DNS is usually under 5 min. Use `dig liquorkings.com +short`
to check propagation from your terminal.

## Step 5 — optional, but recommended

### 5a. Redirect www → apex (or apex → www, pick one)

Decide which is canonical (recommended: apex `liquorkings.com`). Most
registrars / Cloudflare can do this at the DNS layer with a "URL
forward" or "redirect rule." Otherwise add an Express redirect:

```js
// services/api/src/app.js, early in the middleware chain
app.use((req, res, next) => {
  if (req.hostname === "www.liquorkings.com") {
    return res.redirect(301, `https://liquorkings.com${req.originalUrl}`);
  }
  next();
});
```

### 5b. Update the support email + landing page contact

The legal pages reference `support@liquorkings.com` and the landing
page references `tony@liquor-kings.com`. Pick a real address (route it
through your registrar's email forwarding, or set up Google Workspace)
and make sure mail to those addresses actually reaches you. Update
the landing page if needed.

### 5c. Update Supabase Auth redirect URLs

In the Supabase dashboard → Authentication → URL Configuration, add
`https://liquorkings.com` and `https://www.liquorkings.com` to the
allowed redirect URLs. (Not critical for V1 password auth; matters
when magic-link / OAuth lands.)

## What does NOT need to change

- Code: zero changes. Fly routes any hostname pointed at the app to
  the same Express server.
- Env vars: nothing.
- `fly.toml`: nothing.
- The scanner build's `VITE_SCANNER_STORE_ID` (now runtime-resolved
  anyway, so even old logic wouldn't break).

## Rollback

If anything goes sideways, the old liquor-kings.fly.dev keeps working
through the entire migration — DNS changes only affect liquorkings.com.
To detach a domain entirely:

```
fly certs remove liquorkings.com -a liquor-kings
```

and delete the DNS records at the registrar.
