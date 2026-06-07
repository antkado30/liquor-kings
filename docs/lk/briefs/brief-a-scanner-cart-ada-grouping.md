# Cursor Brief A — Scanner Cart: ADA-Grouped View + Live 9L Validation

**Target repo:** `~/dev/liquor-kings` — work only in `apps/scanner/`.
**Goal:** Make the scanner cart understand ADAs (distributors) and MLCC's
9-liter-per-ADA minimum, so the operator sees per-distributor liter totals
in real time and cannot submit a cart MLCC will reject.

---

## Why this matters

MLCC requires **at least 9 liters per ADA (distributor) per order** —
evaluated separately for each ADA, not for the cart as a whole. Today the
scanner cart is a flat list with one total. An operator can scan a cart
that looks fine, hit submit, wait minutes for the RPA, and only then learn
that their NWS Michigan portion was 2 liters short. This brief fixes that:
the cart shows each ADA's liter progress live, and the submit button is
gated on a real validation call.

---

## The backend is already built and deployed — DO NOT change it

Endpoint: `POST /cart/:storeId/validate`

Request body:
```json
{ "items": [ { "code": "100009", "quantity": 12 }, ... ] }
```

Response 200:
```json
{
  "ok": true,
  "valid": true,
  "errors": [
    { "code": "100009", "reason": "human-readable reason", "suggestedAlternatives": [6,12] }
  ],
  "adaBreakdown": {
    "221": { "liters": 9.0, "meetsMinimum": true },
    "321": { "liters": 4.5, "meetsMinimum": false }
  },
  "itemsValidated": [ { "code","name","quantity","size_ml","ada_number" } ],
  "unknownCodes": ["..."]
}
```
- `valid` is the single source of truth for "can this cart be submitted".
- `errors` includes split-case quantity violations AND per-ADA shortfalls.
- 400 response shape: `{ ok: false, error: string, unknownCodes?: string[] }`.

---

## Current state (already verified — build against this, not assumptions)

- `apps/scanner/src/types.ts` — `MlccProduct` already has `ada_number`
  (string), `ada_name` (string), `bottle_size_ml` (number|null),
  `case_size` (number|null), `licensee_price` (number|null). `CartItem`
  is `{ product: MlccProduct, quantity: number }`.
- `apps/scanner/src/hooks/useCart.ts` — `CartProvider` context. Flat
  `items: CartItem[]`. Exposes `totalItems`, `totalCost`. `cartLineId()`
  = `${code}::${ada_number}`. Persists to localStorage. No ADA grouping.
- `apps/scanner/src/components/CartDrawer.tsx` — renders one flat `<ul>`,
  one "Total", a "Validate & Submit" button that is ALWAYS enabled.
- `apps/scanner/src/api/cart.ts` — API client. `CART_API_BASE = "/cart"`,
  `getAuthHeaders()` → `{ Authorization, "X-Store-Id" }`, `getStoreId()`,
  `fetchWithRetry` imported from `./catalog`. Follow this exact pattern.
- Styling: the scanner uses **plain CSS classes** (e.g. `drawer-line`,
  `btn primary`) defined in `apps/scanner/src/index.css` — **NOT Tailwind.**
  Add new classes in the same file, same naming style. Do not introduce
  Tailwind or a CSS framework.

---

## Changes

### 1. `apps/scanner/src/api/cart.ts` — add `validateCart()`

Add a new exported function following the exact pattern of `getActiveCart()`:

```ts
export type CartValidationResult =
  | {
      ok: true;
      valid: boolean;
      errors: Array<{ code: string | number; reason: string; suggestedAlternatives?: number[] }>;
      adaBreakdown: Record<string, { liters: number; meetsMinimum: boolean }>;
      unknownCodes?: string[];
    }
  | { ok: false; error: string };

export async function validateCart(
  items: Array<{ code: string; quantity: number }>,
): Promise<CartValidationResult>;
```
- POST to `${CART_API_BASE}/${encodeURIComponent(getStoreId())}/validate`.
- Headers: `{ ...getAuthHeaders(), "Content-Type": "application/json" }`.
- Body: `JSON.stringify({ items })`.
- Use `fetchWithRetry` with `{ maxRetries: 2, baseDelayMs: 500, timeoutMs: 10000 }`.
- On non-OK or `raw.ok !== true`, return `{ ok: false, error }`.

### 2. `apps/scanner/src/hooks/useCart.ts` — add an ADA-grouping selector

Add a derived value (a `useMemo`) and expose it on `CartContextValue`:

```ts
export type AdaGroup = {
  adaNumber: string;
  adaName: string;
  lines: CartItem[];
  liters: number;       // sum of (bottle_size_ml * quantity) / 1000
  subtotalCost: number; // sum of (licensee_price ?? 0) * quantity
  meetsMinimum: boolean; // liters >= 9
};
```
- `groupedByAda: AdaGroup[]` — group `items` by `product.ada_number`,
  sorted by `adaName`.
- `liters` per group: `sum((product.bottle_size_ml ?? 0) * quantity) / 1000`.
- `meetsMinimum`: `liters >= 9`.
- Add `groupedByAda` to `CartContextValue`, the context `value` memo, and
  its dependency array. Do not remove `totalItems` / `totalCost`.

### 3. `apps/scanner/src/components/CartDrawer.tsx` — per-ADA sections + submit gate

When `state.kind === "idle"` and `items.length > 0`, replace the single
flat `<ul>` with **one section per ADA group** from `cart.groupedByAda`:

- **ADA section header**: ADA name + liter progress, e.g.
  `General Wine & Liquor — 5.25 L / 9.0 L`.
- **Progress bar**: visual fill = `min(liters / 9, 1)`. Green when
  `meetsMinimum`, amber/red when short. When short, show
  `Need 3.75 L more from this distributor` (9 − liters, 2 decimals).
- **Line items**: same per-line UI that exists today (name, size, qty
  stepper, remove, line total) — just nested under their ADA section.
- Keep the cart-wide `Total` ({money(totalCost)}) at the bottom.

**Live validation + submit gate:**
- Add local state for the validation result. Call `validateCart()` (from
  api/cart.ts) whenever `items` changes, **debounced ~400ms**. Map the
  cart to `items.map(i => ({ code: i.product.code, quantity: i.quantity }))`.
- While a validation request is in flight, the submit button shows a
  subtle "Checking…" state but is not destructive.
- The **"Validate & Submit" button is disabled unless the latest
  validation result has `valid === true`.**
- When disabled because of validation, show the specific blocker(s)
  above the button — from `errors[].reason` and from any ADA with
  `meetsMinimum === false`. Plain language, e.g.
  `NWS Michigan is 3.75 L under the 9 L minimum.`
- If `validateCart` returns `{ ok: false }` (network/server error), do NOT
  hard-block submit on that alone — show a small "couldn't verify" notice
  and leave the button enabled (the RPA still validates server-side). Only
  a definitive `valid === false` blocks the button.
- The existing submission flow (`useSubmission`, `start(items)`) and all
  non-idle states (`syncing`, `submitting`, `polling`, `done`, `error`)
  stay exactly as they are. Only the idle/cart view changes.

---

## Acceptance criteria

1. A cart with items from two ADAs renders two labeled sections, each with
   its own liter progress bar and subtotal.
2. An ADA under 9 L shows a red/amber bar and a specific "need X L more"
   message.
3. The "Validate & Submit" button is disabled whenever the cart is invalid
   (any ADA under 9 L, or any split-case error), and the reason is shown.
4. The button enables the moment the cart becomes valid.
5. Adding/removing/changing quantity re-runs validation (debounced) and the
   bars + button update.
6. localStorage persistence, the qty steppers, remove, clear cart, and the
   entire post-submit flow all still work unchanged.
7. `npm run build` in `apps/scanner/` passes with no TypeScript errors.

## Constraints

- Plain CSS classes in `index.css`, matching existing naming. No Tailwind.
- TypeScript strict — type every new value, no `any`.
- Do not touch the backend, the RPA, or any file outside `apps/scanner/`.
- Do not change `useSubmission.ts` or the submission state machine.
