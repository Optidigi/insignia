import { z } from "zod";
import type { VariantMatrixCell } from "./model";

// Keep Shopify IDs as strings. Converting them to numbers can lose identity.
const shopifyOptionsSchema = z.object({
  variants: z.array(z.object({
    id: z.string().min(1),
    label: z.string(),
    available: z.boolean(),
    selectedOptions: z.array(z.object({
      name: z.string().refine((value) => value.trim().length > 0),
      value: z.string().refine((value) => value.trim().length > 0),
      swatch: z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).nullish().catch(undefined),
    })).nullable(),
  })),
});

export type UnsupportedVariantReason =
  | "invalid-input"
  | "no-variants"
  | "unknown-options"
  | "too-many-options"
  | "invalid-variant-id"
  | "duplicate-variant-id"
  | "duplicate-option-name"
  | "inconsistent-option-names"
  | "duplicate-option-tuple";

export interface ShopifyVariantMatrix {
  status: "ready";
  colors: {
    id: string;
    name: string;
    hex?: string;
    nameSource?: "generic-selection";
    availableSizeIds: string[];
  }[];
  sizes: { id: string; label: string }[];
  variantMatrix: VariantMatrixCell[];
  optionNames: string[];
  rowOptionNames: string[];
  columnOptionName: string;
  optionPresentation: {
    rowOption: {
      label: string;
      display: "swatch" | "named-choice";
      labelSource?: "generic-selection";
    };
    columnOption: { label: string };
  };
}

export type ShopifyVariantMatrixResult =
  | ShopifyVariantMatrix
  | { status: "unsupported"; reason: UnsupportedVariantReason };

function unsupported(reason: UnsupportedVariantReason): ShopifyVariantMatrixResult {
  return { status: "unsupported", reason };
}

// Reversible encoding avoids collisions, colons in quantity keys and title parsing.
// UTF-16 code units also preserve unusual Unicode strings without normalization.
function tupleId(prefix: string, tuple: readonly (readonly string[])[]): string {
  const serialized = JSON.stringify(tuple);
  let encoded = "";
  for (let index = 0; index < serialized.length; index += 1)
    encoded += serialized.charCodeAt(index).toString(16).padStart(4, "0");
  return `${prefix}_${encoded}`;
}

/** Projects only actual Shopify option tuples. It never guesses product categories or swatches from names. */
export function buildShopifyVariantMatrix(input: unknown, photoGroupingOptionNames?:readonly string[]): ShopifyVariantMatrixResult {
  const parsed = shopifyOptionsSchema.safeParse(input);
  if (!parsed.success) return unsupported("invalid-input");
  const variants = parsed.data.variants;
  const first = variants[0];
  if (!first) return unsupported("no-variants");
  if (!first.selectedOptions?.length) return unsupported("unknown-options");
  if (first.selectedOptions.length > 3) return unsupported("too-many-options");
  const optionNames = first.selectedOptions.map((option) => option.name);
  const rowOptionNames = photoGroupingOptionNames?.length ? [...photoGroupingOptionNames] : optionNames.slice(0,-1);
  if(photoGroupingOptionNames?.length&&(new Set(rowOptionNames).size!==rowOptionNames.length||rowOptionNames.some(name=>!optionNames.includes(name))))return unsupported('inconsistent-option-names');
  const columnOptionNames=optionNames.filter(name=>!rowOptionNames.includes(name));
  const columnOptionName=columnOptionNames.join(' / ')||'Selection';
  const rows = new Map<string, ShopifyVariantMatrix["colors"][number]>();
  const rowSwatches = new Map<string, string | null>();
  const columns = new Map<string, ShopifyVariantMatrix["sizes"][number]>();
  const variantMatrix: VariantMatrixCell[] = [];
  const ids = new Set<string>();
  const tuples = new Set<string>();
  for (const variant of variants) {
    if (!/^[1-9][0-9]{0,19}$/.test(variant.id))
      return unsupported("invalid-variant-id");
    if (ids.has(variant.id)) return unsupported("duplicate-variant-id");
    ids.add(variant.id);
    if (!variant.selectedOptions?.length) return unsupported("unknown-options");
    if (variant.selectedOptions.length > 3) return unsupported("too-many-options");
    const options = new Map<string, string>();
    for (const option of variant.selectedOptions) {
      if (options.has(option.name)) return unsupported("duplicate-option-name");
      options.set(option.name, option.value);
    }
    if (options.size !== optionNames.length || optionNames.some((name) => !options.has(name)))
      return unsupported("inconsistent-option-names");
    const rowTuple: [string, string][] = [];
    for (const name of rowOptionNames) {
      const value = options.get(name);
      if (value === undefined) return unsupported("inconsistent-option-names");
      rowTuple.push([name, value]);
    }
    const columnTuple:[string,string][]=columnOptionNames.map(name=>[name,options.get(name)!]);
    const columnValue=columnTuple.length===0?'Selection':columnTuple.length===1?columnTuple[0]![1]:columnTuple.map(([name,value])=>`${name}: ${value}`).join(' · ');
    const rowId = tupleId("row", rowTuple);
    const columnId = tupleId("column", columnTuple);
    // A composite row has no single unambiguous swatch. Missing or conflicting
    // facts keep the existing named choices instead of guessing from labels.
    const swatch = rowOptionNames.length === 1
      ? variant.selectedOptions.find(option => option.name === rowOptionNames[0])?.swatch?.color.toUpperCase() ?? null
      : null;
    rowSwatches.set(rowId, rowSwatches.has(rowId) && rowSwatches.get(rowId) !== swatch ? null : swatch);
    const tuple = JSON.stringify([rowId, columnId]);
    if (tuples.has(tuple)) return unsupported("duplicate-option-tuple");
    tuples.add(tuple);
    let row = rows.get(rowId);
    if (!row) {
      const singleOption = rowTuple[0];
      row = {
        id: rowId,
        name: singleOption === undefined ? "Selection" : rowTuple.length === 1
          ? singleOption[1]
          : rowTuple.map(([name, value]) => `${name}: ${value}`).join(" · "),
        ...(singleOption === undefined ? { nameSource: "generic-selection" as const } : {}),
        availableSizeIds: [],
      };
      rows.set(rowId, row);
    }
    if (!columns.has(columnId)) columns.set(columnId, { id: columnId, label: columnValue });
    if (variant.available) row.availableSizeIds.push(columnId);
    variantMatrix.push({ rowId, columnId, variantId: variant.id, available: variant.available });
  }
  const rowLabel = rowOptionNames.length ? rowOptionNames.join(" / ") : "Selection";
  return {
    status: "ready",
    colors: [...rows.values()].map(row => {
      const hex = rowSwatches.get(row.id);
      return hex ? { ...row, hex } : row;
    }),
    sizes: [...columns.values()],
    variantMatrix,
    optionNames,
    rowOptionNames,
    columnOptionName,
    optionPresentation: {
      rowOption: {
        label: rowLabel,
        display: [...rows.keys()].every(id => rowSwatches.get(id)) ? "swatch" : "named-choice",
        ...(rowOptionNames.length ? {} : { labelSource: "generic-selection" as const }),
      },
      columnOption: { label: columnOptionName,},
    },
  };
}
