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

/*
 * TRANSCRIBE-THEN-JUDGE (v2, 2026-08-14 — the taste run caught both
 * passes hallucinating DIFFERENT label text off 360px thumbnails:
 * "label shows Prestige Vodka" vs "label clearly displays POPOV 80").
 * Both prompts now force the model to REPORT what the label actually
 * reads BEFORE any verdict — perception before judgment — and the
 * decision layer cross-checks the two transcriptions (below). The
 * script also now sends FULL-resolution images, never thumbs.
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
    `STEP 1 — TRANSCRIBE: read the label. Report ONLY words you can`,
    `actually see (brand + product line). If the text is too small or`,
    `blurry to read, say so — NEVER guess text you cannot see.`,
    `STEP 2 — JUDGE against the product above.`,
    ``,
    `Answer with STRICT JSON only, no prose:`,
    `{"label_reads":"<exact words legible on the label, or 'illegible'>","verdict":"match"|"wrong"|"unsure","reason":"<one short sentence>","confidence":0.0-1.0}`,
    ``,
    `Rules:`,
    `- "match" = same brand AND same product line (flavor/variant matters:`,
    `  a Sliced Apple photo on the Original Spiced listing is WRONG).`,
    `- Bottle SIZE differences alone are "match" (a 750ml photo on the 1L`,
    `  listing is acceptable) — but say so in reason.`,
    `- Wrong brand, wrong flavor/variant, a different product entirely,`,
    `  a logo/box/glass-of-drink instead of the bottle → "wrong".`,
    `- label_reads is "illegible" or you genuinely can't tell → "unsure".`,
  ].join("\n");
}

/** Pass 2 — the defender (independent framing; only condemns when undeniable). */
export function buildDefenderPrompt(item) {
  return [
    `A previous reviewer claims this catalog photo does NOT show the`,
    `product below. Give the photo a fair, honest second look.`,
    `  MLCC name: ${item.name}`,
    `  Size: ${item.bottle_size_label ?? (item.bottle_size_ml != null ? `${item.bottle_size_ml} mL` : "unknown")}`,
    `  Category: ${item.category ?? "unknown"}`,
    ``,
    `MLCC names are abbreviated (CAPT MORG = Captain Morgan, VANIL =`,
    `Vanilla).`,
    ``,
    `STEP 1 — TRANSCRIBE: read the label. Report ONLY words you can`,
    `actually see. NEVER report text you cannot actually read — an`,
    `honest "illegible" is a valid answer.`,
    `STEP 2 — JUDGE:`,
    `- The transcribed BRAND differs from the product's brand →`,
    `  "undeniably_wrong". A different brand has NO defense.`,
    `- Same brand but a clearly different flavor/variant/line →`,
    `  "undeniably_wrong". A variant mismatch is a wrong photo.`,
    `- Same brand + same line with label-redesign, angle, regional, or`,
    `  bottle-SIZE differences → "defensible" (size never condemns).`,
    `- Illegible or genuinely ambiguous → "defensible" with reason`,
    `  "illegible" (a photo is never condemned on unreadable evidence).`,
    ``,
    `Answer with STRICT JSON only:`,
    `{"label_reads":"<exact words legible on the label, or 'illegible'>","verdict":"defensible"|"undeniably_wrong","reason":"<one short sentence>","confidence":0.0-1.0}`,
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
      label_reads:
        typeof obj.label_reads === "string" ? obj.label_reads.slice(0, 200) : null,
      confidence:
        typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
          ? obj.confidence
          : null,
    };
  } catch {
    return null;
  }
}

// Category words carry no identity — a transcription overlap must rest
// on at least one word that isn't one of these.
const GENERIC_LABEL_WORDS = new Set([
  "rum", "vodka", "gin", "whiskey", "whisky", "tequila", "bourbon", "brandy",
  "liqueur", "wine", "scotch", "proof", "the", "and", "old", "distilled",
  "premium", "original", "imported", "ml", "liter",
]);

/** Distinctive tokens of a transcription / product name. */
export function labelTokens(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_LABEL_WORDS.has(w));
}

function isIllegible(v) {
  const lr = String(v?.label_reads ?? "").toLowerCase();
  return lr === "" || lr.includes("illegible");
}

/** ≥1 shared DISTINCTIVE token between two texts (prefix-tolerant both
    ways for MLCC truncations: capt↔captain). */
export function tokensAgree(a, b) {
  const ta = labelTokens(a);
  const tb = labelTokens(b);
  return ta.some((x) =>
    tb.some(
      (y) => x === y || (x.length >= 4 && y.startsWith(x)) || (y.length >= 4 && x.startsWith(y)),
    ),
  );
}

/**
 * The decision matrix (v2 — evidence-stability guards added after the
 * thumbnail-hallucination taste run).
 *
 *   - A MATCH must be grounded: the skeptic's transcription has to
 *     share a distinctive word with the MLCC name, or the "match" was
 *     imagined → unsure.
 *   - A CONFIRMED_WRONG must be coherent: when both passes transcribe
 *     text but the transcriptions share NOTHING, the passes read
 *     different labels off the same pixels — the evidence itself is
 *     unstable → unsure, never a confident verdict in either direction.
 *   - Illegible never condemns and never confidently matches.
 */
export function decideVerdict(skeptic, defender, opts = {}) {
  const itemName = opts?.itemName ?? null;
  if (!skeptic) return { verdict: "unsure", reason: "pass 1 unparseable — kept for human eyes" };

  if (skeptic.verdict === "match") {
    if (isIllegible(skeptic)) {
      return { verdict: "unsure", reason: "match claimed on an illegible label — kept for human eyes" };
    }
    if (itemName && skeptic.label_reads != null && !tokensAgree(skeptic.label_reads, itemName)) {
      return {
        verdict: "unsure",
        reason: `match claimed but transcription ("${skeptic.label_reads}") shares nothing with the product name — kept for human eyes`,
      };
    }
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
    if (
      skeptic.label_reads != null &&
      defender.label_reads != null &&
      !isIllegible(skeptic) &&
      !isIllegible(defender) &&
      !tokensAgree(skeptic.label_reads, defender.label_reads)
    ) {
      return {
        verdict: "unsure",
        reason: `passes transcribed different labels ("${skeptic.label_reads}" vs "${defender.label_reads}") — evidence unstable, kept for human eyes`,
      };
    }
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
