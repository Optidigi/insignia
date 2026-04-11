/**
 * Shop currency: fetch and cache the shop's currency code from Shopify.
 * Called on dashboard load to sync. Other pages read from the DB.
 */

import db from "../../db.server";

type AdminGraphql = (
  query: string,
  variables?: Record<string, unknown>
) => Promise<Response>;

/**
 * Fetch the shop's currency from Shopify and update the DB.
 * Returns the ISO 4217 currency code (e.g., "USD", "EUR", "GBP").
 */
export async function syncShopCurrency(
  shopId: string,
  adminGraphql: AdminGraphql
): Promise<string> {
  try {
    const res = await adminGraphql(
      `#graphql
        query shopCurrency {
          shop { currencyCode }
        }`
    );
    const json = await res.json();
    const currencyCode = json?.data?.shop?.currencyCode;

    if (currencyCode) {
      await db.shop.update({
        where: { id: shopId },
        data: { currencyCode },
      });
      return currencyCode;
    }
  } catch (e) {
    console.warn("[shop-currency] Failed to sync currency:", e);
  }

  // Fallback: read from DB
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { currencyCode: true },
  });
  return shop?.currencyCode ?? "USD";
}

/**
 * Get the currency symbol for display.
 */
export function currencySymbol(code: string): string {
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "\u20ac",
    GBP: "\u00a3",
    CAD: "CA$",
    AUD: "A$",
    JPY: "\u00a5",
    CHF: "CHF",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
    PLN: "z\u0142",
    CZK: "K\u010d",
    HUF: "Ft",
    BRL: "R$",
    MXN: "MX$",
    INR: "\u20b9",
    NZD: "NZ$",
    SGD: "S$",
    HKD: "HK$",
    KRW: "\u20a9",
    TRY: "\u20ba",
    ZAR: "R",
    ILS: "\u20aa",
    AED: "AED",
    SAR: "SAR",
    MYR: "RM",
    THB: "\u0e3f",
    TWD: "NT$",
    PHP: "\u20b1",
    IDR: "Rp",
    VND: "\u20ab",
    CNY: "\u00a5",
    RUB: "\u20bd",
  };
  return symbols[code] ?? code;
}
