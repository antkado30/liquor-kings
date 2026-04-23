# MILO RPA — discovery tooling

This folder holds **read-only** automation used to map MLCC Online Liquor Ordering (MILO / OLO) for future production RPA. Operational rules and PDF links live in `docs/milo-reference/`; cart math and ADA constants live in `services/api/src/mlcc/milo-ordering-rules.js`.

## Prerequisites

- Node.js 18+ (ESM).
- **Playwright** is already a dependency of `services/api` (`playwright` in `package.json`). Install browsers once:

  ```bash
  cd services/api
  npm run playwright:install
  ```

  Or: `npx playwright install chromium`

- A **test MILO account** (username/email + password) and a **login URL** (`MILO_LOGIN_URL`) that reaches the OLO sign-in page (often after redirects from `michigan.gov`).

## Environment variables

**Required** (script exits immediately if any are missing):

| Variable         | Description                                      |
| ---------------- | ------------------------------------------------ |
| `MILO_LOGIN_URL` | Starting URL; redirects are followed.            |
| `MILO_USERNAME`  | Email or username (never written to disk).       |
| `MILO_PASSWORD`  | Password (never written to disk or logs).        |

**Optional:**

| Variable                     | Default | Description                                      |
| ---------------------------- | ------- | ------------------------------------------------ |
| `MILO_DISCOVERY_HEADFUL`     | off     | Set to `1` to show the browser window.           |
| `MILO_DISCOVERY_SLOWMO`      | `250`   | Milliseconds between Playwright actions.       |
| `MILO_OUTPUT_DIR`            | (auto)  | Directory for all artifacts; default is `services/api/rpa-output/<timestamp>/`. |

## Run discovery (read-only)

From the **repository root** (`liquor-kings/`):

```bash
export MILO_LOGIN_URL='https://…'
export MILO_USERNAME='your-test-user@example.com'
export MILO_PASSWORD='your-test-password'
node services/api/src/rpa/milo-discovery.js
```

Or from `services/api/`:

```bash
node src/rpa/milo-discovery.js
```

(Default output path is still resolved relative to the repo root so `services/api/rpa-output/…` is stable.)

The script only auto-runs `main()` when this file is the **direct** `node` entrypoint. Importing `milo-discovery.js` from another module loads helpers and `BLOCKLIST_RE` without launching a browser.

## Output artifacts

All files land under `MILO_OUTPUT_DIR` or `services/api/rpa-output/YYYYMMDD_HHMMSS/` (see root `.gitignore` — **this directory must not be committed**; it can hold cookies and session state).

| Artifact                    | Purpose |
| --------------------------- | ------- |
| `01-login-page.*` … `10-logout-confirmed.*` | HTML body capture, full-page PNG, final URL per step. |
| `01-login-form-inspection.json` | Inputs, labels, buttons, anchors for selector design. |
| `03-dashboard-elements.json`, `05-products-elements.json`, … | Structured hints for nav and controls. |
| `06-product-row-sample.json`, `08-order-row-sample.json` | Deep samples when rows exist. |
| `network-log.jsonl`         | One JSON object per line for requests/responses. |
| `network.har`               | Playwright HAR export. |
| `actions.jsonl`             | Every allowed click: step, selector, text, URLs. |
| `session-state.json`        | `storageState()` (cookies, origins — treat as secret). |
| `*.webm` (or similar)       | Playwright session video when enabled. |

Share the **whole output folder** with whoever is building production RPA selectors; do not paste `session-state.json` into tickets.

## SAFE MODE guarantees

`milo-discovery.js` refuses clicks whose visible text matches destructive patterns (case-insensitive), including **Checkout**, **Validate**, **Place Order** (with a **single controlled exception** for the *Your Licenses* “Place Order” navigation that does not submit an order — guarded by context checks and logged). It also blocks **Submit** / **Confirm Order** style labels.

The script:

- Does **not** click **Validate**, **Checkout**, or submit a cart.
- Does **not** call `form.submit()` or press Enter on forms in a way that submits orders.
- Does **not** log or write `MILO_PASSWORD` (or password field values) to disk.
- Uses timeouts so a hung page load fails within **30 seconds**.

**Add to Cart** on the product search row is intentionally **not** clicked during search discovery.

## Next steps

Use the HTML + JSON + HAR + screenshots to derive stable selectors (`getByRole`, `aria-label`, text). Production order placement is a **separate** task; this script is **discovery only**.
