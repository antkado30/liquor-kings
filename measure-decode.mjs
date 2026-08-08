/** Decode-floor measurement driver (scanner war, 2026-07-26). */
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("console", (m) => {
  const t = m.text();
  if (!t.startsWith("[vite]")) console.log("[console]", t.slice(0, 200));
});

await page.goto("http://127.0.0.1:5199/scanner/decode-harness.html", { waitUntil: "load" });
await page.waitForFunction(() => window.__DONE__ === true, null, { timeout: 300000 });
const rows = await page.evaluate(() => window.__RESULTS__);
await browser.close();

const by = (t) => rows.filter((r) => r.t === t);
const mark = (ok, of) => (ok === of ? "PASS" : ok > 0 ? `part(${ok}/${of})` : "FAIL");

console.log("\n=== A. RAW FLOOR (clean print, px-per-module sweep) ===");
for (const r of by("A_raw")) console.log(`  ppm=${r.ppm}  ${mark(r.ok, r.of)}`);

console.log("\n=== B. BLUR (focus miss) ===");
for (const r of by("B_blur")) console.log(`  blur=${r.blur}px ppm=${r.ppm}  ${mark(r.ok, r.of)}`);

console.log("\n=== C. BOTTLE CURVATURE (edge compression) ===");
for (const r of by("C_curve")) console.log(`  edge=${r.edge} ppm=${r.ppm}  ${mark(r.ok, r.of)}`);

console.log("\n=== D. GLARE BAND ===");
for (const r of by("D_glare")) console.log(`  alpha=${r.alpha} ppm=${r.ppm}  ${mark(r.ok, r.of)}`);

console.log("\n=== E. LOW CONTRAST ===");
for (const r of by("E_contrast")) console.log(`  ink=${r.ink} on ${r.paper} ppm=${r.ppm}  ${mark(r.ok, r.of)}`);

console.log("\n=== F. FRAME SIM (30mm + 22mm barcode, curved, iPhone FOV) ===");
console.log("  mm  cm   capture      ppm    full-frame        center-crop");
for (const r of by("F_frame")) {
  console.log(
    `  ${String(r.mm).padEnd(3)} ${String(r.cm).padEnd(4)} ${r.cap.padEnd(12)} ${String(r.ppm).padEnd(6)} ${mark(r.full_ok, r.of).padEnd(9)} ${String(r.full_ms).padStart(6)}ms   ${mark(r.crop_ok, r.of).padEnd(9)} ${String(r.crop_ms).padStart(6)}ms`,
  );
}
console.log("\n=== G. IDLE COST (no barcode in frame) ===");
for (const r of by("G_idle")) {
  console.log(`  ${r.cap.padEnd(12)} full=${r.full_ms}ms  crop60x40=${r.crop_ms}ms  down1024=${r.down1024_ms}ms`);
}
console.log("\n=== H1. IDLE COST on center-crop: fast reader vs deep reader ===");
for (const r of by("H1_idle_crop")) console.log(`  ${r.cap.padEnd(12)} fast=${r.fast_ms}ms  deep=${r.deep_ms}ms`);

console.log("\n=== H2. FAST-MODE FLOOR (curved, 0.5px optics) ===");
for (const r of by("H2_fast_floor")) console.log(`  ppm=${r.ppm}  ${mark(r.ok, r.of)}`);

console.log("\n=== H3. MONEY ROWS on center-crop: fast vs deep ===");
console.log("  mm  cm   capture      ppm    FAST              DEEP");
for (const r of by("H3_modes")) {
  console.log(
    `  ${String(r.mm).padEnd(3)} ${String(r.cm).padEnd(4)} ${r.cap.padEnd(12)} ${String(r.ppm).padEnd(6)} ${mark(r.fast_ok, r.of).padEnd(9)} ${String(r.fast_ms).padStart(6)}ms   ${mark(r.deep_ok, r.of).padEnd(9)} ${String(r.deep_ms).padStart(6)}ms`,
  );
}
console.log(`\ntotal rows: ${rows.length}`);
