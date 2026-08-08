/** Cart-page layout measurement (2026-07-26, the Cart-tab fix). */
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
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

await page.goto("http://127.0.0.1:5199/scanner/cart-harness.html", { waitUntil: "networkidle" });
await page.waitForSelector(".drawer--cart-page", { timeout: 15000 });
await page.waitForTimeout(500);

const r = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const doc = document.scrollingElement;
  const nav = document.querySelector('nav[aria-label="Primary navigation"]');
  const navRect = nav ? nav.getBoundingClientRect() : null;
  const footer = document.querySelector(".drawer--cart-page .drawer-footer");
  const footerRect = footer ? footer.getBoundingClientRect() : null;
  const tabHidden = document.body.classList.contains("lk-tab-bar-hidden");
  const bodyLocked = document.body.style.position === "fixed";
  // horizontal offenders
  const wide = [...document.querySelectorAll("*")]
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ el, rect }) => el.scrollWidth > el.clientWidth + 1 || rect.right > vw + 1 || rect.left < -1)
    .slice(0, 10)
    .map(({ el, rect }) => `<${el.tagName.toLowerCase()}> .${String(el.className).slice(0, 60)} right=${Math.round(rect.right)}`);
  return {
    vw, vh,
    docScrollWidth: doc.scrollWidth,
    docScrollHeight: doc.scrollHeight,
    tabHidden, bodyLocked,
    navRect: navRect ? { top: Math.round(navRect.top), height: Math.round(navRect.height) } : null,
    footerRect: footerRect ? { top: Math.round(footerRect.top), bottom: Math.round(footerRect.bottom) } : null,
    wide,
    lineCount: document.querySelectorAll(".drawer--cart-page .cart-line, .drawer--cart-page .drawer-list li").length,
  };
});

console.log("===== CART PAGE (initial) =====");
console.log(`viewport=${r.vw}x${r.vh} doc.scrollWidth=${r.docScrollWidth} scrollHeight=${r.docScrollHeight}`);
console.log(`tabBarHidden=${r.tabHidden} bodyLocked=${r.bodyLocked} cartLines=${r.lineCount}`);
console.log(`nav: top=${r.navRect?.top} height=${r.navRect?.height}`);
console.log(`stickyFooter: top=${r.footerRect?.top} bottom=${r.footerRect?.bottom}`);
console.log(
  r.footerRect && r.navRect
    ? r.footerRect.bottom <= r.navRect.top + 1
      ? "FOOTER CLEARS TAB BAR: PASS"
      : `FOOTER OVERLAPS TAB BAR by ${r.footerRect.bottom - r.navRect.top}px: FAIL`
    : "footer or nav missing: FAIL",
);
if (r.wide.length) { console.log("H-OFFENDERS:"); r.wide.forEach((w) => console.log("  " + w)); }
else console.log("no horizontal offenders");

// Scroll to the very bottom — the LAST cart line must sit above the footer.
await page.evaluate(() => {
  const doc = document.scrollingElement;
  doc.scrollTo(0, doc.scrollHeight);
});
await page.waitForTimeout(400);
const r2 = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Primary navigation"]');
  const navTop = nav ? nav.getBoundingClientRect().top : Infinity;
  const footer = document.querySelector(".drawer--cart-page .drawer-footer");
  const footerTop = footer ? footer.getBoundingClientRect().top : Infinity;
  const lines = [...document.querySelectorAll(".drawer--cart-page .drawer-list li")];
  const last = lines[lines.length - 1];
  const lastRect = last ? last.getBoundingClientRect() : null;
  const doc = document.scrollingElement;
  return {
    scrolledTo: Math.round(doc.scrollTop),
    scrollMax: doc.scrollHeight - doc.clientHeight,
    lastLine: lastRect ? { top: Math.round(lastRect.top), bottom: Math.round(lastRect.bottom) } : null,
    footerTop: Math.round(footerTop),
    navTop: Math.round(navTop),
  };
});
console.log("\n===== SCROLLED TO BOTTOM =====");
console.log(`scrollTop=${r2.scrolledTo}/${Math.round(r2.scrollMax)} lastLine=${JSON.stringify(r2.lastLine)} footerTop=${r2.footerTop} navTop=${r2.navTop}`);
console.log(
  r2.lastLine && r2.lastLine.bottom <= r2.footerTop + 1
    ? "LAST LINE FULLY VISIBLE ABOVE FOOTER: PASS"
    : "LAST LINE HIDDEN: FAIL",
);
await page.screenshot({ path: "/tmp/cart-page-bottom.png" });
await browser.close();
console.log("done");
