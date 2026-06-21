/**
 * Merchant email notifications via Resend.
 *
 * Gated behind RESEND_API_KEY — if the env var is not set, notifications
 * are silently skipped so the feature is fully opt-in.
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function notifyMerchantNewOrder(
  shopDomain: string,
  orderDetails: {
    productName: string;
    methodName: string;
    artworkStatus: string;
  },
  shopEmail?: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[notifications] RESEND_API_KEY not set — skipping email");
    return;
  }

  const productName = escapeHtml(orderDetails.productName);
  const methodName = escapeHtml(orderDetails.methodName);
  const artworkText =
    orderDetails.artworkStatus === "PROVIDED"
      ? "Provided by customer"
      : "Pending — customer will upload later";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Insignia <notifications@insignia.optidigi.nl>",
        to: [shopEmail || `admin@${shopDomain}`],
        subject: `New customization order: ${escapeHtml(orderDetails.productName)}`,
        html: `
          <h2>New Customization Order</h2>
          <p><strong>Product:</strong> ${productName}</p>
          <p><strong>Method:</strong> ${methodName}</p>
          <p><strong>Artwork:</strong> ${artworkText}</p>
          <p>View the order in your <a href="https://admin.shopify.com/store/${shopDomain.replace(".myshopify.com", "")}/apps/insignia">Insignia dashboard</a>.</p>
        `,
      }),
    });

    if (!response.ok) {
      console.error(
        "[notifications] Email send failed:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error("[notifications] Email send error:", error);
  }
}

type QuoteQuantityLine = {
  variantId?: string;
  variantTitle?: string | null;
  sizeLabel?: string | null;
  quantity: number;
};

type QuoteRequestNotification = {
  id: string;
  productTitle: string;
  variantTitle?: string | null;
  productImageUrl?: string | null;
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  logoUrl?: string | null;
  decorationLabel?: string | null;
  maxFormatLabel?: string | null;
  placementWish: string;
  notes?: string | null;
  quantities?: QuoteQuantityLine[];
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  companyName?: string | null;
};

export async function notifyMerchantQuoteRequest(
  shopDomain: string,
  quote: QuoteRequestNotification,
  shopEmail?: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[notifications] RESEND_API_KEY not set — skipping quote email");
    return;
  }

  const productTitle = escapeHtml(quote.productTitle);
  const artworkText =
    quote.artworkStatus === "PROVIDED"
      ? "Artwork geüpload"
      : "Klant stuurt artwork later";
  const quantityRows = (quote.quantities ?? [])
    .filter((line) => line.quantity > 0)
    .map((line) => {
      const label = escapeHtml(line.sizeLabel || line.variantTitle || "Variant");
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${line.quantity}</td></tr>`;
    })
    .join("");
  const quantityTotal = (quote.quantities ?? []).reduce((sum, line) => sum + line.quantity, 0);
  const logoLink = quote.logoUrl
    ? `<p><strong>Artwork URL:</strong> <a href="${escapeHtml(quote.logoUrl)}">${escapeHtml(quote.logoUrl)}</a></p>`
    : "";
  const productImage = quote.productImageUrl
    ? `<p><img src="${escapeHtml(quote.productImageUrl)}" alt="" style="max-width:220px;max-height:220px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;padding:8px;" /></p>`
    : "";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Insignia <notifications@insignia.optidigi.nl>",
        to: [shopEmail || process.env.QUOTE_REQUEST_EMAIL || `admin@${shopDomain}`],
        reply_to: quote.contactEmail,
        subject: `Nieuwe offerteaanvraag: ${quote.productTitle}`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
            <h2>Nieuwe offerteaanvraag</h2>
            ${productImage}
            <h3>Product</h3>
            <p><strong>Product:</strong> ${productTitle}</p>
            ${quote.variantTitle ? `<p><strong>Variant:</strong> ${escapeHtml(quote.variantTitle)}</p>` : ""}
            <p><strong>Techniek:</strong> ${escapeHtml(quote.decorationLabel || "Stitchs adviseert")}</p>
            <p><strong>Maximaal formaat:</strong> ${escapeHtml(quote.maxFormatLabel || "-")}</p>
            <p><strong>Artwork:</strong> ${artworkText}</p>
            ${logoLink}
            <h3>Aantallen${quantityTotal > 0 ? ` (${quantityTotal} stuks)` : ""}</h3>
            ${
              quantityRows
                ? `<table style="border-collapse:collapse;min-width:260px;"><tbody>${quantityRows}</tbody></table>`
                : "<p>Geen aantallen opgegeven.</p>"
            }
            <h3>Plaatsing en opmerkingen</h3>
            <p><strong>Plaatsingswens:</strong><br>${escapeHtml(quote.placementWish).replace(/\n/g, "<br>")}</p>
            ${quote.notes ? `<p><strong>Opmerkingen:</strong><br>${escapeHtml(quote.notes).replace(/\n/g, "<br>")}</p>` : ""}
            <h3>Contact</h3>
            <p>
              <strong>Naam:</strong> ${escapeHtml(quote.contactName)}<br>
              <strong>E-mail:</strong> <a href="mailto:${escapeHtml(quote.contactEmail)}">${escapeHtml(quote.contactEmail)}</a><br>
              ${quote.contactPhone ? `<strong>Telefoon:</strong> ${escapeHtml(quote.contactPhone)}<br>` : ""}
              ${quote.companyName ? `<strong>Bedrijf:</strong> ${escapeHtml(quote.companyName)}<br>` : ""}
            </p>
            <p>Bekijk de aanvraag in je <a href="https://admin.shopify.com/store/${shopDomain.replace(".myshopify.com", "")}/apps/insignia">Insignia dashboard</a>.</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      console.error(
        "[notifications] Quote email send failed:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error("[notifications] Quote email send error:", error);
  }
}
