/**
 * Shared chrome for static legal pages (Terms, Privacy) — task #87,
 * 2026-06-06. Matches the landing page's brand identity so users
 * don't feel like they were dumped on a third-party legal portal
 * when they click "Terms" or "Privacy" in the footer.
 *
 * Pages get the same dark theme, same fonts, same accent colors.
 * Each page just supplies its title + inner HTML body.
 *
 * IMPORTANT: this is not a substitute for an attorney's review. The
 * content drafts living in services/api/src/lib/{terms,privacy}-page.js
 * are starting points written in plain English to match LK's voice
 * and cover the obvious bases (encryption, no-data-selling, MLCC
 * disclaimers, Michigan jurisdiction). Get them reviewed before any
 * broad public launch.
 */

export function renderLegalPage({ title, lastUpdated, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)} — Liquor Kings</title>
<meta name="robots" content="index, follow" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🥃</text></svg>" />
<style>
  :root {
    --bg: #0b0d12;
    --bg-2: #11141b;
    --fg: #ffffff;
    --fg-muted: rgba(255,255,255,0.7);
    --fg-dim: rgba(255,255,255,0.5);
    --accent: #6c63ff;
    --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 22px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }
  .topbar a.brand {
    color: var(--fg); text-decoration: none; font-weight: 800; font-size: 18px;
  }
  .topbar nav { display: flex; gap: 18px; }
  .topbar nav a {
    color: var(--fg-muted); text-decoration: none; font-size: 14px; font-weight: 500;
  }
  .topbar nav a:hover { color: var(--fg); }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 36px 22px 80px;
  }
  h1 {
    font-size: 32px;
    font-weight: 800;
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  .last-updated {
    color: var(--fg-dim);
    font-size: 13px;
    margin: 0 0 30px;
  }
  h2 {
    font-size: 20px;
    font-weight: 700;
    margin: 36px 0 12px;
    color: var(--fg);
  }
  h3 {
    font-size: 16px;
    font-weight: 700;
    margin: 22px 0 8px;
  }
  p, li {
    color: var(--fg-muted);
    font-size: 15px;
  }
  p { margin: 0 0 14px; }
  ul, ol { padding-left: 22px; margin: 0 0 16px; }
  li { margin-bottom: 6px; }
  strong { color: var(--fg); font-weight: 700; }
  a {
    color: #8e9aff;
    text-decoration: underline;
  }
  a:hover { color: #b5beff; }
  .callout {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    padding: 14px 16px;
    margin: 18px 0;
    color: var(--fg-muted);
    font-size: 14px;
  }
  .callout strong { color: var(--fg); }
  footer {
    border-top: 1px solid var(--border);
    padding: 30px 22px;
    text-align: center;
    color: var(--fg-dim);
    font-size: 13px;
  }
  footer a { color: var(--fg-muted); }
</style>
</head>
<body>
  <div class="topbar">
    <a href="/" class="brand">🥃 Liquor Kings</a>
    <nav>
      <a href="/">Home</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      <a href="/scanner">Sign in</a>
    </nav>
  </div>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="last-updated">Last updated: ${escapeHtml(lastUpdated)}</p>
    ${bodyHtml}
  </main>
  <footer>
    <div>© ${new Date().getFullYear()} Liquor Kings. Built in Michigan.</div>
    <div style="margin-top: 6px;">
      <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="mailto:support@liquorkings.com">support@liquorkings.com</a>
    </div>
  </footer>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
