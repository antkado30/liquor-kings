# Photo Backfill — Serper (real Google Images, vision-gated)

**Status: PREPPED 2026-07-11, awaiting Tony's go.** Everything below is
paste-ready; the only open item is the money decision. If the answer is
"not now," cancel the Serper subscription instead — paying monthly for an
unused key is the worst of both.

**2026-07-11 late-night updates (census + mandate):**
- **Exact source census: ALL 2,766 existing photos are
  `serper_google_images`** — zero in-store, zero curated, zero from the
  old UPC flows. A ~2,700-SKU Serper run happened in June that never made
  the journal. One source means one clean decision: step 4's rollback
  clears the entire corpus in one paste.
- **STRICT BACKGROUND is now the script DEFAULT:** a correct bottle on a
  busy background (shelves, hands, rooms) is REJECTED instead of written
  as a fallback — clean studio shot or the premium placeholder, nothing
  in between. Old behavior only via `--allow-busy-fallback=true` (not
  recommended). Driven by Tony's photo-truth mandate: the busy-bg
  fallbacks were most of the "ugly and inconsistent."
- **Decision path (pending Tony's re-look on the fixed UI):** likely wipe
  all 2,766 (step 4) → re-run everything under the strict gate →
  placeholders stay wherever no clean shot exists → in-store captures
  fill the rest with ground truth over time.

**What it does:** fills `mlcc_items.image_url` with REAL bottle photos —
Google Images via Serper.dev, pin-point text-verified (name tokens +
size), then pixel-checked by Claude vision (wrong brand / wrong variant /
wrong proof / multi-packs rejected), re-hosted into our Supabase Storage
(`bottle-images` bucket) so links never rot. Most-scanned bottles first.

**What it will NEVER do (why this is safe to run):**
- Never overwrites an existing photo (`image_url IS NULL` only) — in-store
  captures and curated images always win.
- Never touches codes quarantined by "Wrong photo?" reports
  (`image_source = 'reported_wrong'`).
- Never writes an unverified image — no survivor after the vision gate →
  the premium BottleArt placeholder stays. A wrong photo is worse than no
  photo (Tony's bar, 2026-06-10).
- Idempotent — re-run any time, it only works on what's still missing.

**Cost model (both meters, honest):**
- Serper: 2,500 searches free on signup, then ~$1 per 1,000. One search
  per SKU.
- Vision gate (claude-haiku, up to 3 candidate images per SKU):
  ~$0.002–0.01 per SKU. This is the BIGGER meter.
- Rule of thumb: **cost ≈ missing-photo count × $0.003–0.011.** Get the
  exact count from the one-liner in step 0. (~10k missing ≈ $30–110.)
- `--dry-run` still spends Serper quota — use `--code` spot-checks for
  quality iteration, not dry-runs.

**Env needed in `services/api/.env`:** `LK_PROD_SUPABASE_URL`,
`LK_PROD_SUPABASE_SERVICE_ROLE_KEY`, `SERPER_API_KEY`,
`ANTHROPIC_API_KEY`. The script exits loudly naming anything missing.

---

## 0 — Count what's missing (free, read-only — sizes the decision)

```
cd ~/dev/liquor-kings/services/api && node --input-type=module -e '
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const url = process.env.LK_PROD_SUPABASE_URL;
console.log("TARGET:", new URL(url).host);
const db = createClient(url, process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY);
const q = async (p) => { const r = await p; if (r.error) throw new Error(r.error.message); return r.count; };
const total = await q(db.from("mlcc_items").select("id", { count: "exact", head: true }).eq("is_active", true));
const missing = await q(db.from("mlcc_items").select("id", { count: "exact", head: true }).eq("is_active", true).is("image_url", null));
const scanned = await q(db.from("mlcc_items").select("id", { count: "exact", head: true }).eq("is_active", true).is("image_url", null).gt("scan_count", 0));
console.log("active items:", total, "| missing a photo:", missing, "| missing AND actually scanned:", scanned);
console.log("full-run estimate: $" + (missing * 0.003).toFixed(0) + "–$" + (missing * 0.011).toFixed(0));
'
```

## 1 — Quality spot-check (3 bottles you know by face)

Pick codes you can judge instantly. Each is one Serper search + up to 3
vision checks (pennies):

```
cd ~/dev/liquor-kings/services/api && node scripts/backfill-mlcc-item-images-serper.mjs --code=24987
```

Repeat with two more codes you know. Then look at each in the app
(Catalog search by code). Wrong bottle anywhere → STOP, tell Claude,
we tune before spending more.

## 2 — First real batch (most-scanned 25)

```
cd ~/dev/liquor-kings/services/api && node scripts/backfill-mlcc-item-images-serper.mjs --limit=25
```

Then open Browse in the app — "Featured" sort floats photographed
bottles to the top, so the new ones are immediately eyeballable.
These are your 25 most-scanned SKUs — the photos that matter most.

## 3 — The full run (only after 1 + 2 look right)

```
cd ~/dev/liquor-kings/services/api && caffeinate -i node scripts/backfill-mlcc-item-images-serper.mjs --limit=14000 --concurrency=4
```

`caffeinate` keeps the Mac awake; expect a few hours. Progress prints per
SKU. Safe to Ctrl-C anytime and re-run later — it resumes where it left
off (NULL-only). No-match SKUs keep the placeholder; the in-store
"snap the real bottle" flow fills those over time with ground truth.

## 4 — Rollback (if a bad pattern slips the gates)

Clears ONLY serper-sourced photos (curated + in-store untouched), rows
become placeholder again, re-runnable after tuning:

```
cd ~/dev/liquor-kings/services/api && node --input-type=module -e '
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const url = process.env.LK_PROD_SUPABASE_URL;
console.log("TARGET:", new URL(url).host);
const db = createClient(url, process.env.LK_PROD_SUPABASE_SERVICE_ROLE_KEY);
const { count, error } = await db.from("mlcc_items").update({ image_url: null, image_thumb_url: null, image_source: null }, { count: "exact" }).eq("image_source", "serper_google_images");
if (error) throw new Error(error.message);
console.log("cleared", count, "serper-sourced photos");
'
```

## Notes

- Thumbnails: handled IN-SCRIPT (verified 2026-07-11) — every accepted
  photo is converted to WebP twice (capped full for the ProductCard +
  ~360px thumb for the grid) and both are uploaded to Storage. No
  separate thumb pass needed.
- Single bottle re-do: `--code=XXX --force` re-checks one SKU that
  already has an image (quality iteration on a specific bottle).
- `--skip-vision` exists and should never be used — it removes the
  "every single one correct" guarantee.
