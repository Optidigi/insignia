import type { ProductConfig } from "./config";

export interface QuantityCell {
  rowId: string;
  sizeId: string;
  available: boolean;
}
export interface QuantityLayout {
  kind: "single" | "compact" | "grid" | "list";
  cells: QuantityCell[];
}

/** Layout depends on configured structure, never title, stock count or entered quantities. */
export function quantityLayout(config: ProductConfig): QuantityLayout {
  const exact =
    config.variantMatrix === undefined
      ? undefined
      : new Map(config.variantMatrix.map((cell) => [`${cell.rowId}:${cell.columnId}`, cell]));
  const cells = config.colors.flatMap((row) =>
    config.sizes.flatMap((size) => {
      const cell = exact?.get(`${row.id}:${size.id}`);
      if (exact !== undefined)
        return cell ? [{ rowId: row.id, sizeId: size.id, available: cell.available }] : [];
      // Legacy fixtures establish availability, not the existence of unavailable tuples.
      return row.availableSizeIds.includes(size.id) ||
        config.colors.length * config.sizes.length === 1
        ? [{ rowId: row.id, sizeId: size.id, available: row.availableSizeIds.includes(size.id) }]
        : [];
    }),
  );
  const configuredCount =
    exact === undefined ? config.colors.length * config.sizes.length : exact.size;
  const kind =
    configuredCount === 1
      ? "single"
      : configuredCount <= 6 && config.sizes.length <= 3
        ? "compact"
        : config.sizes.some((size) => [...size.label].length > 12)
          ? "list"
          : "grid";
  return { kind, cells };
}
