import type { ProductConfig } from './config';
import { type PercentPoint, printWidthPercent, resolvePrintCenter } from './position-geometry';

export type View = string;
export type PositionId = string;
export type Method = string;
export type ColorId = string;
export type Position = ProductConfig['positions'][number];

export interface Artwork {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  sample?: boolean;
  /** Presentation leases only; the server remains artwork authority. */
  previewExpiresAt?: string;
  assetExpiresAt?: string;
}

export interface Print {
  id: PositionId;
  artworkId: string | null;
  /** Retained backend identity for this specific deferred placement. */
  deferredIntentId?: string;
  size: number;
  method: Method;
  /** Omitted means the merchant's configured center. */
  position?: PercentPoint | undefined;
}

export const samples: Artwork[] = [
  {
    id: 'north',
    name: 'North outdoor club.svg',
    url: '/club-logo.svg',
    width: 300,
    height: 180,
    sample: true,
  },
  {
    id: 'trail',
    name: 'Take the long way.svg',
    url: '/trail-logo.svg',
    width: 300,
    height: 320,
    sample: true,
  },
];

export type Quantities = Partial<Record<string, number>>;

export function isValidQuantity(quantity: number, maximum: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= maximum;
}

export interface VariantMatrixCell {
  rowId: string;
  columnId: string;
  variantId: string;
  available: boolean;
}

export interface SelectedVariant {
  variantId: string;
  quantity: number;
}

export interface Design {
  id: string;
  options?: { optionId: string; valueId: string }[];
  prints: Print[];
  quantities: Quantities;
  /** Exact Shopify identities, derived from configured cells at commit time. */
  variants?: SelectedVariant[];
}

export const totalQuantity = (quantities: Quantities): number =>
  Object.values(quantities).reduce<number>((sum, quantity) => sum + (quantity ?? 0), 0);

// Config is parsed at the fixture boundary. State belongs to that config and
// resets when scenarios change; width indexes are not portable between configs.
export function createProductModel(config: ProductConfig, formatLocale = config.locale, activeColor?: ColorId) {
  const formatter = new Intl.NumberFormat(formatLocale, {
    style: 'currency',
    currency: config.currency,
  });

  function positionFor(id: PositionId, colorId = activeColor): Position {
    const position = config.positions.find((entry) => entry.id === id);
    if (!position) throw new Error(`Unknown position: ${id}`);
    const override = colorId ? config.positionOverrides?.[colorId]?.[id] : undefined;
    return override ? { ...position, ...override } : position;
  }

  function methodFor(id: Method): ProductConfig['methods'][number] {
    const method = config.methods.find((entry) => entry.id === id);
    if (!method) throw new Error(`Unknown method: ${id}`);
    return method;
  }

  function isCombinationAvailable(positionId: PositionId, sizeIndex: number, methodId: Method): boolean {
    const position = positionFor(positionId);
    if (
      !Number.isInteger(sizeIndex) ||
      position.dimensions[sizeIndex] === undefined ||
      !position.methodIds.includes(methodId)
    )
      return false;
    const prices = position.methodSizePrices?.[methodId];
    return prices === undefined || (prices[sizeIndex] !== null && prices[sizeIndex] !== undefined);
  }

  function printPrice(print: Print): number {
    const position = positionFor(print.id);
    if (!isCombinationAvailable(print.id, print.size, print.method)) {
      throw new Error(`Unavailable print option: ${print.id}/${print.method}/${print.size}`);
    }
    const exactPrice = position.methodSizePrices?.[print.method]?.[print.size];
    if (exactPrice !== undefined && exactPrice !== null) return exactPrice;
    if (exactPrice === null) {
      throw new Error(`Unavailable print option: ${print.id}/${print.method}/${print.size}`);
    }
    const sizePrice = position.sizePrices[print.size];
    if (!Number.isInteger(print.size) || sizePrice === undefined) {
      throw new Error(`Unknown print size: ${print.id}/${print.size}`);
    }
    if (!position.methodIds.includes(print.method)) {
      throw new Error(`Method ${print.method} is unavailable at ${print.id}`);
    }
    return position.price + sizePrice + methodFor(print.method).surcharge;
  }

  function unitPrice(prints: Print[]): number {
    return config.basePrice + prints.reduce((sum, print) => sum + printPrice(print), 0);
  }

  function totalPrice(prints: Print[], quantities: Quantities): number {
    if (!config.variantBasePrices) return unitPrice(prints) * totalQuantity(quantities);
    const decoration = prints.reduce((sum, print) => sum + printPrice(print), 0);
    let total = 0;
    for (const [key, quantity] of Object.entries(quantities)) {
      if (!quantity) continue;
      const cell = config.variantMatrix?.find((cell) => `${cell.rowId}:${cell.columnId}` === key);
      const base = cell ? config.variantBasePrices[cell.variantId] : undefined;
      if (!cell?.available || base === undefined || !isValidQuantity(quantity, config.maxQuantity))
        throw new Error('Invalid priced variant quantity');
      total += (base + decoration) * quantity;
      if (!Number.isSafeInteger(total)) throw new Error('Display amount exceeds safe integer range');
    }
    return total;
  }
  function basePriceRange(quantities?: Quantities): [number, number] {
    if (!config.variantBasePrices) return [config.basePrice, config.basePrice];
    const selected =
      config.variantMatrix?.filter(
        (cell) =>
          cell.available &&
          (!quantities ||
            Object.values(quantities).every((quantity) => !quantity) ||
            (quantities[`${cell.rowId}:${cell.columnId}`] ?? 0) > 0),
      ) ?? [];
    const amounts = selected
      .map((cell) => config.variantBasePrices?.[cell.variantId])
      .filter((amount): amount is number => amount !== undefined);
    return amounts.length ? [Math.min(...amounts), Math.max(...amounts)] : [config.basePrice, config.basePrice];
  }
  function moneyRange(range: [number, number]): string {
    return range[0] === range[1] ? money(range[0]) : `${money(range[0])}–${money(range[1])}`;
  }

  function minimumPrintPrice(positionId: PositionId): number {
    const position = positionFor(positionId);
    const prices = position.dimensions.flatMap((_, size) =>
      position.methodIds.flatMap((method) =>
        isCombinationAvailable(positionId, size, method)
          ? [printPrice({ id: positionId, artworkId: null, size, method })]
          : [],
      ),
    );
    if (!prices.length) throw new Error(`No priced print options configured for ${positionId}`);
    return Math.min(...prices);
  }

  function money(cents: number): string {
    return formatter.format(cents / 100);
  }

  function imageFor(colorId: ColorId, viewId: View): string | undefined {
    return config.colors.find((color) => color.id === colorId)?.images?.[viewId];
  }

  function initialPrint(id: PositionId): Print {
    const position = positionFor(id);
    const size = position.dimensions.findIndex((_, index) =>
      position.methodIds.some((method) => isCombinationAvailable(id, index, method)),
    );
    if (size < 0) throw new Error(`No priced print options configured for ${id}`);
    const method = position.methodIds.find((candidate) => isCombinationAvailable(id, size, candidate));
    if (method === undefined) throw new Error(`No method configured for ${id}`);
    return { id, artworkId: null, size, method };
  }

  function updatePrintOption(print: Print, change: Partial<Pick<Print, 'size' | 'method'>>): Print | null {
    const updated = { ...print, ...change };
    if (isCombinationAvailable(updated.id, updated.size, updated.method)) return updated;
    if (change.method !== undefined && change.size === undefined) {
      const nextSize = positionFor(updated.id).dimensions.findIndex((_, index) =>
        isCombinationAvailable(updated.id, index, updated.method),
      );
      return nextSize < 0 ? null : { ...updated, size: nextSize };
    }
    return null;
  }

  function isSizeAvailable(colorId: ColorId, sizeId: string): boolean {
    const color = config.colors.find((entry) => entry.id === colorId);
    if (config.variantMatrix !== undefined)
      return Boolean(
        color &&
          config.sizes.some((size) => size.id === sizeId) &&
          config.variantMatrix.some((cell) => cell.rowId === colorId && cell.columnId === sizeId && cell.available),
      );
    return Boolean(
      color && config.sizes.some((size) => size.id === sizeId) && color.availableSizeIds?.includes(sizeId),
    );
  }

  function canDeferArtwork(positionId: PositionId): boolean {
    return positionFor(positionId).artworkLater ?? config.artworkLater;
  }

  function canMoveArtwork(positionId: PositionId): boolean {
    return positionFor(positionId).movementArea !== undefined;
  }

  function printCenter(print: Print): PercentPoint {
    return resolvePrintCenter(positionFor(print.id), print);
  }

  function artworkWidthPercent(print: Print): number | null {
    return printWidthPercent(positionFor(print.id), print.size);
  }

  return {
    positionFor,
    methodFor,
    printPrice,
    isCombinationAvailable,
    unitPrice,
    totalPrice,
    basePriceRange,
    moneyRange,
    minimumPrintPrice,
    money,
    imageFor,
    initialPrint,
    updatePrintOption,
    isSizeAvailable,
    canDeferArtwork,
    canMoveArtwork,
    printCenter,
    artworkWidthPercent,
  };
}
