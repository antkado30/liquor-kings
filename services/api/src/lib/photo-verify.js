/**
 * PHOTO VERIFY — pure logic (2026-08-14, Tony: "yes do it but make sure
 * it is 100% accurate have it double triple check from different
 * sources you know the deal").
 *
 * The overnight pass (scripts/verify-catalog-photos.mjs) shows each
 * scraped catalog photo to the vision model next to the product's
 * MLCC name/size/category and asks: is this a photo of THIS product?
 *
 * Accuracy doctrine, enforced structurally:
 *   - TWO INDEPENDENT PASSES with OPPOSITE framings. Pass 1 is the
 *     skeptic ("what mismatches?"); a WRONG verdict then faces pass 2,
 *     the defender ("argue this photo IS right; only condemn if
 *     undeniable"). Only wrong + wrong = confirmed_wrong.
 *   - One model's word NEVER clears an image (wrong + kept = overruled).
 *   - The pass only FLAGS. It never selects or invents a replacement
 *     photo — re-sourcing is a separate lane with its own verify.
 *   - unsure/error verdicts KEEP the photo and surface for humans.
 *
 * Everything here is pure and pinned; the script owns IO.
 */

/** Pass 1 — the skeptic. */
export function buildSkepticPrompt(item) {
  return [
    `You are auditing a liquor-store catalog photo for accuracy.`,
    `The product this photo is SUPPOSED to show:`,
    `  MLCC name: ${item.name}`,
    `  Size: ${item.bottle_size_label ?? (item.bottle_size_ml != null ? `${item.bottle_size_ml} mL` : "unknown")}`,
    `  Category: ${item.category ?? "unknown"}`,
    ``,
    `MLCC names are abbreviated — expand them mentally (CAPT MORG = Captain`,
    `Morgan, VANIL = Vanilla, PNCH = Punch, "PL" suffix = plastic bottle).`,
    ``,
    `Look at the image. Answer with STRICT JSON only, no prose:`,
    `{"verdict":"match"|"wrong"|"unsure","reason":"<one short sentence>","confidence":0.0-1.0}`,
    ``,
    `Rules:`,
    `- "match" = same brand AND same product line (flavor/variant matters:`,
    `  a Sliced Apple photo on the Original Spiced listing is WRONG).`,
    `- Bottle SIZE differences alone are "match" (a 750ml photo on the 1L`,
    `  listing is acceptable) — but say so in reason.`,
    `- Wrong brand, wrong flavor/variant, a different product entirely,`,
    `  a logo/box/glass-of-drink instead of the bottle → "wrong".`,
    `- Blurry, generic, or genuinely can't tell → "unsure", never guess.`,
  ].join("\n");
}

/** Pass 2 — the defender (independent framing; only condemns when undeniable). */
export function buildDefenderPrompt(item) {
  return [
    `A previous reviewer claims this catalog photo does NOT show the`,
    `product below. Your job is to DEFEND the photo: find every honest`,
    `reason it could be correct.`,
    `  MLCC name: ${item.name}`,
    `  Size: ${item.bottle_size_label ?? (item.bottle_size_ml != null ? `${item.bottle_size_ml} mL` : "unknown")}`,
    `  Category: ${item.category ?? "unknown"}`,
    ``,
    `MLCC names are abbreviated (CAPT MORG = Captain Morgan, VANIL =`,
    `Vanilla). Consider label redesigns, regional variants, and size`,
    `differences (size alone never condemns a photo).`,
    ``,
    `Answer with STRICT JSON only:`,
    `{"verdict":"defensible"|"undeniably_wrong","reason":"<one short sentence>","confidence":0.0-1.0}`,
    ``,
    `Only say "undeniably_wrong" when no honest defense exists (clearly a`,
    `different brand, flavor, or product). If there is ANY reasonable`,
    `case the photo is right, say "defensible".`,
  ].join("\n");
}

/** Strict JSON extraction — refuses to guess on malformed output. */
export function parseVerdict(text, allowed) {
  try {
    const m = String(text ?? "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (typeof obj?.verdict !== "string" || !allowed.includes(obj.verdict)) return null;
    return {
      verdict: obj.verdict,
      reason: typeof obj.reason === "string" ? obj.reason.slice(0, 300) : "",
      confidence:
        typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
          ? obj.confidence
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * The decision matrix. skeptic / defender are parsed verdicts (or null
 * for unparseable). Returns the ledger verdict.
 */
export function decideVerdict(skeptic, defender) {
  if (!skeptic) return { verdict: "unsure", reason: "pass 1 unparseable — kept for human eyes" };
  if (skeptic.verdict === "match") {
    return { verdict: "match", reason: skeptic.reason };
  }
  if (skeptic.verdict === "unsure") {
    return { verdict: "unsure", reason: skeptic.reason };
  }
  // skeptic says wrong → the defender must ALSO condemn, independently.
  if (!defender) {
    return { verdict: "overruled", reason: "pass 2 unparseable — one accusation is never enough" };
  }
  if (defender.verdict === "undeniably_wrong") {
    return {
      verdict: "confirmed_wrong",
      reason: `skeptic: ${skeptic.reason} | defender agreed: ${defender.reason}`,
    };
  }
  return {
    verdict: "overruled",
    reason: `skeptic: ${skeptic.reason} | defender: ${defender.reason}`,
  };
}

/** Only confirmed_wrong rows may ever be applied — pinned as law. */
export function isApplicable(row) {
  return row?.verdict === "confirmed_wrong" && row?.applied_at == null;
}
