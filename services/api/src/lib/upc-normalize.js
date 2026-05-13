/**
 * Canonical UPC normalization for Liquor Kings.
 *
 * Different sources publish UPCs in different lengths:
 *   - MLCC TXT price book: GTIN-14 with leading zeros (e.g. "00858349004148")
 *   - NRS POS exports: 12-digit UPC-A (e.g. "858349004148")
 *   - iOS Safari / ZXing scanner reads: UPC-A or EAN-13, variable
 *
 * They are all the SAME product. Canonicalize to 12-digit UPC-A (zero-padded
 * if shorter) so DB lookups + comparisons just work. Both write-side (ingest)
 * AND read-side (scanner lookup) call normalizeUpc() — equal results = match.
 *
 * Rules:
 *   - Strip all non-digit characters (handles spaces, dashes, leading "=" from
 *     NRS Excel-formula wrapping, etc.)
 *   - Return null for empty input OR all-zero strings (MLCC uses
 *     "0000000000000" as the "no UPC on file" placeholder — we treat as null)
 *   - Strip leading zeros, then pad to 12 digits → canonical UPC-A form
 *   - Reject results shorter than 6 digits or longer than 14 — likely junk
 *   - Preserve 13+ digit values (EAN-13 / GTIN-14) when stripping leading
 *     zeros wouldn't bring them under 13 chars — those are real-world barcodes
 *     too (rare in US liquor but possible for imported wines)
 */

const MIN_REAL_UPC_LENGTH = 6;
const MAX_REAL_UPC_LENGTH = 14;
const CANONICAL_LENGTH = 12;

/**
 * @param {string | number | null | undefined} raw
 * @returns {string | null} Canonical UPC string, or null if input isn't a valid UPC.
 */
export function normalizeUpc(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits === "") return null;
  // All zeros = MLCC's "no UPC on file" placeholder. Treat as missing.
  if (/^0+$/.test(digits)) return null;

  // Strip leading zeros to find the underlying significant digits.
  const stripped = digits.replace(/^0+/, "");
  if (stripped.length < MIN_REAL_UPC_LENGTH || stripped.length > MAX_REAL_UPC_LENGTH) {
    return null;
  }

  // 12 or shorter → pad to UPC-A canonical (e.g. "82184038727" -> "082184038727").
  if (stripped.length <= CANONICAL_LENGTH) {
    return stripped.padStart(CANONICAL_LENGTH, "0");
  }

  // Longer than 12 (e.g. true 13-digit EAN with a non-zero leading digit, or
  // valid 14-digit GTIN that didn't reduce after leading-zero strip) — keep
  // the stripped form. Equality matches will still work as long as both sides
  // normalize identically.
  return stripped;
}

/**
 * Convenience: returns true when normalizeUpc would return a non-null value.
 * @param {unknown} raw
 */
export function isPlausibleUpc(raw) {
  return normalizeUpc(raw) != null;
}
