/**
 * Scanner decode tuning (2026-07-26 — THE SCANNER WAR).
 *
 * Every number here was MEASURED, not guessed, with the decode-floor
 * harness (Playwright + the exact @zxing/browser 0.1.5 pipeline the app
 * ships). The findings that drove this design:
 *
 * 1. THE DEATH ZONE. At the old 1280×720 capture, a 22mm-wide bottle
 *    barcode only has enough pixels (≥1.4 px per module) when the phone
 *    is ≤10cm away — but the iPhone wide lens can't focus that close, and
 *    at 1px of blur the decode floor rises past it. Enough pixels → no
 *    focus; focus → not enough pixels. Those bottles could NEVER scan,
 *    no matter how long you held them. 4K capture (2160p) reads the same
 *    22mm barcode out to 30cm — inside the comfortable focus range.
 *    Phones that can't do 4K still get their camera's best mode (`ideal`
 *    degrades gracefully; achieved size is surfaced in telemetry).
 *
 * 2. THE HEAT SPIRAL. TRY_HARDER + ALSO_INVERTED made a MISS cost
 *    586–944ms of synchronous main-thread work (an empty frame scans
 *    every pixel row, twice) — fired every 220ms with no re-entrancy
 *    guard. While aiming, the main thread was a runaway decode loop:
 *    frozen preview, hot phone, seconds-deep queue. The "live" hint mode
 *    below (no TRY_HARDER, no inverted retry) decodes the SAME barcodes
 *    in every measured scenario — identical pass rows, identical floor
 *    (1.4 px/module) — at 13–38ms per miss. TRY_HARDER bought nothing on
 *    live frames and cost everything; it stays for one-shot photo stills
 *    where a 700ms burn is fine.
 *
 * 3. THE CROP. Decoding the center 60%×40% (just inside the aim
 *    rectangle) at native resolution keeps 4K decode cost at ~25–40ms per
 *    tick. A downscaled full-frame rotation sweep every 3rd tick still
 *    catches off-center and rotated codes (e.g. MLCC shelf tags flat on
 *    the counter).
 */

export const SCAN_TUNING = {
  /**
   * Capture request. Browsers pick the nearest mode the camera actually
   * supports (`ideal`, never `exact` — no OverconstrainedError), so an
   * older phone quietly lands on 1920×1080 or 1280×720.
   */
  videoIdealWidth: 3840,
  videoIdealHeight: 2160,
  /** Live decode cadence (unchanged from the previous scanner). */
  detectIntervalMs: 220,
  /** Center-crop decoded every tick — sits just inside the aim rect
   *  (which is inset 22%/18%, i.e. 64%×56% of the frame). */
  cropWidthFrac: 0.6,
  cropHeightFrac: 0.4,
  /** Every Nth tick additionally decodes a downscaled full frame at all
   *  four rotations, for codes held off-center or sideways. */
  sweepEveryNTicks: 3,
  /** The sweep frame is downscaled to at most this wide before decoding —
   *  full-resolution full-frame decode is the old heat spiral. */
  sweepMaxWidth: 1024,
} as const;

export type DecodeHintMode = "live" | "photo";

type ZxDecodeHintType = import("@zxing/library").DecodeHintType;

/**
 * Decode hints for the two very different decode contexts:
 *
 * - "live"  — the camera loop. All six formats (bottles are UPC/EAN;
 *   MLCC shelf tags are CODE_128/CODE_39) but NO TRY_HARDER and NO
 *   inverted retry: measured identical catch rate at 1/20th–1/45th the
 *   per-miss cost, which is what keeps the loop from cooking the phone.
 * - "photo" — one-shot decode of a still the user deliberately took.
 *   Worst case is a single sub-second burn, so spend everything:
 *   TRY_HARDER + ALSO_INVERTED.
 *
 * Returns null when @zxing/library can't load — callers fall back to a
 * hintless reader, same fail-soft behavior the scanner has always had.
 */
export async function buildZxingDecodeHints(
  mode: DecodeHintMode,
): Promise<Map<ZxDecodeHintType, unknown> | null> {
  let lib: typeof import("@zxing/library");
  try {
    lib = await import("@zxing/library");
  } catch (e) {
    console.warn(
      "[scanner-decode] @zxing/library unavailable; scanning without decode hints",
      e,
    );
    return null;
  }
  const { DecodeHintType, BarcodeFormat } = lib;
  const hints = new Map<ZxDecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
  ]);
  if (mode === "photo") {
    hints.set(DecodeHintType.TRY_HARDER, true);
    const invKey = (DecodeHintType as unknown as Record<string, number | undefined>)
      .ALSO_INVERTED;
    if (typeof invKey === "number") hints.set(invKey as ZxDecodeHintType, true);
  }
  return hints;
}

export type CropRegion = { sx: number; sy: number; sw: number; sh: number };

/**
 * The centered source-rectangle of the video to decode each tick.
 * Null when the video hasn't delivered real dimensions yet.
 */
export function cropRegion(
  videoWidth: number,
  videoHeight: number,
  widthFrac: number = SCAN_TUNING.cropWidthFrac,
  heightFrac: number = SCAN_TUNING.cropHeightFrac,
): CropRegion | null {
  const vw = Math.floor(videoWidth);
  const vh = Math.floor(videoHeight);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) {
    return null;
  }
  const sw = Math.max(1, Math.min(vw, Math.round(vw * widthFrac)));
  const sh = Math.max(1, Math.min(vh, Math.round(vh * heightFrac)));
  return {
    sx: Math.floor((vw - sw) / 2),
    sy: Math.floor((vh - sh) / 2),
    sw,
    sh,
  };
}

/** Whether this tick also runs the downscaled full-frame rotation sweep. */
export function isSweepTick(
  tickCount: number,
  everyN: number = SCAN_TUNING.sweepEveryNTicks,
): boolean {
  return everyN > 0 && tickCount % everyN === 0;
}

/** Downscaled sweep-frame size for a given video size (never upscales). */
export function sweepSize(
  videoWidth: number,
  videoHeight: number,
  maxWidth: number = SCAN_TUNING.sweepMaxWidth,
): { w: number; h: number } | null {
  const vw = Math.floor(videoWidth);
  const vh = Math.floor(videoHeight);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) {
    return null;
  }
  if (vw <= maxWidth) return { w: vw, h: vh };
  const w = maxWidth;
  const h = Math.max(1, Math.round(vh * (w / vw)));
  return { w, h };
}
