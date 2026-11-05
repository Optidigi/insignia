import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);
const catalogRoot = new URL("../../localization/src/catalogs/en/", import.meta.url);
const sourceFiles = [
  "admin-preview.tsx",
  "color-picker.tsx",
  "compact-fields.tsx",
  "customer-locale.ts",
  "designer.tsx",
  "file-name.tsx",
  "garment-preview.tsx",
  "inline-positioning.tsx",
  "language-picker.tsx",
  "use-customer-language.ts",
  "customer-language-policy.ts",
  "position-picker.tsx",
  "quantity-entry.tsx",
  "review-panel.tsx",
  "theme.tsx",
  "validation-summary.tsx",
];

function flatten(value: Record<string, unknown>, prefix = "", result = new Set<string>()) {
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) flatten(item as Record<string, unknown>, path, result);
    else result.add(path);
  }
  return result;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

async function sources() {
  return Promise.all(sourceFiles.map(async (name) => ({
    name,
    text: await readFile(new URL(name, sourceRoot), "utf8"),
  })));
}

test("customer and admin preview message calls resolve in their audience catalogs", async () => {
  const [customer, admin] = await Promise.all([
    readFile(new URL("customer.json", catalogRoot), "utf8").then(JSON.parse),
    readFile(new URL("admin-preview.json", catalogRoot), "utf8").then(JSON.parse),
  ]);
  const catalogKeys = new Map([
    ["customer", flatten(customer)],
    ["admin-preview", flatten(admin)],
  ]);
  const missing = [];
  const fileContents = await sources();
  for (const file of fileContents) {
    const matches = file.text.matchAll(/\bt\(\s*["'`]((?:customer|admin-preview):[A-Za-z0-9._]+)["'`]/g);
    for (const match of matches) {
      const fullKey = match[1];
      const separator = fullKey.indexOf(":");
      const namespace = fullKey.slice(0, separator);
      const key = fullKey.slice(separator + 1);
      const keys = catalogKeys.get(namespace);
      if (!keys?.has(key) && !(keys?.has(`${key}_one`) && keys?.has(`${key}_other`))) {
        missing.push(`${file.name}: ${fullKey}`);
      }
    }
  }
  assert.deepEqual(missing, [], `message calls missing from their English catalog:\n${missing.join("\n")}`);
});

test("hidden customer messages are catalog-backed and no customer UI literals remain", async () => {
  const customer = JSON.parse(await readFile(new URL("customer.json", catalogRoot), "utf8"));
  const catalogKeys = flatten(customer);
  const fileContents = await sources();
  const requiredHidden = [
    "chrome.productPreview",
    "steps.designSteps",
    "artwork.uploadArtworkFile",
    "artwork.fileRequirements",
    "artwork.closeDialog",
    "artwork.optionsAvailable",
    "quantities.fieldLabel",
    "quantities.unavailableForSelection",
    "options.mobileOptionSummary",
    "placements.positions",
    "positioning.dragAndArrowInstructions",
    "positioning.positionUpdated",
    "recovery.dismissNotification",
    "theme.darkMode",
  ];
  for (const key of requiredHidden) {
    assert.ok(catalogKeys.has(key), `English catalog should include hidden customer message ${key}`);
  }

  const allSource = fileContents.map(({ text }) => text).join("\n");
  const missingHidden = requiredHidden.filter((key) => !allSource.includes(`customer:${key}`));
  assert.deepEqual(missingHidden, [], `hidden customer messages are not referenced by UI code: ${missingHidden.join(", ")}`);

  const literalCopy: string[] = [];
  for (const file of fileContents) {
    const source = ts.createSourceFile(file.name, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    walk(source, (node) => {
      if (ts.isJsxText(node) && /[A-Za-z]{2,}/.test(node.text.trim())) {
        literalCopy.push(`${file.name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.text.trim()}`);
      }
      if (!ts.isJsxAttribute(node) || !["aria-label", "title", "alt", "placeholder"].includes(node.name.getText(source))) return;
      if (node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]{2,}/.test(node.initializer.text)) {
        literalCopy.push(`${file.name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.name.getText(source)}=${JSON.stringify(node.initializer.text)}`);
      }
    });
  }
  assert.deepEqual(literalCopy, [], `customer UI text should use catalog messages while merchant/file values stay dynamic:\n${literalCopy.join("\n")}`);
});
