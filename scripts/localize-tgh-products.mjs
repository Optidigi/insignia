/* global process */

import "@shopify/shopify-app-react-router/adapters/node";
import fs from "node:fs";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";

const METADATA_PATH = process.env.TGH_METADATA_PATH || "/tmp/tgh-metadata.json";
const DRY_RUN = process.env.DRY_RUN !== "0";
const CONCURRENCY = Number.parseInt(process.env.LOCALIZE_CONCURRENCY || "4", 10);

const db = new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  future: { expiringOfflineAccessTokens: true },
  ...(process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}),
});

const TAG_TRANSLATIONS = new Map([
  ["t-shirt", "T-shirt"],
  ["polo", "Polo"],
  ["hoodie", "Hoodie"],
  ["sweater", "Sweater"],
  ["fleece", "Fleece"],
  ["jacket", "Jas"],
  ["pants", "Broek"],
  ["cap", "Pet"],
  ["bag", "Tas"],
  ["apron", "Schort"],
  ["ecologisch", "Ecologisch"],
  ["EVE Vegan", "EVE Vegan"],
  ["VEGAN", "Vegan"],
  ["FAIR WEAR FOUNDATION", "Fair Wear Foundation"],
  ["OEKO-TEX 100", "OEKO-TEX 100"],
  ["OEKO-TEX 101", "OEKO-TEX 101"],
  ["REACH", "REACH"],
]);

const CATEGORY_RULES = [
  ["schort", /\b(apron|schort)\b/i],
  ["tas", /\b(bag|backpack|rugzak|duffel|shopper|tote|tas)\b/i],
  ["jas", /\b(jacket|parka|puffer|bodywarmer|softshell|rain|regen|windbreaker|jas|gilet|vest)\b/i],
  ["pet", /\b(cap|beanie|muts|hat|snapback|pet)\b/i],
  ["broek", /\b(sweatpant|pant|pants|trouser|shorts|bermuda|legging|jogging|broek)\b/i],
  ["polo", /\b(polo)\b/i],
  ["hoodie", /\b(zip hood|hoodie|hooded|hood|capuchon)\b/i],
  ["sweater", /\b(sweatshirt|sweater|sweat)\b/i],
  ["fleece", /\b(fleece|microfleece)\b/i],
  ["t-shirt", /\b(t-shirt|shirt|tee|singlet|top)\b/i],
];

const CATEGORY_LABELS = {
  "t-shirt": "T-shirt",
  polo: "Polo",
  hoodie: "Hoodie",
  sweater: "Sweater",
  fleece: "Fleece",
  jas: "Jas",
  broek: "Broek",
  pet: "Pet",
  tas: "Tas",
  schort: "Schort",
  overig: "Overig",
};

const CATEGORY_TAG_LABELS = new Set(Object.values(CATEGORY_LABELS));

const COLOR_WORDS = [
  ["fluorescent", "fluor"],
  ["fluo", "fluor"],
  ["heather", "gemeleerd"],
  ["melange", "melange"],
  ["marl", "gemeleerd"],
  ["solid", "effen"],
  ["light", "licht"],
  ["dark", "donker"],
  ["deep", "diep"],
  ["bright", "helder"],
  ["pale", "bleek"],
  ["french", "frans"],
  ["royal", "koningsblauw"],
  ["navy", "marineblauw"],
  ["blue", "blauw"],
  ["black", "zwart"],
  ["white", "wit"],
  ["grey", "grijs"],
  ["gray", "grijs"],
  ["red", "rood"],
  ["orange", "oranje"],
  ["yellow", "geel"],
  ["green", "groen"],
  ["forest", "bos"],
  ["forestgreen", "bosgroen"],
  ["bottle", "fles"],
  ["kelly", "kelly"],
  ["lime", "limoen"],
  ["olive", "olijf"],
  ["brown", "bruin"],
  ["purple", "paars"],
  ["pink", "roze"],
  ["burgundy", "bordeaux"],
  ["wine", "wijnrood"],
  ["anthracite", "antraciet"],
  ["charcoal", "houtskool"],
  ["khaki", "kaki"],
  ["beige", "beige"],
  ["natural", "naturel"],
  ["cream", "creme"],
  ["stone", "steen"],
  ["sand", "zand"],
  ["gold", "goud"],
  ["silver", "zilver"],
  ["turquoise", "turquoise"],
  ["aqua", "aqua"],
  ["sky", "hemel"],
  ["smoke", "rookgrijs"],
  ["ash", "asgrijs"],
  ["denim", "denim"],
  ["camo", "camouflage"],
  ["camouflage", "camouflage"],
  ["graphite", "grafiet"],
  ["steel", "staal"],
  ["mint", "mint"],
  ["lavender", "lavendel"],
  ["lilac", "lila"],
  ["fuchsia", "fuchsia"],
  ["raspberry", "framboos"],
  ["coral", "koraal"],
  ["chocolate", "chocolade"],
  ["coffee", "koffie"],
  ["camel", "camel"],
  ["mustard", "mosterd"],
  ["plum", "pruim"],
  ["sage", "salie"],
  ["petrol", "petrol"],
];

const COLOR_PHRASES = [
  ["royal blue", "koningsblauw"],
  ["navy blue", "marineblauw"],
  ["dark grey", "donkergrijs"],
  ["light grey", "lichtgrijs"],
  ["heather grey", "gemeleerd grijs"],
  ["grey heather", "gemeleerd grijs"],
  ["oxford grey", "oxfordgrijs"],
  ["forest green", "bosgroen"],
  ["bottle green", "flessengroen"],
  ["sky blue", "hemelsblauw"],
  ["lime green", "limoengroen"],
  ["light blue", "lichtblauw"],
  ["deep navy", "diep marineblauw"],
  ["french navy", "frans marineblauw"],
  ["off white", "gebroken wit"],
];

function titleCase(value) {
  return value.replace(/\p{L}[\p{L}'-]*/gu, (word) => word.charAt(0).toLocaleUpperCase("nl-NL") + word.slice(1));
}

function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function translateColorPart(part) {
  let result = normalizeKey(part);
  for (const [from, to] of COLOR_PHRASES) {
    result = result.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), to);
  }
  const words = new Map(COLOR_WORDS);
  result = result
    .split(/(\W+)/)
    .map((token) => words.get(token) || token)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return titleCase(result);
}

function translateColor(value) {
  if (!value || /^[0-9A-Z/ .-]+$/.test(value)) return value;
  return value
    .split("/")
    .map((part) => translateColorPart(part))
    .join("/");
}

function translateSize(value) {
  if (!value) return value;
  return value
    .replace(/\bone size\b/gi, "Eén maat")
    .replace(/\b(\d+)\s*-\s*(\d+)\s*Y\b/g, "$1-$2 jaar")
    .replace(/\b(\d+)\s*Y\b/g, "$1 jaar")
    .replace(/\b(\d+)\s*-\s*(\d+)\s*M\b/g, "$1-$2 maanden")
    .replace(/\b(\d+)\s*M\b/g, "$1 maanden");
}

function inferCategory(meta) {
  const title = meta.title || "";
  if (/sweat\s*pant|sweatpant|joggingbroek/i.test(title)) return "broek";
  if (/puffer|jacket|parka|softshell|bodywarmer|windbreaker|padded|jas/i.test(title)) return "jas";
  if (/zip\s*hood|hoodie|hoody|hooded/i.test(title)) return "hoodie";
  if (/sweatshirt|sweater|crew\s*sweat|\bsweat\b/i.test(title)) return "sweater";
  if (/t-?shirt|\btee\b|singlet/i.test(title)) return "t-shirt";
  if (/polo/i.test(title)) return "polo";
  if (/fleece|microfleece/i.test(title)) return "fleece";
  if (/cap|beanie|muts|snapback|pet/i.test(title)) return "pet";
  if (/bag|backpack|rugzak|duffel|shopper|tote|tas/i.test(title)) return "tas";
  if (/apron|schort/i.test(title)) return "schort";

  const sources = [
    meta.type || "",
    meta.tags?.join(" ") || "",
    meta.body || "",
  ];
  for (const source of sources) {
    for (const [category, pattern] of CATEGORY_RULES) {
      if (pattern.test(source)) return category;
    }
  }
  return "overig";
}

function localizedTags(meta, category) {
  const categoryLabel = CATEGORY_LABELS[category] || "Overig";
  const tags = new Set(["TGH", categoryLabel]);
  for (const tag of meta.tags || []) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const translated = TAG_TRANSLATIONS.get(trimmed) || trimmed;
    if (CATEGORY_TAG_LABELS.has(translated) && translated !== categoryLabel) continue;
    tags.add(translated);
  }
  return Array.from(tags).filter(Boolean);
}

function removeOptionValueCollisions(option, valuesToUpdate) {
  const proposedById = new Map(valuesToUpdate.map((value) => [value.id, value.name]));
  const finalNameCounts = new Map();
  for (const value of option.optionValues || []) {
    const finalName = proposedById.get(value.id) || value.name;
    finalNameCounts.set(finalName, (finalNameCounts.get(finalName) || 0) + 1);
  }
  return valuesToUpdate.filter((value) => finalNameCounts.get(value.name) === 1);
}

async function graphql(admin, query, variables = {}) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const res = await admin.graphql(query, { variables });
      const body = await res.json();
      if (!res.ok || body.errors) throw new Error(JSON.stringify({ status: res.status, body }, null, 2));
      return body;
    } catch (error) {
      const message = String(error?.message || error);
      const retryable =
        message.includes("Throttled") ||
        message.includes("Bad Gateway") ||
        message.includes("502") ||
        message.includes("currently being modified") ||
        message.includes("TOO_MANY_PARALLEL_REQUESTS_FOR_THIS_PRODUCT");
      if (!retryable || attempt === 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function fetchAllProducts(admin) {
  const products = [];
  let cursor = null;
  for (;;) {
    const body = await graphql(admin, `#graphql
      query Products($cursor: String) {
        products(first: 250, after: $cursor) {
          nodes {
            id
            handle
            title
            productType
            tags
            options(first: 3) {
              id
              name
              position
              optionValues { id name }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`, { cursor });
    const page = body.data.products;
    products.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return products;
}

async function updateProduct(admin, product, meta, category) {
  const body = await graphql(admin, `#graphql
    mutation ProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id handle productType tags }
        userErrors { field message }
      }
    }`, {
    product: {
      id: product.id,
      productType: CATEGORY_LABELS[category] || "Overig",
      tags: localizedTags(meta, category),
    },
  });
  const errors = body.data.productUpdate.userErrors;
  if (errors?.length) throw new Error(JSON.stringify(errors, null, 2));
}

async function updateOption(admin, productId, option, optionName, valuesToUpdate) {
  const body = await graphql(admin, `#graphql
    mutation ProductOptionUpdate(
      $productId: ID!,
      $option: OptionUpdateInput!,
      $optionValuesToUpdate: [OptionValueUpdateInput!]
    ) {
      productOptionUpdate(
        productId: $productId,
        option: $option,
        optionValuesToUpdate: $optionValuesToUpdate,
        variantStrategy: LEAVE_AS_IS
      ) {
        product { id handle }
        userErrors { field message }
      }
    }`, {
    productId,
    option: { id: option.id, name: optionName },
    optionValuesToUpdate: valuesToUpdate,
  });
  const errors = body.data.productOptionUpdate.userErrors;
  if (errors?.length) throw new Error(JSON.stringify(errors, null, 2));
}

const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));
const shop = await db.shop.findFirst({ select: { shopifyDomain: true } });
if (!shop) throw new Error("No shop found");
const { admin } = await shopify.unauthenticated.admin(shop.shopifyDomain);

console.log(`shop=${shop.shopifyDomain}`);
console.log(`dryRun=${DRY_RUN}`);
console.log(`metadataProducts=${Object.keys(metadata).length}`);

const allProducts = await fetchAllProducts(admin);
const products = allProducts.filter((product) => metadata[product.handle]);
const categoryCounts = new Map();
let productUpdates = 0;
let optionNameUpdates = 0;
let optionValueUpdates = 0;
let skippedOptionValueUpdates = 0;
let loggedSamples = 0;
const workItems = [];

for (const product of products) {
  const meta = metadata[product.handle];
  const category = inferCategory(meta);
  categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  const nextProductType = CATEGORY_LABELS[category] || "Overig";
  const nextTags = localizedTags(meta, category);
  const productNeedsUpdate =
    product.productType !== nextProductType ||
    JSON.stringify([...product.tags].sort()) !== JSON.stringify([...nextTags].sort());
  if (productNeedsUpdate) productUpdates += 1;

  const optionUpdates = [];
  for (const option of product.options || []) {
    const targetName = option.position === 1 || /^color$/i.test(option.name) ? "Kleur" : option.position === 2 || /^size$/i.test(option.name) ? "Maat" : option.name;
    const valuesToUpdate = [];
    if (targetName === "Kleur") {
      for (const value of option.optionValues || []) {
        const nextName = translateColor(value.name);
        if (nextName && nextName !== value.name) valuesToUpdate.push({ id: value.id, name: nextName });
      }
    } else if (targetName === "Maat") {
      for (const value of option.optionValues || []) {
        const nextName = translateSize(value.name);
        if (nextName && nextName !== value.name) valuesToUpdate.push({ id: value.id, name: nextName });
      }
    }
    const safeValuesToUpdate = removeOptionValueCollisions(option, valuesToUpdate);
    skippedOptionValueUpdates += valuesToUpdate.length - safeValuesToUpdate.length;
    if (option.name !== targetName || safeValuesToUpdate.length > 0) {
      optionUpdates.push({ option, targetName, valuesToUpdate: safeValuesToUpdate });
      if (option.name !== targetName) optionNameUpdates += 1;
      optionValueUpdates += safeValuesToUpdate.length;
    }
  }

  if (loggedSamples < 12 && (productNeedsUpdate || optionUpdates.length)) {
    console.log(JSON.stringify({
      handle: product.handle,
      title: product.title,
      productType: [product.productType, nextProductType],
      tags: nextTags,
      options: optionUpdates.map((u) => ({
        name: [u.option.name, u.targetName],
        values: u.valuesToUpdate.slice(0, 8).map((v) => ({ id: v.id, name: v.name })),
      })),
    }));
    loggedSamples += 1;
  }

  if (!DRY_RUN && (productNeedsUpdate || optionUpdates.length)) {
    workItems.push({ product, meta, category, productNeedsUpdate, optionUpdates });
  }
}

if (!DRY_RUN && workItems.length > 0) {
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.max(1, Math.min(CONCURRENCY, workItems.length));

  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = workItems[index];
      if (!item) return;
      if (item.productNeedsUpdate) await updateProduct(admin, item.product, item.meta, item.category);
      for (const { option, targetName, valuesToUpdate } of item.optionUpdates) {
        await updateOption(admin, item.product.id, option, targetName, valuesToUpdate);
      }
      completed += 1;
      if (completed % 50 === 0 || completed === workItems.length) {
        console.log(`localized products updated: ${completed}/${workItems.length}`);
      }
    }
  }

  console.log(`applying localization workItems=${workItems.length} concurrency=${workerCount}`);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

console.log("summary", {
  matchedProducts: products.length,
  productUpdates,
  optionNameUpdates,
  optionValueUpdates,
  skippedOptionValueUpdates,
  categoryCounts: Object.fromEntries([...categoryCounts.entries()].sort()),
});

await db.$disconnect();
