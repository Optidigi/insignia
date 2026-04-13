/**
 * Merchant email notifications via Resend.
 *
 * Gated behind RESEND_API_KEY — if the env var is not set, notifications
 * are silently skipped so the feature is fully opt-in.
 */

export async function notifyMerchantNewOrder(
  shopDomain: string,
  orderDetails: {
    productName: string;
    methodName: string;
    artworkStatus: string;
  },
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[notifications] RESEND_API_KEY not set — skipping email");
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Insignia <notifications@insignia.optidigi.nl>",
        to: [`admin@${shopDomain}`],
        subject: `New customization order: ${orderDetails.productName}`,
        html: `
          <h2>New Customization Order</h2>
          <p><strong>Product:</strong> ${orderDetails.productName}</p>
          <p><strong>Method:</strong> ${orderDetails.methodName}</p>
          <p><strong>Artwork:</strong> ${orderDetails.artworkStatus === "PROVIDED" ? "Provided by customer" : "Pending — customer will upload later"}</p>
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
