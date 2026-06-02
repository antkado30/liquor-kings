/**
 * Shelf tag rendering — Pillar 3 of V1 (task #22, 2026-06-02).
 *
 * Background: Tony's family store reprints MLCC shelf tags constantly
 * (price changes, new SKUs, faded tags). The current workflow is some
 * online tool + manual typing — slow and error-prone. Liquor Kings
 * already knows every product's MLCC code, ada, price, and size from
 * mlcc_items, so the value-add is "scan bottle → print clean tag in
 * seconds, no typing." Target printer is the Brother QL-810W on the
 * store's Wi-Fi (Pillar 3 spec).
 *
 * What this route does:
 *   POST /tags/render
 *     body: { codes: ["100009", "9124", ...] }
 *     returns: HTML page with one tag per code, ready for browser print.
 *
 * Why HTML (not PDF / direct printer commands):
 *   1. The Brother QL-810W's macOS driver maps the OS print dialog onto
 *      the actual printer cleanly — we don't need to write ESC/P or the
 *      Brother bPAC protocol. User picks the printer in the dialog.
 *   2. Easier iteration (CSS edits live-reload) vs. a binary protocol.
 *   3. Mobile printing on iOS works fine via Safari → AirPrint when the
 *      Brother is shared on the network.
 *
 * The HTML structure mirrors the shelf-tag.html prototype (workspace),
 * which Tony's already approved visually. Auto-fit JS shrinks the
 * price + product name to fit the 100mm × 62mm DK-2205 label.
 *
 * Real barcodes via bwip-js (server-rendered Code 128 → SVG embedded
 * inline). Removed the placeholder pattern from the prototype.
 */

import express from "express";
import bwipjs from "bwip-js";
import supabaseDefault from "../config/supabase.js";

const router = express.Router();

const MAX_CODES_PER_REQUEST = 50;

/**
 * Look up the cheapest path for one product code. Tags use the
 * fewest fields possible: name, MLCC code, ADA, size, shelf price.
 */
async function fetchTagProducts(supabase, codes) {
  if (!Array.isArray(codes) || codes.length === 0) return [];
  const cleaned = codes
    .map((c) => String(c ?? "").trim())
    .filter((c) => c.length > 0 && c.length < 10);
  if (cleaned.length === 0) return [];
  const { data, error } = await supabase
    .from("mlcc_items")
    .select(
      "code, name, ada_number, ada_name, bottle_size_label, bottle_size_ml, min_shelf_price, licensee_price",
    )
    .in("code", cleaned);
  if (error) {
    console.warn(`[tags] product lookup failed: ${error.message}`);
    return [];
  }
  // Preserve the order the user requested, drop any codes we couldn't find.
  const byCode = new Map((data ?? []).map((r) => [String(r.code), r]));
  return cleaned.map((c) => byCode.get(c)).filter((r) => r != null);
}

/**
 * Render a Code 128 barcode as an inline SVG string. Code 128 is the
 * standard for shelf tags and is what our scanner (BarcodeDetector
 * native + ZXing fallback) reads natively.
 *
 * bwip-js returns an SVG path string; we wrap it in a sized <svg>
 * element so the tag CSS can lay it out.
 */
function renderBarcodeSvg(value, options = {}) {
  const widthMm = options.widthMm ?? 30;
  const heightMm = options.heightMm ?? 9;
  try {
    const svgPath = bwipjs.toSVG({
      bcid: "code128",
      text: String(value),
      scale: 1,
      height: heightMm,
      includetext: false,
      backgroundcolor: "FFFFFF",
    });
    // bwip-js returns a complete <svg>... document. We want to control
    // the outer sizing via the tag CSS, so we strip the outer svg and
    // re-wrap with our own width/height + viewBox preserving aspect.
    const inner = svgPath
      .replace(/^[\s\S]*?<svg[^>]*>/i, "")
      .replace(/<\/svg>\s*$/i, "");
    const viewBoxMatch = svgPath.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : `0 0 100 30`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${widthMm}mm" height="${heightMm}mm" preserveAspectRatio="none">${inner}</svg>`;
  } catch (err) {
    console.warn(`[tags] barcode render failed for ${value}: ${err?.message}`);
    return `<span style="font-family:monospace;font-size:3.2mm">${value}</span>`;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPrice(value) {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  // No $ sign — the tag style traditionally omits it because the price
  // is the biggest element on the label and the unit is implied.
  return n.toFixed(2);
}

function formatDate() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

/**
 * Build the HTML for one tag. Mirrors the layout of shelf-tag.html
 * prototype Tony's already approved visually. fitText JS embedded
 * once in the page shell auto-fits price + name.
 */
function buildTagHtml(p) {
  const name = escapeHtml(p.name ?? "—");
  const price = escapeHtml(formatPrice(p.min_shelf_price ?? p.licensee_price));
  const ada = escapeHtml(p.ada_number ?? "—");
  const code = escapeHtml(p.code ?? "—");
  const size = escapeHtml(p.bottle_size_label ?? `${p.bottle_size_ml ?? ""} ML`);
  const date = formatDate();
  const barcode = renderBarcodeSvg(p.code ?? "");
  return `
    <div class="tag" data-code="${code}">
      <div class="tag__name"><span>${name}</span></div>
      <div class="tag__main">
        <div class="tag__date"><span>${date}</span></div>
        <div class="tag__pricewrap"><span class="tag__price">${price}</span></div>
      </div>
      <div class="tag__bottom">
        <span class="tag__ada">${ada}</span>
        <span class="tag__bar">${barcode}</span>
        <span class="tag__code">${code}</span>
        <span class="tag__size">${size}</span>
      </div>
    </div>
  `;
}

const PAGE_SHELL = (tags, opts = {}) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
${
  opts.embedded
    ? /*
         Embedded viewport override (2026-06-02 evening polish).
         Telling the iframe its viewport is 110mm wide gives the
         100mm tag + 5mm padding-and-margins breathing room — the
         browser then proportionally scales the rendered content
         DOWN to fit whatever the iframe's actual width is. fitText
         calculates against the 110mm canvas so price/name auto-fit
         to a CONSISTENT layout, not whichever phone-portrait pixel
         width Tony happens to be on. This is the standard mobile
         Safari "fixed-canvas" pattern.
       */
      `<meta name="viewport" content="width=400, initial-scale=1, user-scalable=no">`
    : `<meta name="viewport" content="width=device-width, initial-scale=1">`
}
<title>Liquor Kings — Shelf Tags</title>
<style>
  :root { --tag-w: 100mm; --tag-h: 62mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #e9e9ee;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .howto {
    max-width: 540px; margin: 22px auto 4px; padding: 16px 20px;
    background: #fff; border-radius: 10px; color: #1a1a2e;
    font-size: 13.5px; line-height: 1.55;
  }
  .howto h2 { font-size: 15px; margin-bottom: 6px; }
  .howto button {
    margin-top: 12px; padding: 9px 20px; font-size: 14px; font-weight: 600;
    background: #6c63ff; color: #fff; border: 0; border-radius: 7px; cursor: pointer;
  }
  .sheet { text-align: center; padding: 8px 0 30px; }
  ${
    opts.embedded
      ? /*
           Embedded mode (iframe inside the scanner app preview modal).
           Three things:
             1. Hide the howto banner — the app's own modal has Print
                + Done controls; the howto would just crowd the iframe.
             2. Shrink body padding so the tag sits at the top.
             3. Override the tag's fixed 100mm width to fit the iframe
                responsively. The tag is fixed at ~378px (100mm @ 96dpi)
                which OVERFLOWED the iframe on iPhone portrait
                (~360px), clipping the name + ADA number. With
                width:100% + max-width:100mm + aspect-ratio:100/62 the
                tag scales to whatever the iframe has, preserving
                proportions. The fitText script re-fits the price +
                name to the new container size. @media print rules
                still use @page 100mm × 62mm so actual print output is
                unchanged — only the preview shrinks.
         */
        `.howto { display: none !important; }
         body { background: #fff; }
         .sheet { padding: 0; }
         /*
           Tighter sizing for the preview so the right edge fits in
           the iframe without clipping. Tony's 2026-06-02 evening
           test of the 375ml Tito's preview showed "ML" cut off at
           the end of "375 ML" because the standard 3mm/3.5mm padding
           + 2.5mm bottom-row gap exceeded the narrow iPhone-portrait
           iframe. These overrides only apply to the preview path —
           @media print rules still use the standard padding and
           gaps so the actual print output is unchanged.
         */
         .tag {
           width: 96%;
           max-width: 100mm;
           height: auto;
           aspect-ratio: 100 / 62;
           margin: 4px auto;
           padding: 2mm 2.5mm;
         }
         .tag__bottom {
           gap: 1.8mm;
           font-size: 2.7mm;
         }
         /*
           Force a guaranteed-fit font size in screen-only mode.
           fitText keeps mis-computing inside the modal iframe (the
           scrollWidth/clientWidth check sees the wrong viewport at
           load), so the price overflows even after viewport=400.
           CSS clamp(...) with viewport units gives a deterministic
           size that always fits. @media screen scopes this to the
           PREVIEW only — the actual print uses fitText's inline
           font-size set on load (which is close to right since
           the canvas is 400px vs print 378px).
         */
         @media screen {
           .tag__price {
             font-size: clamp(48px, 18vw, 96px) !important;
           }
           .tag__name span {
             font-size: clamp(11px, 3.2vw, 16px) !important;
           }
         }`
      : ""
  }
  .tag {
    width: var(--tag-w); height: var(--tag-h);
    background: #fff; color: #000;
    margin: 14px auto; padding: 3mm 3.5mm;
    display: flex; flex-direction: column;
    overflow: hidden;
    outline: 1px dashed #c4c4cc;
  }
  .tag__name { flex: none; height: 6mm; display: flex; align-items: center; overflow: hidden; }
  .tag__name span {
    display: inline-block; white-space: nowrap;
    font-weight: 700; text-transform: uppercase; letter-spacing: .02em;
    font-size: 3.3mm;
  }
  .tag__main { flex: 1; min-height: 0; display: flex; align-items: stretch; }
  .tag__date {
    flex: none; display: flex; align-items: center; justify-content: center;
    margin-right: 1.5mm;
  }
  .tag__date span {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font-size: 2.7mm; font-weight: 600; letter-spacing: .03em;
  }
  .tag__pricewrap {
    flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .tag__price {
    display: inline-block; white-space: nowrap;
    font-family: 'Arial Black', Arial, sans-serif;
    font-weight: 900; line-height: .85; letter-spacing: -0.04em;
  }
  .tag__bottom {
    flex: none; height: 11mm; display: flex; align-items: center; gap: 2.5mm;
    font-size: 3mm; font-weight: 700;
  }
  .tag__bar { flex: none; }
  .tag__bar svg { display: block; }
  .tag__size { margin-left: auto; white-space: nowrap; }
  @media print {
    @page { size: 100mm 62mm; margin: 0; }
    body { background: #fff; }
    .howto { display: none; }
    .sheet { padding: 0; }
    .tag { margin: 0; outline: none; page-break-after: always; }
    .tag:last-child { page-break-after: auto; }
  }
</style>
</head><body>
<div class="howto">
  <h2>Print shelf tags — Brother QL-810W</h2>
  Hit <strong>Print tags</strong> (or &#8984;P). In the dialog: printer
  <strong>Brother QL-810W</strong>, paper <strong>DK-2205 (62mm)</strong>,
  margins <strong>None</strong>, scale <strong>100%</strong>, "Print backgrounds" ON.
  <br><button onclick="window.print()">Print tags</button>
</div>
<div class="sheet">${tags}</div>
<script>
  function fitText(el, container, startPx, minPx) {
    let size = startPx;
    el.style.fontSize = size + "px";
    while (size > minPx &&
      (el.scrollWidth > container.clientWidth ||
       el.scrollHeight > container.clientHeight)) {
      size -= 1;
      el.style.fontSize = size + "px";
    }
  }
  window.addEventListener("load", function () {
    document.querySelectorAll(".tag").forEach(function (tag) {
      const priceEl = tag.querySelector(".tag__price");
      if (priceEl) fitText(priceEl, priceEl.parentElement, 260, 20);
      const nameEl = tag.querySelector(".tag__name span");
      if (nameEl) {
        const start = parseFloat(getComputedStyle(nameEl).fontSize) || 13;
        fitText(nameEl, nameEl.parentElement, start, 6);
      }
    });
  });
</script>
</body></html>`;

/**
 * POST /tags/render — render one or more shelf tags as a printable HTML page.
 *
 * Body: { codes: string[] }
 * Response: text/html (the full page)
 */
router.post("/render", async (req, res) => {
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
  if (codes.length === 0) {
    return res
      .status(400)
      .json({ ok: false, error: "codes must be a non-empty array" });
  }
  if (codes.length > MAX_CODES_PER_REQUEST) {
    return res.status(400).json({
      ok: false,
      error: `too many codes; max ${MAX_CODES_PER_REQUEST} per request`,
    });
  }
  const products = await fetchTagProducts(supabaseDefault, codes);
  if (products.length === 0) {
    return res
      .status(404)
      .json({ ok: false, error: "no matching products in catalog" });
  }
  const tagsHtml = products.map(buildTagHtml).join("\n");
  // ?embedded=1 (or body.embedded:true) → suppress the howto banner
  // for the scanner's in-app iframe preview modal. Default false
  // preserves direct-link / desktop usage.
  const embedded =
    req.query.embedded === "1" ||
    req.query.embedded === "true" ||
    req.body?.embedded === true;
  const html = PAGE_SHELL(tagsHtml, { embedded });
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

/**
 * GET /tags/render?code=100009 — convenience for single-code printing
 * direct from a link. Same response shape as POST.
 */
router.get("/render", async (req, res) => {
  const single = String(req.query.code ?? "").trim();
  if (!single) {
    return res
      .status(400)
      .json({ ok: false, error: "?code=<mlcc_code> required" });
  }
  const products = await fetchTagProducts(supabaseDefault, [single]);
  if (products.length === 0) {
    return res
      .status(404)
      .json({ ok: false, error: "product not found in catalog" });
  }
  const tagsHtml = products.map(buildTagHtml).join("\n");
  const embedded =
    req.query.embedded === "1" || req.query.embedded === "true";
  const html = PAGE_SHELL(tagsHtml, { embedded });
  res.set("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
});

export default router;
