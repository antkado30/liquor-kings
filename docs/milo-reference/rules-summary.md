# MILO / OLO Operational Rules Summary

Distilled from official MLCC documentation. See README.md for source PDFs.

## Authentication

- Login requires: email/username + password + checking "I have read and accepted the terms"
- The terms checkbox MUST be checked every single login (no "remember" option)
- Sessions do NOT persist — every login requires fresh credentials
- Password reset via "Forgot your password?" link; reset email sent to address on file
- One account per email; users with multiple licenses need one email per license (OR register additional licenses under existing account)
- Owner can add up to 2 sub-users per license via "Quick Invite" or "Manage Organization"

## Navigation Flow

1. Login page → enter credentials + check terms → Login button
2. Dashboard / home page → displays MLCC announcements
3. "Click here to select a license" or Choose License Number dropdown
4. "Your Licenses" page → click "Place Order" under correct license
5. License validation message confirms selection
6. Products page with delivery dates banner at top
7. From Products: search by code or name, adjust quantity, click "Add to Cart"
8. OR use "Click Here to Add Products by Code" for Quick Add flow

## Adding Items: Quick Add Flow

Quick Add page input sequence:

1. Enter liquor code into code field
2. Press Tab → focus moves to quantity field
3. Enter quantity
4. Press Tab → item moves to product list, cursor returns to code field for next entry
5. Repeat until complete
6. Click "Add to Cart" to move entire product list to cart

**Warning**: If you navigate away from Quick Add before clicking "Add to Cart," your product list is LOST. A warning dialog appears if the user attempts to leave.

## Adding Items: Search Flow

- Search by liquor code (full or partial) or name
- Results sort numerically by liquor code
- Each row shows: code, product name, ADA name + number, bottle size, price per bottle, pack size, quantity input
- Split-case-eligible products show a split case icon; hovering reveals allowed quantities
- Up/down arrows on quantity field snap to valid split sizes only
- Click "Add to Cart"; confirmation appears in lower-right corner

## Cart Behavior

- Cart holds items indefinitely until submitted or manually removed
- Cart is per-license, NOT per-user (all users of a license see the same cart)
- Only ONE pending order per license at a time
- Items from submitted-and-confirmed orders appear with a blue vertical line next to them when editing

## Cart Submission: Two-Step Process

1. **Validate button** — accesses ADA inventory in real time, returns out-of-stock notices
   - If out-of-stock items reduce an ADA order below 9L minimum, error displays
   - Errors must be corrected before checkout
   - If any quantity is adjusted after validation, user must re-validate before checkout
2. **Checkout button** — actual submission to ADA(s)
   - Confirmation email sent to: user's email, additional emails entered, MLCC
   - Order confirmation displays with confirmation number
   - Order appears in Orders tab

**Additional email addresses** can be added via the "+ Email address" button before checkout.

## Order Rules

### Split Case Rules (by bottle size)

| Bottle Size  | Allowed Split Quantities       |
| ------------ | ------------------------------ |
| 1.75 L       | 1 or 3                         |
| 1.0 L        | 1, 3, or 6                     |
| 750 mL       | 1, 3, or 6                     |
| 375 mL       | 3, 6, or 12                    |
| 200 mL       | 12 or 24                       |
| 100 mL       | No splits (full case only)     |
| 50 mL        | No splits (full case only)     |
| 70000 series | No splits (limited availability) |

Split cases are FREE. Full cases are also valid (multiples of the largest split size).

### Per-ADA Minimum

- Every ADA on the order must have at least **9 liters** of product
- If cart has multiple ADAs, each is validated independently
- If one ADA's items are below 9L, user must add more OR remove that ADA's items

### Taxes (informational — included in final price)

- Federal: $13.50 per proof gallon (included in marked-up cost)
- State: 12% total (4% School Aid + 4% General Fund + 4% Convention Facility Development)

### Price Changes

- Price charged is based on **delivery date**, not order date
- If price changes between order and delivery, the delivery-date price applies

### ADA Product Changes

- Distribution rights transfer between ADAs periodically
- ADAs losing a product must notify retailers of the new distributor
- Report any non-notification to MLCC

## Orders Tab

- Lists all orders placed through OLO (not orders placed via phone or salesperson)
- Sorted by delivery date, most recent first
- Filters: Delivery Date, Ordered On Date, Confirmation Number, Order Number, Product ID, Distributor
- "Edit Order" link available until ADA cutoff time
- "Copy Order" link — adds all items from past order to current cart

## Editing Confirmed Orders

- Only possible before the ADA's cutoff time
- Click "Edit Order" next to the order in Orders tab
- Confirmed items show with blue vertical line; "Remove" sets quantity to 0 but item still appears on confirmation
- Must re-Validate then Checkout to save edits

## Error Patterns We Need to Handle in RPA

When Checkout fails or Validate reports issues, MILO displays errors in red. Our RPA must detect and interpret:

- "9-liter minimum" errors (per ADA)
- "Invalid quantity" errors (split case violations)
- Out-of-stock notices (move items to "Out of Stock" section)
- Re-validation required after quantity change
- Price change warnings

## Known Unknowns (Require Playwright Discovery)

- Exact login URL (search for michigan.gov OLO sign-in)
- DOM selectors for every element
- Whether MILO has anti-bot measures (CAPTCHA, reCAPTCHA)
- Exact error message text and formatting
- Session cookie behavior (assumed to require fresh login each time per docs)
- Any JavaScript rendering delays / SPA behavior

## Glossary

- **OLO**: Online Liquor Ordering (the system)
- **MILO**: Michigan + OLO (common shorthand)
- **ADA**: Authorized Distribution Agent (the wholesaler/distributor that physically delivers)
- **Known ADAs**: NWS Michigan (321), General Wine & Liquor (221)
- **Licensee**: Holder of a Michigan liquor license authorized to purchase from MLCC
- **Sub-user**: Additional user added to a license by the owner (max 2 per license)
- **Split case**: Ordering less than a full case (e.g., 3 bottles of 750ml instead of 12)
- **Full case**: Pack size, typically 12 bottles for 750ml, 6 for 1.75L, etc.
