/**
 * Overflow measurement (2026-07-27): iPhone-sized page, walk every element,
 * name anything wider than its container or the viewport. Then focus the
 * composer (the trigger Tony reported) and re-measure + read scroll state.
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
const page = await ctx.newPage();
page.on("console", (m) => console.log("[console]", m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto("http://127.0.0.1:5199/scanner/harness.html", {
  waitUntil: "networkidle",
});
await page.waitForSelector(".ordercard", { timeout: 15000 });
await page.waitForTimeout(400);

const measure = async (label) => {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const doc = document.scrollingElement;
    const wide = [...document.querySelectorAll("*")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 70),
          sw: el.scrollWidth,
          cw: el.clientWidth,
          right: Math.round(rect.right),
          left: Math.round(rect.left),
          w: Math.round(rect.width),
        };
      })
      .filter(
        (x) => x.sw > x.cw + 1 || x.right > vw + 1 || x.left < -1,
      )
      .slice(0, 40);
    return {
      vw,
      docScrollWidth: doc.scrollWidth,
      docScrollLeft: doc.scrollLeft,
      msgs: (() => {
        const m = document.querySelector(".assistant-messages");
        return m
          ? { sw: m.scrollWidth, cw: m.clientWidth, sl: m.scrollLeft }
          : null;
      })(),
      wide,
    };
  });
  console.log(`\n===== ${label} =====`);
  console.log(
    `viewport=${r.vw} doc.scrollWidth=${r.docScrollWidth} doc.scrollLeft=${r.docScrollLeft}`,
  );
  console.log(`.assistant-messages:`, JSON.stringify(r.msgs));
  for (const x of r.wide)
    console.log(
      `  OFFENDER <${x.tag}> .${x.cls} | scrollW=${x.sw} clientW=${x.cw} | rect left=${x.left} right=${x.right} w=${x.w}`,
    );
  if (r.wide.length === 0) console.log("  (no offenders)");
  return r;
};

await measure("INITIAL RENDER (restored chat + card)");
await page.screenshot({ path: "/tmp/harness-initial.png" });

// The trigger Tony reported: tap the composer.
await page.click(".assistant-input");
await page.waitForTimeout(500);
await measure("AFTER COMPOSER FOCUS");
await page.screenshot({ path: "/tmp/harness-focused.png" });

// Open a size-flip select like a real flow, then re-measure.
const swap = await page.$(".bulkadd-swap-select");
if (swap) {
  await measure("WITH CARD CONTROLS PRESENT");
}

await browser.close();
console.log("\ndone");
