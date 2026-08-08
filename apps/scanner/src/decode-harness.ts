/**
 * DECODE-FLOOR HARNESS (2026-07-26, scanner war — diagnostic only, NEVER shipped).
 *
 * Measures the exact ZXing pipeline the shipped BarcodeScanner uses
 * (same @zxing/browser 0.1.5 + @zxing/library 0.21.3, same hints, same
 * decodeFromCanvas path) against synthetically degraded UPC-A barcodes:
 *   A. raw px-per-module floor
 *   B. optics blur
 *   C. cylinder (bottle) curvature
 *   D. specular glare band
 *   E. low print contrast
 *   F. THE MONEY TABLE — full-frame simulation: barcode at real distances
 *      through an iPhone-like FOV at 720p vs 1080p vs 1440p capture,
 *      full-frame decode vs center-crop ROI decode, with decode cost (ms).
 */

type Row = Record<string, unknown>;
const RESULTS: Row[] = [];
declare global {
  interface Window {
    __RESULTS__?: Row[];
    __DONE__?: boolean;
  }
}

// ---------- readers built from the REAL shipped module ----------
import { buildZxingDecodeHints } from "./lib/scanner-decode";

async function buildReader(mode: "live" | "photo") {
  const hints = await buildZxingDecodeHints(mode);
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  return new BrowserMultiFormatReader(
    (hints ?? undefined) as never,
    { delayBetweenScanSuccess: 200 },
  ) as unknown as {
    decodeFromCanvas: (c: HTMLCanvasElement) => { getText(): string };
  };
}

/** "photo" === the OLD live loop (TRY_HARDER + inverted) — the baseline. */
const buildProdReader = () => buildReader("photo");

// ---------- UPC-A generator ----------
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];

function upcCheck(d11: string): string {
  const d = d11.split("").map(Number);
  let odd = 0, even = 0;
  for (let i = 0; i < 11; i++) (i % 2 === 0 ? (odd += d[i]) : (even += d[i]));
  return String((10 - ((odd * 3 + even) % 10)) % 10);
}

function upcModules(payload11: string): string {
  const digits = payload11 + upcCheck(payload11);
  let m = "101";
  for (let i = 0; i < 6; i++) m += L[Number(digits[i])];
  m += "01010";
  for (let i = 6; i < 12; i++) m += L[Number(digits[i])].split("").map((b) => (b === "1" ? "0" : "1")).join("");
  m += "101";
  return m; // 95 modules
}

const QUIET = 9; // modules each side
const TOTAL_MODULES = 95 + QUIET * 2; // 113

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Render an ideal barcode at BIG scale (8 px/module). */
function renderIdeal(payload11: string, ink = "#000", paper = "#fff", heightPx = 480): HTMLCanvasElement {
  const mods = upcModules(payload11);
  const S = 8;
  const c = mk(TOTAL_MODULES * S, heightPx);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = ink;
  for (let i = 0; i < mods.length; i++) {
    if (mods[i] === "1") ctx.fillRect((QUIET + i) * S, 0, S, heightPx);
  }
  return c;
}

/** Cylinder curvature on the big canvas: dest col samples source col via asin map. */
function curve(src: HTMLCanvasElement, amax: number): HTMLCanvasElement {
  if (amax <= 0) return src;
  const out = mk(src.width, src.height);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  const W = src.width;
  const sinA = Math.sin(amax);
  for (let xd = 0; xd < W; xd++) {
    const v = ((xd + 0.5) / W) * 2 - 1; // image-space [-1,1]
    const u = Math.asin(v * sinA) / amax; // flat-space [-1,1]
    const xs = ((u + 1) / 2) * W - 0.5;
    ctx.drawImage(src, xs, 0, 1, src.height, xd, 0, 1, src.height);
  }
  return out;
}

/** Downscale to target px-per-module (camera sampling), optional post blur. */
function sample(src: HTMLCanvasElement, ppm: number, blurPx: number): HTMLCanvasElement {
  const w = Math.round(TOTAL_MODULES * ppm);
  const h = Math.max(24, Math.round(src.height * (w / src.width)));
  const c = mk(w, h);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(src, 0, 0, w, h);
  ctx.filter = "none";
  return c;
}

/** Diagonal white glare band across the middle. */
function glare(c: HTMLCanvasElement, alpha: number): HTMLCanvasElement {
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0.35, "rgba(255,255,255,0)");
  g.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.65, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Embed barcode into a camera frame with paper card + gray background. */
function embed(frameW: number, frameH: number, code: HTMLCanvasElement): HTMLCanvasElement {
  const f = mk(frameW, frameH);
  const ctx = f.getContext("2d")!;
  ctx.fillStyle = "#5a5f66"; // shelf-ish background
  ctx.fillRect(0, 0, frameW, frameH);
  const pad = Math.round(code.height * 0.35);
  ctx.fillStyle = "#f4f2ec"; // label paper
  ctx.fillRect(
    Math.round(frameW / 2 - code.width / 2 - pad),
    Math.round(frameH / 2 - code.height / 2 - pad),
    code.width + pad * 2,
    code.height + pad * 2,
  );
  ctx.drawImage(code, Math.round(frameW / 2 - code.width / 2), Math.round(frameH / 2 - code.height / 2));
  return f;
}

function centerCrop(src: HTMLCanvasElement, fw: number, fh: number): HTMLCanvasElement {
  const w = Math.round(src.width * fw);
  const h = Math.round(src.height * fh);
  const c = mk(w, h);
  c.getContext("2d")!.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, w, h);
  return c;
}

const PAYLOADS = ["08218409056", "01234567890", "78943200116"];

async function main() {
  const reader = await buildProdReader();
  const tryDecode = (c: HTMLCanvasElement): boolean => {
    try {
      const r = reader.decodeFromCanvas(c);
      return Boolean(r.getText());
    } catch {
      return false;
    }
  };
  /** success = majority of payloads decode (kills single-payload luck). */
  const runCase = (build: (p: string) => HTMLCanvasElement) => {
    let ok = 0;
    for (const p of PAYLOADS) if (tryDecode(build(p))) ok++;
    return ok;
  };

  // A. raw floor
  for (let ppm = 0.8; ppm <= 3.61; ppm += 0.2) {
    const ok = runCase((p) => sample(renderIdeal(p), ppm, 0));
    RESULTS.push({ t: "A_raw", ppm: +ppm.toFixed(1), ok, of: PAYLOADS.length });
  }
  // B. blur
  for (const blur of [0.5, 1.0, 1.5, 2.0]) {
    for (const ppm of [1.6, 2.0, 2.6, 3.2]) {
      const ok = runCase((p) => sample(renderIdeal(p), ppm, blur));
      RESULTS.push({ t: "B_blur", blur, ppm, ok, of: PAYLOADS.length });
    }
  }
  // C. curvature (edge compression = 1 - cos(amax))
  for (const amax of [0.55, 0.8, 1.05]) {
    for (const ppm of [1.8, 2.4, 3.0]) {
      const ok = runCase((p) => sample(curve(renderIdeal(p), amax), ppm, 0.5));
      RESULTS.push({ t: "C_curve", edge: +(1 - Math.cos(amax)).toFixed(2), ppm, ok, of: PAYLOADS.length });
    }
  }
  // D. glare
  for (const alpha of [0.4, 0.6, 0.75]) {
    for (const ppm of [2.4, 3.2]) {
      const ok = runCase((p) => glare(sample(renderIdeal(p), ppm, 0.5), alpha));
      RESULTS.push({ t: "D_glare", alpha, ppm, ok, of: PAYLOADS.length });
    }
  }
  // E. contrast
  for (const [ink, paper] of [["#303030", "#c8c8c8"], ["#555555", "#c8c8c8"], ["#707070", "#b0b0b0"]]) {
    for (const ppm of [2.0, 2.8]) {
      const ok = runCase((p) => sample(renderIdeal(p, ink, paper), ppm, 0.5));
      RESULTS.push({ t: "E_contrast", ink, paper, ppm, ok, of: PAYLOADS.length });
    }
  }

  // F. frame simulation — iPhone HFOV ~69deg, barcode widths 30mm and 22mm
  const HFOV = (69 * Math.PI) / 180;
  const CAPS: Array<[number, number, string]> = [
    [1280, 720, "720p(today)"],
    [1920, 1080, "1080p"],
    [2560, 1440, "1440p"],
    [3840, 2160, "2160p"],
  ];
  for (const barcodeMm of [30, 22]) {
    for (const dCm of [10, 15, 20, 25, 30]) {
      const sceneMm = 2 * dCm * 10 * Math.tan(HFOV / 2);
      for (const [cw, ch, label] of CAPS) {
        const px = (barcodeMm / sceneMm) * cw;
        const ppm = px / TOTAL_MODULES;
        const build = (p: string) => embed(cw, ch, sample(curve(renderIdeal(p), 0.55), Math.max(0.3, ppm), 0.5));
        // full-frame decode + timing
        let ok = 0;
        let ms = 0;
        for (const p of PAYLOADS) {
          const f = build(p);
          const t0 = performance.now();
          if (tryDecode(f)) ok++;
          ms += performance.now() - t0;
        }
        // center-crop ROI decode (60% x 40%) + timing
        let okC = 0;
        let msC = 0;
        for (const p of PAYLOADS) {
          const f = centerCrop(build(p), 0.6, 0.4);
          const t0 = performance.now();
          if (tryDecode(f)) okC++;
          msC += performance.now() - t0;
        }
        RESULTS.push({
          t: "F_frame", mm: barcodeMm, cm: dCm, cap: label,
          ppm: +ppm.toFixed(2),
          full_ok: ok, full_ms: +(ms / PAYLOADS.length).toFixed(1),
          crop_ok: okC, crop_ms: +(msC / PAYLOADS.length).toFixed(1),
          of: PAYLOADS.length,
        });
      }
    }
  }

  // G. idle cost — NO barcode in frame (the common case while aiming).
  for (const [cw, ch, label] of CAPS) {
    const f = mk(cw, ch);
    const ctx = f.getContext("2d")!;
    ctx.fillStyle = "#5a5f66";
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#8a6b4f"; // shelf clutter
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 97) % cw, (i * 211) % ch, 80, 180);
    let t0 = performance.now();
    tryDecode(f);
    const fullMs = performance.now() - t0;
    const crop = centerCrop(f, 0.6, 0.4);
    t0 = performance.now();
    tryDecode(crop);
    const cropMs = performance.now() - t0;
    // downscaled-to-1024-wide full frame (the proposed sweep tick)
    const dw = 1024;
    const dh = Math.round(ch * (dw / cw));
    const small = mk(dw, dh);
    small.getContext("2d")!.drawImage(f, 0, 0, dw, dh);
    t0 = performance.now();
    tryDecode(small);
    const smallMs = performance.now() - t0;
    RESULTS.push({ t: "G_idle", cap: label, full_ms: +fullMs.toFixed(1), crop_ms: +cropMs.toFixed(1), down1024_ms: +smallMs.toFixed(1) });
  }

  // ---------- H. FAST-TICK MODE: the shipped "live" hints (6 formats, no TRY_HARDER/inverted) ----------
  const fastReader = await buildReader("live");
  const tryFast = (c: HTMLCanvasElement): boolean => {
    try {
      return Boolean(fastReader.decodeFromCanvas(c).getText());
    } catch {
      return false;
    }
  };

  // H1. idle cost of the fast reader on center crops
  for (const [cw, ch, label] of CAPS) {
    const f = mk(cw, ch);
    const ctx = f.getContext("2d")!;
    ctx.fillStyle = "#5a5f66";
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = "#8a6b4f";
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 97) % cw, (i * 211) % ch, 80, 180);
    const crop = centerCrop(f, 0.6, 0.4);
    let t0 = performance.now();
    tryFast(crop);
    const fastMs = performance.now() - t0;
    t0 = performance.now();
    tryDecode(crop);
    const deepMs = performance.now() - t0;
    RESULTS.push({ t: "H1_idle_crop", cap: label, fast_ms: +fastMs.toFixed(1), deep_ms: +deepMs.toFixed(1) });
  }

  // H2. fast-mode success floor (curved + 0.5px optics, like F)
  for (const ppm of [1.4, 1.8, 2.2, 2.6, 3.0]) {
    let ok = 0;
    for (const p of PAYLOADS) if (tryFast(sample(curve(renderIdeal(p), 0.55), ppm, 0.5))) ok++;
    RESULTS.push({ t: "H2_fast_floor", ppm, ok, of: PAYLOADS.length });
  }

  // H3. fast + deep-rescue on the money rows (crop decode, real distances)
  for (const barcodeMm of [30, 22]) {
    for (const dCm of [10, 15, 20, 25, 30]) {
      const sceneMm = 2 * dCm * 10 * Math.tan(HFOV / 2);
      for (const [cw, ch, label] of CAPS) {
        const px = (barcodeMm / sceneMm) * cw;
        const ppm = px / TOTAL_MODULES;
        let fastOk = 0, deepOk = 0, fastMs = 0, deepMs = 0;
        for (const p of PAYLOADS) {
          const f = centerCrop(embed(cw, ch, sample(curve(renderIdeal(p), 0.55), Math.max(0.3, ppm), 0.5)), 0.6, 0.4);
          let t0 = performance.now();
          if (tryFast(f)) fastOk++;
          fastMs += performance.now() - t0;
          t0 = performance.now();
          if (tryDecode(f)) deepOk++;
          deepMs += performance.now() - t0;
        }
        RESULTS.push({
          t: "H3_modes", mm: barcodeMm, cm: dCm, cap: label, ppm: +ppm.toFixed(2),
          fast_ok: fastOk, fast_ms: +(fastMs / PAYLOADS.length).toFixed(1),
          deep_ok: deepOk, deep_ms: +(deepMs / PAYLOADS.length).toFixed(1),
          of: PAYLOADS.length,
        });
      }
    }
  }

  window.__RESULTS__ = RESULTS;
  window.__DONE__ = true;
  document.getElementById("status")!.textContent = `done: ${RESULTS.length} rows`;
}

void main();
