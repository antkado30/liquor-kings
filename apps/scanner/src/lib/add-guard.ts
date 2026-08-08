/**
 * add-guard — the "are you sure?" decision before a cart add (2026-08-05,
 * born the night a 150-unit / $3,349.50 party-bucket line rode a real
 * order unnoticed, and from Tony's 8/4 ask: "i forgot i already added 3
 * fifths of jack and press add 3 more — a little popup should say are
 * you sure").
 *
 * Pure decision only — the UI renders whatever confirm dialog it wants.
 * Two independent tripwires, both can fire at once:
 *
 *   1. DUPLICATE: the product is already in the cart → the store owner
 *      must consciously choose to stack more on top.
 *   2. BIG LINE: the add itself is unusually large (many units or a lot
 *      of dollars) → confirm the size in plain words before it can ever
 *      reach a cart, a Check, or a Place.
 *
 * Thresholds are deliberately conservative-simple: a normal reorder line
 * at Colony is 1-12 bottles and well under $500. Tune with real data.
 */

export const BIG_LINE_QTY = 24;
export const BIG_LINE_DOLLARS = 500;

export interface AddGuardInput {
  /** Quantity being added right now. */
  addQty: number;
  /** Quantity of this exact product already in the cart (0 = none). */
  existingQty: number;
  /** Unit price if known (licensee price). null = unknown. */
  unitPrice: number | null;
  /** Display name for the message. */
  name: string;
}

export interface AddGuardVerdict {
  kind: "duplicate" | "big_line" | "duplicate_and_big";
  /** Plain-words question for the confirm dialog. */
  message: string;
  /** The total this product would sit at after the add. */
  resultingQty: number;
}

export function addGuardVerdict(input: AddGuardInput): AddGuardVerdict | null {
  const addQty = Number.isFinite(input.addQty) ? Math.max(0, Math.floor(input.addQty)) : 0;
  const existingQty = Number.isFinite(input.existingQty)
    ? Math.max(0, Math.floor(input.existingQty))
    : 0;
  if (addQty <= 0) return null;

  const resultingQty = existingQty + addQty;
  const lineDollars =
    input.unitPrice != null && Number.isFinite(input.unitPrice)
      ? input.unitPrice * addQty
      : null;

  const isDuplicate = existingQty > 0;
  const isBig = addQty >= BIG_LINE_QTY || (lineDollars != null && lineDollars >= BIG_LINE_DOLLARS);

  if (isDuplicate && isBig) {
    return {
      kind: "duplicate_and_big",
      resultingQty,
      message:
        `You already have ${existingQty} of ${input.name} in your cart, and this adds ` +
        `${addQty} more${lineDollars != null ? ` (about $${lineDollars.toFixed(2)})` : ""} — ` +
        `${resultingQty} total. Add them?`,
    };
  }
  if (isDuplicate) {
    return {
      kind: "duplicate",
      resultingQty,
      message:
        `You already have ${existingQty} of ${input.name} in your cart. ` +
        `Add ${addQty} more for ${resultingQty} total?`,
    };
  }
  if (isBig) {
    return {
      kind: "big_line",
      resultingQty,
      message:
        `That's a big line: ${addQty} × ${input.name}` +
        `${lineDollars != null ? ` ≈ $${lineDollars.toFixed(2)}` : ""}. Add it?`,
    };
  }
  return null;
}
