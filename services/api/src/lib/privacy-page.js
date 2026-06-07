/**
 * Privacy Policy — task #87, 2026-06-06.
 *
 * Plain-English starter draft. Same caveat as the Terms — have an
 * attorney review before broad public launch. The promises we make
 * here are real; if you change subprocessors or storage architecture,
 * UPDATE THIS FILE in lockstep.
 */
import { renderLegalPage } from "./legal-page.js";

export function privacyPageHtml() {
  return renderLegalPage({
    title: "Privacy Policy",
    lastUpdated: "June 6, 2026",
    bodyHtml: `
      <div class="callout">
        <strong>The short version:</strong> We collect what we need to
        run your store's MLCC orders. We encrypt your MILO password
        with AES-256-GCM. <strong>We never sell your data.</strong>
        We never share it with advertisers or marketers. The only
        third parties who touch it are the infrastructure providers
        who help us run the service, plus the MLCC itself when we
        place an order.
      </div>

      <h2>1. Who we are</h2>
      <p>
        Liquor Kings is a Michigan-based software service that helps
        licensed liquor retailers place wholesale orders through the
        MLCC's MILO portal. This Privacy Policy explains what
        information we collect, how we use it, and the choices you have.
      </p>

      <h2>2. What we collect</h2>
      <p>When you sign up and use Liquor Kings, we collect:</p>
      <ul>
        <li>
          <strong>Account info:</strong> your email address, a password
          you choose (which we hash via Supabase Auth — we never see or
          store the plaintext), and the name of your store.
        </li>
        <li>
          <strong>Store profile:</strong> your Michigan liquor license
          number and optional address details (street, city, ZIP).
        </li>
        <li>
          <strong>MLCC credentials:</strong> the username and password
          you use to log into the MILO portal. We encrypt the password
          at rest using AES-256-GCM and only ever use it to act on
          your behalf via the MILO portal.
        </li>
        <li>
          <strong>Activity data:</strong> bottles you scan, products
          you add to a cart, orders you place, validation results,
          templates you save, and chats you send to our AI assistant.
        </li>
        <li>
          <strong>Order history:</strong> a record of MILO confirmations,
          line items, totals, and any validation errors — so you have a
          searchable archive and we can troubleshoot if something fails.
        </li>
        <li>
          <strong>Technical data:</strong> IP address, browser/device
          info, and session timestamps. Used for rate limiting, fraud
          prevention, and basic operational analytics.
        </li>
      </ul>

      <h2>3. What we do NOT collect</h2>
      <ul>
        <li>We do not collect or store payment card numbers ourselves.
            When billing is added, payments will be processed by Stripe.</li>
        <li>We do not collect health, demographic, or marketing-profile
            data.</li>
        <li>We do not use third-party tracking pixels or ad networks on
            the marketing site or in the app.</li>
        <li>We do not collect data from end customers of your liquor
            store (their purchases, their identities, etc.) unless you
            explicitly upload it.</li>
      </ul>

      <h2>4. How we use it</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide the service — place and verify your MLCC orders,
            show you products, run the scanner, render shelf tags.</li>
        <li>Communicate with you about your account (security alerts,
            failed runs, billing notices).</li>
        <li>Improve the service — detect bugs, debug failed orders,
            and make features better.</li>
        <li>Prevent abuse — rate-limit signups, detect fraud, comply
            with applicable law.</li>
      </ul>
      <p>
        We do not use your data to train external AI models. When you
        send a message to the in-app AI assistant, the message is sent
        to our AI subprocessor (Anthropic) for response generation and
        is not used to train their models per their API terms.
      </p>

      <h2>5. How it's stored</h2>
      <p>
        Your data lives in a Supabase Postgres database hosted in a
        United States region. Connections use TLS (HTTPS) end-to-end.
        Row-Level Security policies are in place on every multi-tenant
        table — your store's data is technically isolated from other
        stores' data at the database layer, not just at the
        application layer.
      </p>
      <p>
        Your MLCC password is encrypted at rest with AES-256-GCM
        using a key that is stored only as a Fly.io secret (not in
        source, not in our database). Even with full read access to
        the database, an attacker cannot recover your MLCC password
        without also compromising our deployment secrets.
      </p>

      <h2>6. Who we share it with</h2>
      <p>
        We share data only with the small set of infrastructure
        providers we need to run the service, and only the minimum
        each needs to do its job. Specifically:
      </p>
      <ul>
        <li><strong>Supabase</strong> — database, authentication,
            file storage.</li>
        <li><strong>Fly.io</strong> — application hosting and
            background workers.</li>
        <li><strong>Anthropic</strong> — generates responses for the
            in-app AI assistant. Only the specific messages you send
            to the assistant are forwarded.</li>
        <li><strong>MLCC / MILO (lara.michigan.gov)</strong> — when
            you initiate a Validate or Submit, we log in on your behalf
            and exchange the data required to place that order.</li>
        <li><strong>Stripe</strong> (future) — payment processing when
            billing launches. We do not store card numbers ourselves.</li>
      </ul>
      <p>
        <strong>We do not sell your data. We do not share your data
        with advertisers, data brokers, or marketing companies. We do
        not share order history or customer lists with anyone.</strong>
      </p>
      <p>
        We may disclose information if required by law (subpoena, court
        order, etc.) or to investigate suspected fraud or abuse. If
        we're ever served with a legal request that touches your data,
        we'll try to give you notice unless legally prohibited.
      </p>

      <h2>7. How long we keep it</h2>
      <p>
        We keep your data for as long as your account is active. If you
        cancel, we retain your account and order history for 12 months
        in case you reactivate or need access to historical orders for
        tax or audit purposes. After 12 months of inactivity, we delete
        the account.
      </p>
      <p>
        You can request immediate deletion of your account and all
        associated data at any time by emailing
        <a href="mailto:support@liquorkings.com">support@liquorkings.com</a>.
        We'll confirm within 7 days.
      </p>

      <h2>8. Your rights</h2>
      <p>You have the right to:</p>
      <ul>
        <li><strong>Access</strong> — request a copy of the personal
            data we hold about you.</li>
        <li><strong>Correct</strong> — fix anything that's wrong
            (most of it is editable from inside the app).</li>
        <li><strong>Delete</strong> — close your account and have your
            data deleted.</li>
        <li><strong>Export</strong> — receive your order history and
            store data in a portable format (CSV or JSON).</li>
        <li><strong>Object</strong> — tell us to stop processing your
            data for any optional purpose (analytics, etc.).</li>
      </ul>
      <p>
        To exercise any of these, email
        <a href="mailto:support@liquorkings.com">support@liquorkings.com</a>.
      </p>

      <h2>9. Children</h2>
      <p>
        Liquor Kings is a tool for licensed adult liquor retailers and
        is not intended for anyone under 21. We do not knowingly
        collect personal information from anyone under 21. If you
        believe a minor has provided us with information, contact us
        and we'll delete it.
      </p>

      <h2>10. Cookies and local storage</h2>
      <p>
        The Liquor Kings app uses your browser's local storage to keep
        you signed in (Supabase Auth session) and remember a few UI
        preferences. We do not set advertising or tracking cookies.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material
        changes will be communicated to active accounts at least 30
        days before they take effect. The "Last updated" date at the
        top of this page reflects the most recent change.
      </p>

      <h2>12. Contact</h2>
      <p>
        Privacy questions? Email
        <a href="mailto:support@liquorkings.com">support@liquorkings.com</a>.
      </p>
    `,
  });
}
