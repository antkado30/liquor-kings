/**
 * Public marketing landing page for Liquor Kings.
 *
 * v2 — "the storefront" (M5, 2026-08-09). Full redesign the night the
 * self-serve signup machine shipped. Design doctrine (Tony, locked):
 *
 *   1. ONE-WAY MIRROR: sell outcomes and identity, never mechanics.
 *      We built our competitor dossier from THEIR landing pages; ours
 *      gives a copycat nothing — no feature grid, no capability list,
 *      no UI screenshots. What it shows is the thing that can't be
 *      cloned: a family that grew up in the stores.
 *   2. PROFESSIONAL + FAMILY-OWNED: premium craft ("what huge
 *      companies would pay $100k for") with counter-talk voice.
 *      Short sentences. No SaaS words (platform/solution/leverage).
 *   3. Story facts (Tony 8/9): cousins raised in two family liquor
 *      stores — Clay Township (on the water) and Detroit. Our own
 *      store's real order runs through LK every Wednesday. Store
 *      names intentionally NOT printed. Partners: Tony + cousins
 *      Aydel and Jacob (names not printed either — "we're cousins").
 *   4. CONTACT HOLD-SPOT: no public email/phone yet ("until we get
 *      officialized"). When ready, add it in the footer block marked
 *      CONTACT-SLOT below.
 *
 * Look: liquor shelf at night — near-black bottle green, cream,
 * brass. Fraunces display serif (storefront-sign energy) + Inter.
 * Signature mark: the barcode, drawn in pure CSS, used as divider and
 * hero ornament. SVG-noise grain overlay so nothing reads flat-SaaS.
 * Single file, no frameworks; tiny inline JS for scroll-reveal and
 * the sticky header, both disabled under prefers-reduced-motion.
 *
 * CTA target: /signup → 302 → /scanner#signup (the wizard).
 * Terms locked 8/8: $149/store/month flat · 14-day free trial
 * (covers two Wednesday order days) · no card to start.
 */

export function landingPageHtml() {
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Liquor Kings — your liquor order, done in minutes</title>
<meta name="description" content="The liquor ordering system built by a Michigan party-store family. Scan the bottle, check real prices, send the order to the state in minutes. 14 days free, then $149/month flat." />
<meta property="og:title" content="Liquor Kings — your liquor order, done in minutes" />
<meta property="og:description" content="Built by a Michigan party-store family, for every store like ours. 14 days free. $149/month flat." />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #0c1410;          /* near-black green */
    --ink-2: #12211a;        /* deep bottle green */
    --ink-3: #1a3026;        /* raised panel green */
    --cream: #f4eddd;
    --cream-dim: rgba(244, 237, 221, 0.72);
    --cream-faint: rgba(244, 237, 221, 0.45);
    --brass: #c9a55a;
    --brass-bright: #e0bd72;
    --line: rgba(244, 237, 221, 0.14);
    --maxw: 1060px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    background: var(--ink);
    color: var(--cream);
    font-family: "Inter", -apple-system, "Segoe UI", sans-serif;
    font-size: 17px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }
  ::selection { background: var(--brass); color: var(--ink); }

  /* film grain over everything — kills the flat look */
  body::after {
    content: "";
    position: fixed; inset: 0;
    pointer-events: none;
    z-index: 40;
    opacity: 0.05;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.7'/%3E%3C/svg%3E");
  }

  h1, h2, .serif {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.08;
  }
  .em { font-style: italic; color: var(--brass-bright); font-weight: 600; }

  .wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 24px; }

  /* ---- the barcode, our mark ---------------------------------- */
  .barcode {
    height: 34px;
    background: repeating-linear-gradient(90deg,
      var(--cream) 0 2px,  transparent 2px 5px,
      var(--cream) 5px 6px, transparent 6px 12px,
      var(--cream) 12px 16px, transparent 16px 19px,
      var(--cream) 19px 20px, transparent 20px 26px,
      var(--cream) 26px 28px, transparent 28px 31px,
      var(--cream) 31px 36px, transparent 36px 42px);
    opacity: 0.85;
  }
  .barcode--brass { background: repeating-linear-gradient(90deg,
      var(--brass) 0 2px,  transparent 2px 5px,
      var(--brass) 5px 6px, transparent 6px 12px,
      var(--brass) 12px 16px, transparent 16px 19px,
      var(--brass) 19px 20px, transparent 20px 26px,
      var(--brass) 26px 28px, transparent 28px 31px,
      var(--brass) 31px 36px, transparent 36px 42px);
  }
  .barcode--rule { height: 18px; width: 130px; opacity: 0.9; }

  /* ---- sticky header ------------------------------------------ */
  .topbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 50;
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px;
    background: rgba(12, 20, 16, 0.88);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
    transform: translateY(-110%);
    transition: transform 0.35s ease;
  }
  .topbar.on { transform: translateY(0); }
  .topbar__name {
    font-family: "Fraunces", serif; font-weight: 700;
    letter-spacing: 0.14em; font-size: 15px; color: var(--cream);
    text-decoration: none;
  }
  .btn {
    display: inline-block;
    background: var(--brass);
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
    border-radius: 999px;
    padding: 14px 30px;
    font-size: 17px;
    letter-spacing: 0.01em;
    transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    box-shadow: 0 6px 24px rgba(201, 165, 90, 0.25);
  }
  .btn:hover { transform: translateY(-2px); background: var(--brass-bright); box-shadow: 0 10px 32px rgba(201, 165, 90, 0.35); }
  .btn:active { transform: translateY(0); }
  .btn--small { padding: 9px 20px; font-size: 15px; box-shadow: none; }

  /* ---- hero ---------------------------------------------------- */
  .hero {
    min-height: 92svh;
    display: flex; flex-direction: column; justify-content: center;
    position: relative;
    padding: 96px 0 72px;
    background:
      radial-gradient(1200px 700px at 78% -10%, rgba(201, 165, 90, 0.10), transparent 60%),
      radial-gradient(900px 600px at -10% 110%, rgba(26, 48, 38, 0.9), transparent 60%),
      var(--ink);
  }
  .hero__mark {
    display: flex; align-items: center; gap: 14px;
    margin-bottom: 44px;
  }
  .hero__name {
    font-family: "Fraunces", serif; font-weight: 700;
    letter-spacing: 0.22em; font-size: 15px; color: var(--cream-dim);
  }
  .hero h1 {
    font-size: clamp(46px, 8.5vw, 96px);
    font-weight: 700;
    max-width: 11ch;
  }
  .hero__sub {
    margin-top: 26px;
    font-size: clamp(18px, 2.2vw, 21px);
    color: var(--cream-dim);
    max-width: 46ch;
  }
  .hero__cta { margin-top: 42px; display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
  .hero__terms { font-size: 15px; color: var(--cream-faint); letter-spacing: 0.02em; }
  .hero__terms b { color: var(--cream-dim); font-weight: 600; }

  /* faint tall barcode on the hero edge */
  .hero::before {
    content: "";
    position: absolute; top: 10%; bottom: 10%; right: -30px; width: 120px;
    background: repeating-linear-gradient(180deg,
      var(--cream) 0 3px, transparent 3px 9px,
      var(--cream) 9px 11px, transparent 11px 22px,
      var(--cream) 22px 29px, transparent 29px 34px,
      var(--cream) 34px 36px, transparent 36px 47px);
    opacity: 0.045;
    pointer-events: none;
  }

  /* ---- sections ------------------------------------------------ */
  section { padding: 92px 0; position: relative; }
  .kicker {
    font-size: 13px; font-weight: 600; letter-spacing: 0.24em;
    text-transform: uppercase; color: var(--brass);
    margin-bottom: 22px;
  }
  h2 { font-size: clamp(32px, 4.6vw, 48px); max-width: 22ch; }

  .story { background: var(--ink-2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .story p {
    font-family: "Fraunces", Georgia, serif;
    font-size: clamp(21px, 3vw, 28px);
    line-height: 1.5;
    font-weight: 400;
    max-width: 30ch;
    margin-top: 30px;
    color: var(--cream);
  }
  .story p + p { margin-top: 22px; }
  .story .sign {
    margin-top: 38px; display: flex; align-items: center; gap: 16px;
    color: var(--cream-faint); font-size: 15px; letter-spacing: 0.06em;
  }

  /* trio */
  .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 54px; }
  .trio__card {
    background: var(--ink-3);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 34px 28px 30px;
    transition: transform 0.25s ease, border-color 0.25s ease;
  }
  .trio__card:hover { transform: translateY(-4px); border-color: rgba(201, 165, 90, 0.4); }
  .trio__num {
    font-family: "Fraunces", serif; font-style: italic;
    color: var(--brass); font-size: 18px; margin-bottom: 16px; display: block;
  }
  .trio__card h3 { font-family: "Fraunces", serif; font-size: 26px; font-weight: 600; margin-bottom: 10px; }
  .trio__card p { color: var(--cream-dim); font-size: 16px; }

  /* trust */
  .trust__rows { margin-top: 46px; border-top: 1px solid var(--line); }
  .trust__row {
    display: flex; gap: 22px; align-items: baseline;
    padding: 26px 4px; border-bottom: 1px solid var(--line);
  }
  .trust__row .serif { color: var(--brass); font-style: italic; font-size: 19px; min-width: 26px; }
  .trust__row p { color: var(--cream-dim); max-width: 62ch; }
  .trust__row b { color: var(--cream); font-weight: 600; }

  /* pricing */
  .price { background: var(--ink-2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .price__card {
    margin: 50px auto 0;
    max-width: 520px;
    background: var(--cream);
    color: var(--ink);
    border-radius: 22px;
    padding: 46px 42px 42px;
    text-align: center;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
    position: relative;
    overflow: hidden;
  }
  .price__card .barcode { position: absolute; top: 0; left: 0; right: 0; height: 8px; opacity: 1; }
  .price__flat {
    display: inline-block; font-size: 12px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: #8a6b28; margin-bottom: 14px;
  }
  .price__num {
    font-family: "Fraunces", serif; font-weight: 700;
    font-size: clamp(64px, 10vw, 92px); line-height: 1;
  }
  .price__num sup { font-size: 0.38em; font-weight: 600; vertical-align: 26px; margin-right: 2px; }
  .price__per { color: rgba(12, 20, 16, 0.6); font-size: 17px; margin-top: 6px; }
  .price__list { list-style: none; margin: 28px 0 32px; text-align: center; }
  .price__list li { padding: 7px 0; color: rgba(12, 20, 16, 0.82); font-size: 16.5px; }
  .price__list li b { font-weight: 600; }
  .price__foot { margin-top: 18px; font-size: 14px; color: rgba(12, 20, 16, 0.55); }

  /* tags aside — the cheeky one-liner (Tony YES, 8/10) */
  .tags-aside { padding: 74px 0; text-align: center; }
  .tags-aside .kicker { margin-bottom: 16px; }
  .tags-aside p {
    font-family: "Fraunces", Georgia, serif;
    font-size: clamp(22px, 3.2vw, 34px);
    line-height: 1.35;
    max-width: 30ch;
    margin: 0 auto;
  }

  /* promise */
  .promise { text-align: center; padding: 110px 0; }
  .promise p {
    font-family: "Fraunces", Georgia, serif;
    font-size: clamp(24px, 3.6vw, 36px);
    line-height: 1.4; max-width: 26ch; margin: 0 auto;
  }
  .promise .barcode--rule { margin: 42px auto 0; }

  /* footer */
  footer {
    border-top: 1px solid var(--line);
    padding: 44px 0 60px;
    color: var(--cream-faint); font-size: 14px;
  }
  .foot__row { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; }
  .foot__name { font-family: "Fraunces", serif; font-weight: 700; letter-spacing: 0.2em; color: var(--cream-dim); font-size: 14px; }
  .foot__legal a { color: var(--cream-faint); text-decoration: none; border-bottom: 1px solid var(--line); }
  .foot__legal a:hover { color: var(--cream-dim); }
  /* CONTACT-SLOT: when officialized, add support email / phone here. */

  /* reveal on scroll */
  .rv { opacity: 0; transform: translateY(14px); transition: opacity 0.7s ease, transform 0.7s ease; }
  .rv.in { opacity: 1; transform: none; }

  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .rv { opacity: 1; transform: none; transition: none; }
    .btn, .trio__card { transition: none; }
  }
  /* magazine split: headline column | content column (desktop) */
  @media (min-width: 821px) {
    .split { display: grid; grid-template-columns: 5fr 7fr; gap: 64px; align-items: start; }
    .split__head { position: sticky; top: 90px; }
  }
  .price .kicker, .price h2 { text-align: center; margin-left: auto; margin-right: auto; }

  @media (max-width: 820px) {
    .trio { grid-template-columns: 1fr; }
    section { padding: 72px 0; }
    .hero { padding-top: 72px; }
    .price__card { padding: 38px 26px 34px; }
  }
</style>
</head>
<body>

<nav class="topbar" id="topbar" aria-label="Site">
  <a class="topbar__name" href="#top">LIQUOR&nbsp;KINGS</a>
  <a class="btn btn--small" href="/signup">Start free</a>
</nav>

<header class="hero" id="top">
  <div class="wrap">
    <div class="hero__mark">
      <div class="barcode barcode--brass barcode--rule" aria-hidden="true"></div>
      <span class="hero__name">LIQUOR&nbsp;KINGS</span>
    </div>
    <h1>Your liquor order. Done in <span class="em">minutes.</span></h1>
    <p class="hero__sub">The ordering system built by a Michigan party-store
    family — for every store like ours.</p>
    <div class="hero__cta">
      <a class="btn" href="/signup">Start free</a>
      <span class="hero__terms"><b>14 days free</b> &nbsp;&middot;&nbsp; no card &nbsp;&middot;&nbsp; $149/month after</span>
    </div>
  </div>
</header>

<section class="story">
  <div class="wrap split">
    <div class="split__head">
      <div class="kicker rv">Who we are</div>
      <h2 class="rv">We didn&rsquo;t study this industry. We grew up in it.</h2>
    </div>
    <div>
    <p class="rv" style="margin-top:0">We&rsquo;re cousins. One of our family&rsquo;s stores sits on
    the water in Clay Township. The other is in Detroit. We were raised in
    both &mdash; stocking coolers, running registers, and typing the weekly
    liquor order into the state&rsquo;s website line by line.</p>
    <p class="rv">So we built the thing we always wished existed. Our own
    store&rsquo;s real order runs through Liquor Kings every single
    Wednesday. If it ever wasn&rsquo;t good enough for our store, it
    wouldn&rsquo;t be good enough for yours.</p>
    <div class="sign rv">
      <div class="barcode barcode--rule" aria-hidden="true"></div>
      <span>THE&nbsp;FAMILY&nbsp;BEHIND&nbsp;THE&nbsp;COUNTER</span>
    </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="kicker rv">How your week changes</div>
    <h2 class="rv">Scan. Check. Done.</h2>
    <div class="trio">
      <div class="trio__card rv">
        <span class="trio__num">No. 1</span>
        <h3>Scan</h3>
        <p>Point your phone at the bottle on your shelf. That&rsquo;s the
        whole skill.</p>
      </div>
      <div class="trio__card rv">
        <span class="trio__num">No. 2</span>
        <h3>Check</h3>
        <p>See real prices, current with the state&rsquo;s book &mdash;
        always. Know your order is right before it goes anywhere.</p>
      </div>
      <div class="trio__card rv">
        <span class="trio__num">No. 3</span>
        <h3>Done</h3>
        <p>Send the order to the state in minutes and get back to running
        your store.</p>
      </div>
    </div>
  </div>
</section>

<section class="trust">
  <div class="wrap split">
    <div class="split__head">
      <div class="kicker rv">Why store owners trust it</div>
      <h2 class="rv">Our money runs through it too.</h2>
    </div>
    <div class="trust__rows" style="margin-top:6px">
      <div class="trust__row rv">
        <span class="serif" aria-hidden="true">i.</span>
        <p><b>Your state login stays yours.</b> Stored encrypted, used only
        to place the orders you approve, removable any time.</p>
      </div>
      <div class="trust__row rv">
        <span class="serif" aria-hidden="true">ii.</span>
        <p><b>Every order keeps a full paper trail.</b> Confirmation
        numbers, totals, dates &mdash; a permanent record you can stand on.</p>
      </div>
      <div class="trust__row rv">
        <span class="serif" aria-hidden="true">iii.</span>
        <p><b>We bet our own store on it weekly.</b> Our family&rsquo;s real
        order, real money, every Wednesday &mdash; before we&rsquo;d ever ask
        for yours.</p>
      </div>
    </div>
  </div>
</section>

<section class="tags-aside">
  <div class="wrap">
    <div class="kicker rv">One more thing</div>
    <p class="rv">Oh &mdash; and it prints your shelf tags.
    <span class="em">Any printer you already own.</span></p>
  </div>
</section>

<section class="price">
  <div class="wrap">
    <div class="kicker rv">Pricing</div>
    <h2 class="rv">One price. Everything included.</h2>
    <div class="price__card rv">
      <div class="barcode" aria-hidden="true"></div>
      <span class="price__flat">Flat &middot; No Tiers &middot; No Surprises</span>
      <div class="price__num"><sup>$</sup>149</div>
      <div class="price__per">per store, per month</div>
      <ul class="price__list">
        <li><b>14 days free</b> &mdash; covers two order days</li>
        <li>No card to start</li>
        <li>Cancel anytime</li>
        <li>More than one store? <b>$99/month</b> each after the first</li>
      </ul>
      <a class="btn" href="/signup">Start free</a>
      <div class="price__foot">Built in Michigan, for Michigan stores.</div>
    </div>
  </div>
</section>

<section class="promise">
  <div class="wrap">
    <p class="rv">We work on this every single day &mdash; <span class="em">because
    we use it every single day.</span></p>
    <div class="barcode barcode--brass barcode--rule rv" aria-hidden="true"></div>
  </div>
</section>

<footer>
  <div class="wrap foot__row">
    <span class="foot__name">LIQUOR&nbsp;KINGS</span>
    <span>Built in Michigan &nbsp;&middot;&nbsp; &copy; 2026 Liquor Kings</span>
    <span class="foot__legal"><a href="/terms">Terms</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy</a></span>
    <!-- CONTACT-SLOT: public support email / phone goes here once officialized -->
  </div>
</footer>

<script>
  (function () {
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var bar = document.getElementById("topbar");
    var onScroll = function () {
      if (window.scrollY > 420) bar.classList.add("on");
      else bar.classList.remove("on");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    var els = document.querySelectorAll(".rv");
    if (reduced || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.18 });
    els.forEach(function (el) { io.observe(el); });
  })();
</script>

</body>
</html>`;
}
