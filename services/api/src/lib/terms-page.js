/**
 * Terms of Service — task #87, 2026-06-06.
 *
 * Plain-English starter draft for V1 launch. Tailored to LK's specific
 * context: SaaS automating MILO orders on behalf of Michigan-licensed
 * liquor retailers. Has lawyer review before any broad marketing push.
 */
import { renderLegalPage } from "./legal-page.js";

export function termsPageHtml() {
  return renderLegalPage({
    title: "Terms of Service",
    lastUpdated: "June 6, 2026",
    bodyHtml: `
      <div class="callout">
        <strong>Plain-English summary:</strong> You operate a Michigan-licensed
        liquor retailer and want a tool that places your MLCC orders for you.
        We provide that tool. You're responsible for the orders. We're
        responsible for keeping the service working. Don't try to use this
        for fraud, and don't blame us if MILO goes down.
      </div>

      <h2>1. Who we are</h2>
      <p>
        Liquor Kings ("Liquor Kings," "we," "us," or "our") is a software
        service operated out of Michigan. We provide a subscription-based
        tool that helps licensed Michigan liquor retailers prepare and place
        wholesale liquor orders through the State of Michigan's MILO
        ordering portal (operated by the Michigan Liquor Control Commission,
        a part of the Department of Licensing and Regulatory Affairs).
      </p>
      <p>
        We are <strong>not affiliated with, endorsed by, or operated by</strong>
        the State of Michigan, the MLCC, LARA, MILO, or any state agency.
        We are an independent third-party tool that automates the same
        actions a human store owner would take on the MILO portal.
      </p>

      <h2>2. Who can use Liquor Kings</h2>
      <p>You may use Liquor Kings only if all of the following are true:</p>
      <ul>
        <li>You are at least 21 years old.</li>
        <li>You are the owner, operator, or authorized representative of a
            Michigan retailer with an active liquor license issued by the MLCC.</li>
        <li>You have valid login credentials for the MILO ordering portal
            for that licensed location.</li>
        <li>You agree to these Terms and our <a href="/privacy">Privacy Policy</a>.</li>
      </ul>
      <p>
        If you create an account on behalf of a business, you represent that
        you have authority to bind that business to these Terms.
      </p>

      <h2>3. Your account</h2>
      <p>
        When you sign up, we provision an account that includes:
        an email + password for Liquor Kings itself, a store record
        (name, license number, optional address), and your MLCC/MILO
        credentials — which we encrypt at rest using AES-256-GCM and
        only ever use to place or verify orders on your behalf.
      </p>
      <p>
        You are responsible for keeping your credentials secret. If you
        believe your account has been accessed without your permission,
        contact us immediately at <a href="mailto:support@liquorkings.com">support@liquorkings.com</a>.
      </p>

      <h2>4. The MLCC automation — how it actually works</h2>
      <p>
        Liquor Kings uses your stored MILO credentials to log into the
        MLCC ordering portal on your behalf, navigate to your products
        page, validate cart contents, and (when you explicitly authorize
        a submit) place the order. <strong>Every order is initiated by
        you</strong> — by clicking Validate or Submit in our app — and
        every order is placed against your own licensed account using
        your own credentials.
      </p>
      <p>
        We do not place orders without your express action. We do not
        modify your MILO credentials. We do not place orders on behalf of
        anyone other than the licensed retailer who signed up for the
        account.
      </p>
      <p>
        <strong>You remain solely responsible</strong> for the contents,
        quantities, and accuracy of any order placed through Liquor
        Kings. We will surface validation errors, stock issues, and
        applicable MLCC rules in the UI — but you are the buyer.
      </p>

      <h2>5. Subscription and billing</h2>
      <p>
        Liquor Kings is offered as a monthly subscription at the rate
        published on our website at the time you sign up (currently
        $119/month). Billing details, including any free trial, will be
        presented at sign-up.
      </p>
      <p>
        You may cancel at any time. Cancellation takes effect at the end
        of the current billing period. We do not pro-rate refunds for
        partial months unless required by law.
      </p>
      <p>
        We may change pricing in the future. Existing subscribers will be
        given at least 30 days' notice before any price change takes
        effect.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use Liquor Kings for any purpose that violates Michigan or
            federal law, including liquor control regulations.</li>
        <li>Use the service to place orders for any account you are not
            authorized to operate.</li>
        <li>Attempt to circumvent rate limits, security controls, or our
            review of suspicious activity.</li>
        <li>Reverse-engineer, decompile, or attempt to extract source code
            from the service.</li>
        <li>Resell, sublicense, or commercially redistribute access to the
            service without our prior written agreement.</li>
        <li>Use the service to attack, probe, or interfere with the MILO
            portal or any other system.</li>
      </ul>

      <h2>7. Service availability</h2>
      <p>
        We work hard to keep Liquor Kings running, but we don't promise
        100% uptime. The service depends on third-party systems we don't
        control — most importantly the MLCC's MILO portal. If MILO is
        down, slow, or has changed its interface, Liquor Kings may be
        temporarily unable to place or validate orders. We'll do our best
        to detect and communicate these outages but cannot guarantee
        uninterrupted access.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        Liquor Kings is provided <strong>"as is" and "as available"</strong>
        without warranties of any kind, whether express, implied,
        statutory, or otherwise, including without limitation any implied
        warranties of merchantability, fitness for a particular purpose,
        title, or non-infringement. We do not warrant that the service
        will be uninterrupted, error-free, or that defects will be
        corrected.
      </p>
      <p>
        We make no representation or warranty regarding the actions of
        the MLCC, LARA, the State of Michigan, or any other third party.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, in no event will Liquor
        Kings, its founders, employees, or contractors be liable for any
        indirect, incidental, special, consequential, exemplary, or
        punitive damages — including without limitation loss of profits,
        revenue, data, or business opportunity — arising out of or
        relating to your use of the service.
      </p>
      <p>
        Our total liability for any claim arising out of or relating to
        these Terms or the service is limited to the greater of (a) the
        amount you paid us for the service in the 12 months preceding
        the event giving rise to the claim, or (b) one hundred U.S.
        dollars ($100).
      </p>

      <h2>10. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Liquor Kings
        from and against any claims, damages, losses, liabilities, and
        expenses (including reasonable attorneys' fees) arising out of
        or relating to (a) your use of the service in violation of these
        Terms, (b) any order placed through your account, or (c) your
        violation of any law or third-party rights.
      </p>

      <h2>11. Termination</h2>
      <p>
        You can cancel your subscription at any time from the Settings
        page in the app, or by emailing us. We can suspend or terminate
        your account if we reasonably believe you've violated these
        Terms or applicable law. Sections of these Terms that by their
        nature should survive termination — including ownership,
        disclaimers, limitation of liability, and indemnification —
        will survive.
      </p>

      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes
        will be communicated to active subscribers at least 30 days
        before they take effect. Your continued use of the service after
        a change indicates your acceptance of the updated Terms.
      </p>

      <h2>13. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Michigan,
        without regard to its conflict-of-laws principles. Any dispute
        arising under these Terms will be brought exclusively in the
        state or federal courts located in Michigan, and you consent to
        personal jurisdiction in those courts.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Email
        <a href="mailto:support@liquorkings.com">support@liquorkings.com</a>.
      </p>
    `,
  });
}
