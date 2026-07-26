/**
 * Scanner war (2026-07-26): pins the MEASURED decode design as
 * executable truth. If someone re-adds TRY_HARDER to the live loop or
 * shrinks the capture request back to 720p, these fail with the story.
 */
import { describe, it, expect } from "vitest";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import {
  SCAN_TUNING,
  buildZxingDecodeHints,
  cropRegion,
  isSweepTick,
  sweepSize,
} from "./scanner-decode";

describe("SCAN_TUNING (measured, do not casually change)", () => {
  it("requests 4K capture — 720p could not physically resolve a 22mm bottle barcode past 10cm", () => {
    expect(SCAN_TUNING.videoIdealWidth).toBe(3840);
    expect(SCAN_TUNING.videoIdealHeight).toBe(2160);
  });

  it("crop sits inside the aim rectangle (inset 22%/18% → 64%×56% of frame)", () => {
    expect(SCAN_TUNING.cropWidthFrac).toBeLessThanOrEqual(0.64);
    expect(SCAN_TUNING.cropHeightFrac).toBeLessThanOrEqual(0.56);
  });
});

describe("buildZxingDecodeHints", () => {
  it("live mode: all six formats, NO TRY_HARDER, NO inverted retry (a miss must stay ~20ms, not ~700ms)", async () => {
    const hints = await buildZxingDecodeHints("live");
    expect(hints).not.toBeNull();
    const formats = hints!.get(DecodeHintType.POSSIBLE_FORMATS) as number[];
    expect(formats).toEqual([
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
    ]);
    expect(hints!.get(DecodeHintType.TRY_HARDER)).toBeUndefined();
    const inv = (DecodeHintType as unknown as Record<string, number | undefined>)
      .ALSO_INVERTED;
    if (typeof inv === "number") {
      expect(hints!.get(inv as DecodeHintType)).toBeUndefined();
    }
  });

  it("photo mode: one-shot still spends everything — TRY_HARDER on, inverted on", async () => {
    const hints = await buildZxingDecodeHints("photo");
    expect(hints).not.toBeNull();
    expect(hints!.get(DecodeHintType.TRY_HARDER)).toBe(true);
    const inv = (DecodeHintType as unknown as Record<string, number | undefined>)
      .ALSO_INVERTED;
    if (typeof inv === "number") {
      expect(hints!.get(inv as DecodeHintType)).toBe(true);
    }
  });
});

describe("cropRegion", () => {
  it("centers the crop at 4K: 2304×864 starting at (768, 648)", () => {
    expect(cropRegion(3840, 2160)).toEqual({ sx: 768, sy: 648, sw: 2304, sh: 864 });
  });

  it("works at any granted resolution (older phone on 1280×720)", () => {
    const r = cropRegion(1280, 720);
    expect(r).toEqual({ sx: 256, sy: 216, sw: 768, sh: 288 });
  });

  it("video not ready (0×0) → null, never a degenerate canvas", () => {
    expect(cropRegion(0, 0)).toBeNull();
    expect(cropRegion(NaN as unknown as number, 720)).toBeNull();
  });

  it("fractions ≥ 1 clamp to the full frame", () => {
    expect(cropRegion(100, 50, 2, 2)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 50 });
  });
});

describe("isSweepTick", () => {
  it("fires every 3rd tick by default", () => {
    const fired = [1, 2, 3, 4, 5, 6, 7].filter((t) => isSweepTick(t));
    expect(fired).toEqual([3, 6]);
  });

  it("a zero/negative cadence never fires (guard against bad tuning)", () => {
    expect(isSweepTick(3, 0)).toBe(false);
    expect(isSweepTick(3, -1)).toBe(false);
  });
});

describe("sweepSize", () => {
  it("downscales a 4K frame to 1024-wide, aspect kept", () => {
    expect(sweepSize(3840, 2160)).toEqual({ w: 1024, h: 576 });
  });

  it("never upscales a small frame", () => {
    expect(sweepSize(640, 480)).toEqual({ w: 640, h: 480 });
  });

  it("video not ready → null", () => {
    expect(sweepSize(0, 0)).toBeNull();
  });
});
