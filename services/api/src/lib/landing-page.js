/**
 * Public marketing landing page for Liquor Kings (task #79, 2026-06-06).
 *
 * Served from the API at GET / so liquor-kings.fly.dev opens with a
 * pitch, not a login screen. Single static HTML file — no React, no
 * build step. Designed mobile-first for the realistic case of a store
 * owner clicking a Twitter/email link on their phone.
 *
 * Goal of every section:
 *   Hero: 2-second value prop. "Place your MLCC order in 5 minutes."
 *   How it works: scan → validate → submit (the demo flow).
 *   Features: templates, scheduling, dashboard, tag printing, AI.
 *   Social proof: Colony Party Store testimonial (Tony's dad).
 *   CTA: "Sign up your store" → /scanner with the signup tab selected.
 *
 * When this lands on a more interactive marketing site later, this
 * stays as the canonical "fastest possible front door" version.
 */

export function landingPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Liquor Kings — Place your MLCC order in minutes, not hours</title>
<meta name="description" content="Liquor Kings is the MLCC ordering tool for Michigan liquor stores. Scan, validate, submit. Auto-prepares your weekly orders. Built for owners who'd rather run their store than fight a clunky state portal." />
<meta property="og:title" content="Liquor Kings" />
<meta property="og:description" content="Place your MLCC order in minutes, not hours. Built for Michigan liquor stores." />
<meta property="og:type" content="website" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🥃</text></svg>" />
<style>
  :root {
    --bg: #0b0d12;
    --bg-2: #11141b;
    --fg: #ffffff;
    --fg-muted: rgba(255,255,255,0.65);
    --fg-dim: rgba(255,255,255,0.45);
    --accent: #6c63ff;
    --accent-2: #34d399;
    --warn: #f59e0b;
    --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  .container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  /* Header */
  .nav {
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(11,13,18,0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    padding: 14px 0;
  }
  .nav-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .brand { font-weight: 800; font-size: 17px; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
  .brand-mark { font-size: 22px; }
  .nav-cta {
    display: inline-block;
    padding: 8px 14px;
    background: var(--accent);
    color: #fff;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
  }
  /* Hero */
  .hero {
    padding: 80px 0 64px;
    text-align: center;
    background:
      radial-gradient(ellipse at top, rgba(108,99,255,0.18), transparent 60%),
      radial-gradient(ellipse at bottom, rgba(52,211,153,0.10), transparent 60%);
  }
  .hero-eyebrow {
    display: inline-block;
    padding: 6px 12px;
    background: rgba(108,99,255,0.16);
    border: 1px solid rgba(108,99,255,0.32);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    margin-bottom: 24px;
  }
  .hero h1 {
    margin: 0;
    font-size: 56px;
    line-height: 1.05;
    letter-spacing: -0.025em;
    font-weight: 800;
    background: linear-gradient(180deg, #fff 0%, #c7c9d4 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .hero h1 .accent {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .hero-sub {
    max-width: 640px;
    margin: 24px auto 0;
    font-size: 18px;
    color: var(--fg-muted);
  }
  .hero-cta { margin-top: 36px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn-primary, .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 14px 24px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 15px;
    border: none;
    cursor: pointer;
  }
  .btn-primary {
    background: linear-gradient(135deg, var(--accent) 0%, #4f46e5 100%);
    color: #fff;
    box-shadow: 0 10px 30px -10px rgba(108,99,255,0.5);
  }
  .btn-secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .hero-meta {
    margin-top: 24px;
    color: var(--fg-dim);
    font-size: 13px;
  }
  /* Section base */
  section { padding: 72px 0; border-top: 1px solid var(--border); }
  .section-title {
    font-size: 32px;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 0 0 12px;
    text-align: center;
  }
  .section-sub {
    text-align: center;
    color: var(--fg-muted);
    margin: 0 auto 48px;
    max-width: 600px;
  }
  /* How it works */
  .steps { display: grid; grid-template-columns: 1fr; gap: 18px; }
  @media (min-width: 760px) { .steps { grid-template-columns: repeat(3, 1fr); } }
  .step {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
  }
  .step-num {
    display: inline-block;
    width: 32px; height: 32px; line-height: 32px; text-align: center;
    background: rgba(108,99,255,0.16);
    color: #c4b5fd;
    border-radius: 8px;
    font-weight: 800;
    margin-bottom: 16px;
  }
  .step h3 { margin: 0 0 8px; font-size: 19px; }
  .step p { margin: 0; color: var(--fg-muted); font-size: 14px; }
  /* Features */
  .features { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 760px) { .features { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1000px) { .features { grid-template-columns: repeat(3, 1fr); } }
  .feature {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 24px;
  }
  .feature-icon { font-size: 28px; margin-bottom: 10px; }
  .feature h3 { margin: 0 0 6px; font-size: 17px; }
  .feature p { margin: 0; color: var(--fg-muted); font-size: 14px; line-height: 1.55; }
  /* Quote */
  .quote-wrap { max-width: 720px; margin: 0 auto; text-align: center; }
  .quote {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.4;
  }
  .quote-attr { margin-top: 16px; color: var(--fg-muted); font-size: 14px; }
  /* Pricing */
  .pricing-card {
    max-width: 460px;
    margin: 0 auto;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 32px;
    text-align: center;
  }
  .price {
    font-size: 48px;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 16px 0 4px;
  }
  .price-unit { font-size: 16px; color: var(--fg-muted); font-weight: 500; }
  .pricing-features {
    text-align: left;
    list-style: none;
    padding: 0;
    margin: 24px 0;
  }
  .pricing-features li {
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .pricing-features li:last-child { border-bottom: none; }
  .check { color: var(--accent-2); margin-right: 8px; font-weight: 700; }
  /* CTA section */
  .cta-final {
    text-align: center;
    background: linear-gradient(135deg, rgba(108,99,255,0.18) 0%, rgba(52,211,153,0.10) 100%);
  }
  .cta-final h2 { font-size: 32px; margin: 0 0 12px; }
  .cta-final p { color: var(--fg-muted); margin: 0 0 28px; }
  /* Footer */
  footer {
    padding: 32px 0;
    text-align: center;
    color: var(--fg-dim);
    font-size: 13px;
    border-top: 1px solid var(--border);
  }
  /* Mobile tweaks */
  @media (max-width: 600px) {
    .hero { padding: 56px 0 48px; }
    .hero h1 { font-size: 40px; }
    .hero-sub { font-size: 16px; }
    section { padding: 56px 0; }
    .section-title { font-size: 26px; }
  }
</style>
</head>
<body>
  <header class="nav">
    <div class="container nav-row">
      <div class="brand"><span class="brand-mark">🥃</span> Liquor Kings</div>
      <a class="nav-cta" href="/scanner#signup">Sign up</a>
    </div>
  </header>

  <main>
    <!-- Hero -->
    <section class="hero" style="border: none;">
      <div class="container">
        <div class="hero-eyebrow">Built for Michigan liquor stores</div>
        <h1>
          Place your MLCC order in
          <span class="accent">minutes, not hours.</span>
        </h1>
        <p class="hero-sub">
          Scan bottles. Validate against MLCC live. Submit. Save your weekly
          order once and reload it the following week with one tap. Stop
          fighting the state portal.
        </p>
        <div class="hero-cta">
          <a class="btn-primary" href="/scanner#signup">Sign your store up →</a>
          <a class="btn-secondary" href="#how-it-works">See how it works</a>
        </div>
        <p class="hero-meta">No credit card required to start. Built by a MI store owner.</p>
      </div>
    </section>

    <!-- How it works -->
    <section id="how-it-works">
      <div class="container">
        <h2 class="section-title">How it works</h2>
        <p class="section-sub">
          Three steps. Same flow you already use — just dramatically faster.
          Your average 1.5-to-2-hour MLCC order becomes a 5-to-10-minute one.
        </p>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <h3>📷 Scan</h3>
            <p>
              Point your phone at a bottle. We identify it in milliseconds
              against the live MLCC catalog of 13,800+ SKUs. Add to cart with
              one tap. Or load your saved weekly template — done.
            </p>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <h3>✅ Validate</h3>
            <p>
              We log into MILO for you behind the scenes, push your cart,
              and surface exactly what MLCC would do — out-of-stock items,
              split-case violations, ADA minimums. Catch problems in 30
              seconds, not after rejection.
            </p>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <h3>🚀 Submit</h3>
            <p>
              One tap. We place the order on MILO and store your confirmation
              number, gross total, delivery date — your whole order history
              in one searchable list.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section style="background: var(--bg-2);">
      <div class="container">
        <h2 class="section-title">What's in the box</h2>
        <p class="section-sub">
          Every feature here is shipped and running on Colony Party Store
          right now.
        </p>
        <div class="features">
          <div class="feature">
            <div class="feature-icon">📋</div>
            <h3>Saved order templates</h3>
            <p>
              Save your Thursday weekly order once. Every Thursday morning,
              tap the &quot;ready to review&quot; banner — cart populated, you adjust
              the exceptions, validate, submit. 30 min → 5 min.
            </p>
          </div>
          <div class="feature">
            <div class="feature-icon">📅</div>
            <h3>Auto-scheduled prep</h3>
            <p>
              Set a template to prepare every Tuesday, Friday, whatever
              day you order. Walk in, tap, review. Never start from a
              blank cart again.
            </p>
          </div>
          <div class="feature">
            <div class="feature-icon">📊</div>
            <h3>Real-time analytics</h3>
            <p>
              This week's spend vs last week. Top movers. ADA breakdown.
              Biggest jumps. Glance at your phone and know what's happening
              in your store.
            </p>
          </div>
          <div class="feature">
            <div class="feature-icon">🏷️</div>
            <h3>Shelf tag printing</h3>
            <p>
              Scan a bottle → tag with current MLCC price, barcode, and
              date prints to your Brother label printer. Works with any
              media (die-cut or continuous tape).
            </p>
          </div>
          <div class="feature">
            <div class="feature-icon">🤖</div>
            <h3>AI ordering assistant</h3>
            <p>
              &quot;What&apos;s the 9 liter rule?&quot; &quot;Can I order 8 bottles of a 750ml?&quot;
              &quot;How much did I spend on Tito&apos;s last month?&quot; Ask in plain English.
              Trained on MLCC rules and your real order history.
            </p>
          </div>
          <div class="feature">
            <div class="feature-icon">🛒</div>
            <h3>Universal Browse</h3>
            <p>
              Amazon-style catalog of all 13,800 MLCC SKUs. Filter by
              category, distributor, price, proof. Tap to add to cart.
              Discover new arrivals before competitors do.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Testimonial -->
    <section>
      <div class="container quote-wrap">
        <div style="font-size: 36px; margin-bottom: 16px;">&ldquo;</div>
        <div class="quote">
          Liquor Kings cut my weekly order from almost 2 hours to 5 minutes.
          My MILO order history is finally in one place. I&apos;ve placed every
          order through it for months.
        </div>
        <div class="quote-attr">— Colony Party Store, Michigan</div>
      </div>
    </section>

    <!-- Pricing teaser -->
    <section style="background: var(--bg-2);">
      <div class="container">
        <h2 class="section-title">Simple pricing</h2>
        <p class="section-sub">
          One plan. Everything included. No per-order fees.
        </p>
        <div class="pricing-card">
          <div style="font-size: 14px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.08em;">
            Store
          </div>
          <div class="price">$119 <span class="price-unit">/ month</span></div>
          <div style="color: var(--fg-muted); font-size: 14px;">
            Per liquor license. Cancel anytime.
          </div>
          <ul class="pricing-features">
            <li><span class="check">✓</span> Unlimited orders + templates</li>
            <li><span class="check">✓</span> All ADAs (NWS, General Wine, Imperial)</li>
            <li><span class="check">✓</span> Real-time analytics + AI assistant</li>
            <li><span class="check">✓</span> Shelf tag printing + scheduling</li>
            <li><span class="check">✓</span> Free updates forever</li>
            <li><span class="check">✓</span> 14-day free trial, no card required</li>
          </ul>
          <a class="btn-primary" style="display:block;" href="/scanner#signup">Start free trial →</a>
        </div>
      </div>
    </section>

    <!-- Final CTA -->
    <section class="cta-final">
      <div class="container">
        <h2>Ready to stop fighting MILO?</h2>
        <p>Takes 2 minutes to sign up. Your first order goes through tonight.</p>
        <a class="btn-primary" href="/scanner#signup">Sign your store up →</a>
      </div>
    </section>
  </main>

  <footer>
    <div class="container">
      Liquor Kings — built by an MI liquor store owner, for MI liquor store owners.
      <br />
      Questions? Email <a href="mailto:tony@liquor-kings.com" style="color: var(--fg-muted); text-decoration: underline;">tony@liquor-kings.com</a>
      <div style="margin-top: 14px; font-size: 13px;">
        <a href="/terms" style="color: var(--fg-muted); text-decoration: underline;">Terms</a>
        ·
        <a href="/privacy" style="color: var(--fg-muted); text-decoration: underline;">Privacy</a>
      </div>
    </div>
  </footer>
</body>
</html>`;
}
