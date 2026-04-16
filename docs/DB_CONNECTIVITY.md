# Supabase / Postgres — local `psql` connectivity diagnostics

**Purpose:** When the app reaches Supabase but **`psql`** reports **`connection refused`** (or similar) to the database host on **port 5432**, use this guide to narrow the cause **without** pasting secrets into chat or tickets indiscriminately.

**Safety:** Copy commands into **your terminal** only. Replace placeholders (`YOUR_HOST`, `YOUR_PROJECT_REF`, etc.) from the **Supabase Dashboard** locally. **Do not** paste database passwords or full connection URLs into AI tools.

**Official references (read alongside this doc):**

- [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres) — connection strings, SSL, direct vs pooler.
- [Supabase & your network: IPv4 and IPv6 compatibility](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP) — direct DB often **IPv6**; pooler / Supavisor / IPv4 add-on when your path does not support IPv6.
- [Error: "Connection refused" when connecting to the database](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr) — reachability vs auth; Fail2ban / repeated wrong passwords.
- [Upgrading](https://supabase.com/docs/guides/platform/upgrading) — project lifecycle; if the project is **paused** or restoring, the database may be unavailable until restored.

---

## A. Supabase Dashboard (do this first)

Complete these in the [Supabase Dashboard](https://supabase.com/dashboard) for the **same** project the app uses.

| # | Check | Where to look | What you want |
|---|--------|----------------|-----------------|
| A1 | **Project is active** | Project home / status banner | Not **Paused**. If paused, use **Restore** (may take several minutes). See [Upgrading](https://supabase.com/docs/guides/platform/upgrading) for platform lifecycle context. |
| A2 | **Correct external host** | **Connect** (top bar or **Project Settings → Database**) | Copy the **host** string shown for the mode you intend (see A3). Compare character-by-character with what you use in `psql` (no stale copy from an old doc). |
| A3 | **Direct vs pooler** | Same **Connect** / Database settings | **Direct connection** often uses host like `db.<PROJECT_REF>.supabase.co` and **port 5432**. **Pooler (Supavisor)** uses a different host/port (e.g. **6543** for transaction mode in many regions) — see live UI labels. If direct is IPv6-only on your network path, try the **pooler** string per [IPv4/IPv6 troubleshooting](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP). |
| A4 | **IPv4 add-on** | Billing / add-ons (if applicable) | If your client/network cannot use IPv6 to the direct host, Supabase documents using pooler or an **IPv4 add-on** — [same guide](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP). |

Write down **only** non-secret facts locally: project ref, region label, whether you are testing **direct** or **pooler**, and the **hostname** (not the password).

---

## B. CLI checks (fixed order)

Set a shell variable **locally** (example — use **your** host from the dashboard, not this example):

```bash
# Example: export DB_HOST="db.xxxxxxxxxxxxxxxx.supabase.co"
export DB_HOST="YOUR_HOST_FROM_CONNECT_DIALOG"
```

### B1 — DNS: does the hostname resolve?

```bash
dig +short "$DB_HOST" A
dig +short "$DB_HOST" AAAA
```

- **No records** → wrong hostname / typo / wrong project ref → **bad URL / target** path.
- **Only AAAA** (IPv6) for the direct DB host and your network may not route IPv6 → see [IPv4/IPv6 compatibility](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP) and try **pooler** or another network.

### B2 — TCP: is the port reachable?

**Direct Postgres (typical):**

```bash
nc -vz "$DB_HOST" 5432
```

**Pooler (example port — use the port shown in your Connect dialog, often 6543 for transaction pooler):**

```bash
nc -vz "$DB_HOST" 6543
```

Interpretation:

- **`succeeded` / open** → TCP path works; if `psql` still fails, lean toward **SSL / TLS**, **auth**, or **wrong user/database name** (not raw “refused” from firewall).
- **`Connection refused`** → nothing listening or path blocked; see [connection refused troubleshooting](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr). Compare with **paused project**, **wrong host/port**, **IPv6 path**, or **IP ban after wrong passwords** (same doc).

### B3 — `psql` with SSL required (no secrets in command history tip)

Use the **URI from the Connect dialog** in a local file or env var you do **not** commit:

```bash
# Prefer: paste the full URI from Dashboard into a local-only env var, then:
psql "$DATABASE_URL" -c 'select 1'
```

If you must type URI manually, **always** include SSL for Supabase:

```bash
psql "postgresql://USER:PASSWORD@HOST:PORT/postgres?sslmode=require" -c 'select 1'
```

(`USER` / `PASSWORD` / `HOST` / `PORT` from dashboard — keep this line off Slack/AI.)

Supabase documents SSL for remote clients in [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres).

### B4 — Same checks from another path

If B2 fails on your home/office Wi‑Fi:

- Retry **phone hotspot** or another network.
- Retry from a small cloud VM in the same region.

If TCP works elsewhere → **local network / ISP / VPN / corporate firewall** blocking **5432** (or pooler port).

---

## C. Decision tree (three categories)

Use results from **§A** and **§B**.

```
START
  │
  ├─ Dashboard shows Paused / restoring?
  │     YES → Supabase project / platform availability → Restore; wait; retry B2.
  │     NO  ↓
  │
  ├─ Host in psql ≠ host in Connect dialog (typo / old ref)?
  │     YES → Bad URL / target (and possibly wrong password user) → Fix A2; retry B1–B3.
  │     NO  ↓
  │
  ├─ dig returns no A/AAAA for DB_HOST?
  │     YES → Bad hostname / DNS → Fix target.
  │     NO  ↓
  │
  ├─ nc to correct port fails (refused / timeout)?
  │     YES → Network path OR IPv6 incompatibility OR paused/banned IP
  │           → Read [connection refused](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr)
  │           → Read [IPv4/IPv6](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP)
  │           → Try pooler host+port; try other network; support if persistent.
  │     NO  ↓
  │
  └─ nc OK but psql fails?
        → Prefer sslmode=require; then credentials / user / database name
        → Repeated auth failures: check Fail2ban / ban note in [connection refused](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr)
```

**Category summary**

| Category | Typical signals | Next step |
|----------|-----------------|-----------|
| **Bad URL / credential path** | Wrong host vs Connect dialog; `dig` empty; `psql` auth errors while `nc` works | Re-copy URI; reset DB password in dashboard if needed; use `sslmode=require` |
| **Supabase project / platform** | Dashboard paused; maintenance; IP banned after bad passwords | Restore project; wait; follow Supabase troubleshooting / support |
| **Local network / IPv6 / port** | `nc` fails on 5432 from home but works on hotspot; only AAAA and no IPv6 path | Different network; pooler / Supavisor string; IPv4 add-on per docs |

---

## D. Stop debugging locally — escalate

Stop treating it as “only a typo” and **document** for support (still **no** passwords in public tickets) when:

1. **Connect** dialog host + port match your tests, **`sslmode=require`** tried, and **`nc`** still fails repeatedly. Supabase notes **`connection refused`** often means the database is **not reachable**, not only failed SQL authentication — [connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres), [connection refused](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr).

2. **`dig` resolves** the host but **`nc -vz host 5432`** fails on your network while the project is **up** in the dashboard → likely **network path** (firewall, ISP, VPN).

3. **Direct host is IPv6-oriented** and your path may not support it → use **pooler** or **IPv4** options per [IPv4/IPv6 compatibility](https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP).

4. Dashboard shows **paused / restoring** — [Upgrading / platform](https://supabase.com/docs/guides/platform/upgrading).

5. **Correct host** but several **wrong password** attempts → possible **Fail2ban / IP ban** presenting as `connection refused` — [troubleshooting doc](https://supabase.com/docs/guides/troubleshooting/error-connection-refused-when-trying-to-connect-to-supabase-database-hwG0Dr).

**Support bundle (non-secret):** project ref, **UTC timestamp**, direct vs pooler tested, `nc` result (open/refused/timeout), whether another network was tried, whether IPv4 vs IPv6 was observed in `dig`.

---

## E. Quick numbered checklist (copy for a runbook)

1. Dashboard: project **not paused**; note **Connect** host + port for **direct** and **pooler**.
2. `export DB_HOST=...` (local only).
3. `dig +short "$DB_HOST" A` and `AAAA`.
4. `nc -vz "$DB_HOST" 5432` (and pooler port if different).
5. `psql "<URI from dashboard with sslmode=require>" -c 'select 1'`.
6. If failed: repeat **4–5** on **another network** or use **pooler** URI from dashboard.
7. If still failed: open Supabase support with the bundle in **§D**.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-11 | Initial `docs/DB_CONNECTIVITY.md` (SPEC-DB-PSQL-CONNECTIVITY-DIAGNOSTIC). |
