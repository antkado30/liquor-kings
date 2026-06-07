# LK Integrity Doctrine

> Set by Tony on 2026-06-06. Permanent. Load-bearing for every decision.
>
> **"No leaks, no breaks, no nothing. Bugs can't survive."**
>
> This isn't a feature request — it's the company's relationship with
> quality. We don't react to bugs, we pre-empt them. We don't fix what
> customers complain about — we ship what customers never have to
> complain about. Triage is for shops that gave up the standard. We
> didn't.

## What "perfect" means here

It does NOT mean "literally zero bugs forever." That's impossible.

It means three operational words:

- **Predictable.** Same input, same output, every time. No "huh, that's weird" moments.
- **Trustworthy.** When something breaks, it breaks LOUD and obvious. The store owner is NEVER left wondering "did my order go through?"
- **Proud-of.** When Tony demos it, he doesn't have to apologize for anything. No "ignore that error message." No "yeah that's a known thing."

Those three words are the spec. Everything below is how we hit them.

## The 12 Disciplines

These aren't vibes. They're named practices we do. Every feature
shipped, every line of code merged, every deploy — checked against
this list.

### 1. Boundary contracts
Every stage of every pipeline declares what it expects and what it
produces. If anything violates the contract, the system crashes
LOUD, never silently corrects. Stage 3 doesn't just "add items" — it
returns the exact codes added, in order, with quantities, and Stage 4
verifies the chain matches.

### 2. End-to-end provenance
Every cart line carries its full history from origin (UPC scan /
search / template / vision) → all transformations → final submission
→ MILO confirmation. Mismatch anywhere = LOUD failure. The silent
guardrail.

### 3. Pre-commit verification
Before ANY destructive action (Submit, MLCC cred change, template
save, cart clear), the user sees the full state in human language
and explicitly confirms. Never "click and it's gone." Always "here's
exactly what's about to happen, confirm."

### 4. Defense in depth
Multiple independent checks at every boundary. Auth in middleware
AND RLS in DB. UI validation AND backend validation AND DB
constraints. One broken layer doesn't equal a leak. Already true in
places (RLS bedrock, triple-gated submit) — we make it universal.

### 5. Loud failures only
No silent fallbacks. Every `catch (e) { return null }` in the
codebase is a future incident. Errors propagate to a place where a
human sees them. Periodic audit: find every silent catch, decide if
it should remain.

### 6. Observability everywhere
Every production action emits structured evidence. Any failed run is
replayable from logs alone. Founder Console is the daily heartbeat.

### 7. Audit trails on the dangerous stuff
Submit, settings change, MLCC cred update, RLS-bypass operation —
all write immutable records. We can prove what was done, when, by
whom, on what code version.

### 8. Adversarial testing as a habit
The RLS verifier (`services/api/scripts/rls-verification.mjs`) is
the model. We write tests that attack the system on purpose. "What
if a malicious user tries to submit on another store's behalf?"
Tests prove the wall holds. Five new adversarial tests per week.

### 9. Pre-mortems before features
Before writing code for ANY new feature, ask: "if this caused a
customer to lose data or get the wrong product, how would it have
happened?" Address those paths in the spec, before code. No shipping
a feature whose failure mode is unmapped.

### 10. Edge cases as table stakes
No "we'll handle empty cart later." No "we'll deal with expired
session later." Brand-new stores, never-validated accounts,
mid-action network drops, MILO timing out at the worst moment — all
explicitly handled, never "TODO."

### 11. Boundary comparison
What we sent === what came back. Apply everywhere data crosses a
system boundary. MILO confirmation lines === our cart lines.
Catalog data we read === catalog data we display. Submitted codes
=== confirmed codes. Mismatch = LOUD ALERT.

### 12. Daily bug-hunting ritual
Every morning: open Founder Console, look at last 24 hours of
failures. Ask "could this have hit dad in a way he didn't notice?"
Don't wait for customer complaints to find bugs.

## How this gets enforced

- **Every PR description** lists which disciplines apply and how they
  were satisfied.
- **Every new feature spec** includes a pre-mortem section.
- **Every Friday** we run the adversarial test suite + the RLS
  verifier + a Founder Console review.
- **Every deploy** notes which doctrines were touched.
- **Every quarter** we audit silent catches, edge cases, and
  observability coverage.

## What this is NOT

- This is NOT "perfection forever then ship." Disciplines apply to
  every new shipment, AND we ship continuously.
- This is NOT "never break in production." We break in production,
  but always loudly, never silently, and we learn.
- This is NOT a checklist to perform during code review and forget.
  It's a culture. If something feels off, that's the doctrine
  talking. Listen to it.

## Why this matters competitively

Other Michigan liquor ordering tools (CoreVue, Yaldo's iOS app, the
direct MILO portal) have NONE of these disciplines. They will
silently lose orders, double-charge customers, mis-substitute codes
— and their customers will know it but have nowhere better to go.

LK's wedge isn't features. It's TRUST. Store owners will pay $119/mo
for "this never lies to me" in a world where everything else lies to
them constantly. The doctrine is the moat.
