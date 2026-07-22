# MILO checkout endpoint — the seconds-fast submit key

**Status:** endpoint + payload contract RECOVERED 2026-07-17 by decompiling
MILO's own Angular bundle. Engine submit built behind the triple-gate;
live arming pending one real order-day confirmation.

**2026-07-22 UPDATE:** worker-wired behind `LK_SUBMIT_ENGINE=api` (default
`browser`; see the go-live runbook's ENGINE SUBMIT section). Confirmation
source upgraded from the orders-page DOM scrape to **`GET
/users/orders?groupid=` — structured JSON, shape probed live on the worker**:
`confirmationNumber`, `orderNumber`, `placedOn` (ISO), ADA number structured
at `distributor.referenceNumber`, line items under `items[].product`, and
at-placement money truth in `originalTotal` / `originalNetTotalAmt` (bare
`total`/`netTotalAmt` drift when the ADA edits — `updatedByAda:true` observed
on the real 7/16 order). Both 7/16 confirmations verified present via the
probe. The `groupid` query param is REQUIRED (400 without).

## Why this document exists

Order Day 2026-07-16 the RPA submit took **10+ minutes** (browser drives
MILO's website: 90s Angular settle, typing 34 items into Add-By-Code, watching
spinners) while the API-engine **check** took **11 seconds** (direct REST). The
only reason submit stayed on the slow browser path: we didn't know MILO's
submit endpoint. Now we do — extracted from `main.e0d724cc60ebda0f21cc.js`
(the Angular bundle captured in the 7/16 dry-run HAR).

Guardrails were never the tax — they cost milliseconds. The browser was the
tax. This endpoint removes it.

## The contract (verbatim from MILO's `checkout()` function)

Decompiled source:

```js
checkout(t) {
  var e = new O;                                    // payload
  var l = sessionStorage.retrieve("deliveries");    // delivery dates object
  if (Object.keys(l).length !== 0) e.deliveries = JSON.stringify(l);
  if (t) e.emails = t.controls.map(c => c.get("email").value);  // optional
  e.items = [];
  this.cart.items.forEach(ci => {
    e.items.push({ productId: ci.product.id, quantity: ci.quantity, available: ci.available });
  });
  return this.http.post(apiUrl + "/users/cart/checkout", e, { params: { groupid: activeGroup.id } });
}
```

### Request

- **Method / path:** `POST {API_BASE}/users/cart/checkout?groupid={groupId}`
  - `API_BASE = https://www.lara.michigan.gov/LiquorOrderingApi/api`
  - `groupId` = `account.activeGroup.id` (engine already resolves this)
- **Headers:** `Authorization: Bearer <accessToken>`, `Content-Type: application/json`,
  `credentials: include` (Cloudflare `cf_clearance` + JWT — identical to every
  other engine call).
- **Body:**
  ```jsonc
  {
    "deliveries": "<JSON.stringify of the deliveries array>",  // omit if empty
    "emails": ["optional@confirmation.recipient"],             // optional
    "items": [
      { "productId": "<string>", "quantity": <int>, "available": <bool> }
    ]
  }
  ```
  Every `items` field is already on the **priced cart** the engine holds at the
  end of a check: `pricedCart.items[].product.id`, `.quantity`, `.available`
  (confirmed against `__fixtures__/cart.json` — keys include exactly
  `product.id`, `quantity`, `available`). The checkout payload item list **is**
  the priced cart's item list, re-shaped. `deliveries` is the same
  `deliveriesArr` the engine already builds from the three
  `/distributor/delivery` reads.

### Response / confirmation

MILO returns confirmation numbers per ADA. The bundle's own copy for the flow:
"Orders must be submitted to obtain confirmation number." → "Please wait while
we confirm your order." → "Finished placing the order# " / "Confirmed the
order# " / "Order was confirmed by the ADA." The authoritative confirmation
numbers live on `/account/orders` (a.k.a. `/users/orders`) — the same
orders-history page the RPA Stage-5 backstop already scrapes. So: submit via
this endpoint, then read `/users/orders` for the confirmation numbers (belt +
suspenders even if the POST returns them inline).

### Sibling endpoints seen in the bundle (context, not used)

`/users/cart` (PUT update, DELETE clear), `/users/cart/items` (POST add),
`/users/cart/taxes` (PUT price), `/users/cart/order` (POST — re-order by
`ordernumber`, NOT a fresh submit), `/inventory/check`, `/validate`,
`/distributor/delivery`, `/users/orders`, `/users/orders/search`.

## Safety — unchanged, non-negotiable

The engine submit fires **only** through the existing triple-gate
(`mode === "submit"` AND `LK_ALLOW_ORDER_SUBMISSION === "yes"` AND
`stores.allow_order_submission === true`) and only after a green validate for
the byte-identical cart. It inherits the boundary comparison gate
(`cartExactlyMatchesRequest`) — what we're about to submit must equal what MILO
priced, or it fails closed. And the 2026-07-16 truth rule wraps it: a
dispatched POST whose confirmation we don't capture becomes
`submitted_unconfirmed` (never a silent retry, never a double order).

## Go-live checklist (next order day)

1. Keep RPA Stage 5 as the default; run engine-submit in shadow/dry first if
   possible.
2. First real fire with a human watching + `fly logs -a liquor-kings-worker`.
3. Confirm the POST result and the `/users/orders` numbers match MILO's email.
4. Capture the real request/response into a durable artifact (P0-2) to freeze
   the payload/response shape beyond this decompile.
5. Only then promote engine-submit ahead of the browser path.
