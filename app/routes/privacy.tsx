/**
 * GET /privacy
 *
 * Public route — no Shopify authentication required.
 * Privacy policy for Insignia, required for Shopify protected customer data approval
 * and App Store listing.
 */
export default function PrivacyPolicy() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Privacy Policy — Insignia</title>
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        <div className="container">
          <header>
            <h1>Privacy Policy</h1>
            <p className="meta">
              Insignia by Optidigi &nbsp;·&nbsp; Last updated: April 13, 2026
            </p>
          </header>

          <section>
            <h2>1. Who we are</h2>
            <p>
              Insignia is a Shopify app developed and operated by Optidigi
              (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). Insignia
              enables merchants to offer product customization — specifically logo
              and artwork placement on products — to their customers at checkout.
            </p>
            <p>
              For questions about this policy, contact us at{" "}
              <a href="mailto:admin@optidigi.nl">admin@optidigi.nl</a>.
            </p>
          </section>

          <section>
            <h2>2. Data we collect and why</h2>
            <p>
              Insignia processes a limited set of personal data in order to
              provide its core functionality to merchants and their customers.
            </p>

            <h3>Order data</h3>
            <p>
              We access Shopify order records to identify which product variant
              was purchased, bind the customer&rsquo;s uploaded artwork to the
              correct order line, and track production status (received &rarr;
              in production &rarr; shipped) so merchants can fulfil decorated
              orders correctly.
            </p>

            <h3>Customer name</h3>
            <p>
              We display the customer&rsquo;s name on the merchant&rsquo;s order
              fulfilment view so they can match decorated products to the correct
              order during production and dispatch. We do not store the name in
              our own database — it is fetched from Shopify on demand when a
              merchant views an order.
            </p>

            <h3>Customer email address</h3>
            <p>
              We display the customer&rsquo;s email address on the order detail
              page and use it to pre-fill an artwork reminder template that
              merchants can copy and send to customers who have not yet provided
              their logo. We do not store email addresses in our own database or
              send emails on behalf of merchants automatically.
            </p>

            <h3>Uploaded artwork files</h3>
            <p>
              Customers may upload logo files (SVG, PNG, JPG, WebP) as part of
              the customization flow. These files are stored in Cloudflare R2
              object storage, scoped to the merchant&rsquo;s store. SVG files
              are sanitised before storage using DOMPurify to remove potentially
              harmful content. Files are accessible only via time-limited
              presigned URLs generated on demand.
            </p>

            <h3>Data we do not collect</h3>
            <p>
              Insignia does not access or store customer phone numbers, billing
              or shipping addresses, payment information, or any data beyond
              what is described above.
            </p>
          </section>

          <section>
            <h2>3. How we store and protect data</h2>
            <p>
              Order metadata (order IDs, line item IDs, artwork status, placement
              geometry) is stored in a PostgreSQL database hosted on a private
              server in the European Union. Artwork files are stored in Cloudflare
              R2 (EU region).
            </p>
            <p>
              All data is transmitted over HTTPS. Access to our infrastructure is
              restricted to authorised personnel only. We do not share merchant or
              customer data with any third parties.
            </p>
          </section>

          <section>
            <h2>4. Data retention</h2>
            <p>
              Order metadata and artwork files are retained for the lifetime of
              the merchant&rsquo;s installation of Insignia. When a merchant
              uninstalls the app, we process Shopify&rsquo;s GDPR{" "}
              <code>shop/redact</code> webhook and delete all associated data
              within 30 days.
            </p>
            <p>
              Merchants may request deletion of their data at any time by
              contacting us at{" "}
              <a href="mailto:admin@optidigi.nl">admin@optidigi.nl</a>.
            </p>
          </section>

          <section>
            <h2>5. Your rights (GDPR)</h2>
            <p>
              If you are located in the European Economic Area, you have the
              following rights regarding your personal data:
            </p>
            <ul>
              <li>
                <strong>Access</strong> — request a copy of the data we hold
                about you
              </li>
              <li>
                <strong>Rectification</strong> — request correction of inaccurate
                data
              </li>
              <li>
                <strong>Erasure</strong> — request deletion of your data
              </li>
              <li>
                <strong>Restriction</strong> — request that we limit how we use
                your data
              </li>
              <li>
                <strong>Portability</strong> — request your data in a
                machine-readable format
              </li>
              <li>
                <strong>Objection</strong> — object to our processing of your
                data
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:admin@optidigi.nl">admin@optidigi.nl</a>. We will
              respond within 30 days.
            </p>
          </section>

          <section>
            <h2>6. Cookies</h2>
            <p>
              Insignia does not use tracking or advertising cookies. Session
              cookies are used solely to maintain the authenticated session
              between the Shopify admin and the app.
            </p>
          </section>

          <section>
            <h2>7. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. The date at the top of
              this page reflects the most recent revision. Continued use of
              Insignia after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <footer>
            <p>
              Insignia by Optidigi &nbsp;·&nbsp;{" "}
              <a href="mailto:admin@optidigi.nl">admin@optidigi.nl</a>
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}

const styles = `
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fafafa;
  }

  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 48px 24px 80px;
  }

  header {
    margin-bottom: 48px;
    padding-bottom: 24px;
    border-bottom: 1px solid #e5e5e5;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 8px;
  }

  .meta {
    color: #666;
    margin: 0;
    font-size: 0.9rem;
  }

  h2 {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 40px 0 12px;
    color: #111;
  }

  h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 24px 0 8px;
    color: #333;
  }

  p { margin: 0 0 12px; }

  ul {
    margin: 8px 0 12px;
    padding-left: 24px;
  }

  li { margin-bottom: 6px; }

  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }

  code {
    font-family: monospace;
    font-size: 0.9em;
    background: #f0f0f0;
    padding: 1px 5px;
    border-radius: 3px;
  }

  section { margin-bottom: 8px; }

  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid #e5e5e5;
    color: #666;
    font-size: 0.9rem;
  }
`;
