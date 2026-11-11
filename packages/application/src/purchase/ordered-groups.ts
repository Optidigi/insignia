/** The parts of a stored purchase binding this mapping reads (structural; owned by the purchase repository). */
export type OrderedGroupsBinding = {
  economics: unknown;
  designPayload: {
    request: {
      groups: readonly {
        group: {
          productId: string;
          configRevisionId: string;
          variants: readonly { variantId: string; quantity: number }[];
        };
      }[];
    };
  } | null;
  lines: readonly { lineIndex: number; productId: string; variantId: string; quantity: number }[];
};
type Binding = OrderedGroupsBinding;
type Variant = { variantId: string; quantity: number };
type EconomicLine = {
  lineIndex: number;
  productId: string;
  configRevisionId: string;
  variantId: string;
  quantity: number;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function economicLines(economics: unknown): EconomicLine[] | null {
  const lines = object(object(economics)?.economics)?.lines;
  if (!Array.isArray(lines)) return null;
  const result: EconomicLine[] = [];
  for (const [index, entry] of lines.entries()) {
    const line = object(entry);
    if (
      !line ||
      line.lineIndex !== index ||
      typeof line.productId !== 'string' ||
      typeof line.configRevisionId !== 'string' ||
      typeof line.variantId !== 'string' ||
      !Number.isSafeInteger(line.quantity) ||
      (line.quantity as number) <= 0
    )
      return null;
    result.push(line as EconomicLine);
  }
  return result;
}

/**
 * Ordered physical quantities per signed design, aligned with `designPayload.request.groups`.
 *
 * Purchase lines are the Shopify order truth. Each line's signed index selects its accepted economics line;
 * economics lines are priced contiguously per design in request order, so each design owns the run of lines
 * whose quantities sum to its accepted quantity. A design with no ordered line yields an empty vector.
 *
 * Returns null when that mapping cannot be verified, so callers keep the accepted vectors and the existing
 * line/design completeness check still blocks production output.
 */
export function orderedGroupVariants(binding: Binding): Variant[][] | null {
  const groups = binding.designPayload?.request.groups.map(({ group }) => group);
  const economics = economicLines(binding.economics);
  if (!groups?.length || !economics?.length || !binding.lines.length) return null;
  const owner: number[] = [];
  for (const [index, group] of groups.entries()) {
    // Stored payloads are historical JSON; an unexpected shape is an unverifiable mapping, never a throw.
    if (
      !Array.isArray(group?.variants) ||
      group.variants.some((variant) => !Number.isSafeInteger(variant?.quantity) || variant.quantity <= 0)
    )
      return null;
    let remaining = group.variants.reduce((sum, variant) => sum + variant.quantity, 0);
    while (remaining > 0) {
      const line = economics[owner.length];
      if (
        !line ||
        line.productId !== group.productId ||
        line.configRevisionId !== group.configRevisionId ||
        !group.variants.some((variant) => variant.variantId === line.variantId) ||
        line.quantity > remaining
      )
        return null;
      remaining -= line.quantity;
      owner.push(index);
    }
  }
  if (owner.length !== economics.length) return null;
  const ordered = groups.map(() => new Map<string, number>());
  for (const line of binding.lines) {
    const economic = economics[line.lineIndex];
    const quantities = ordered[owner[line.lineIndex] ?? -1];
    if (!economic || !quantities || economic.productId !== line.productId || economic.variantId !== line.variantId)
      return null;
    quantities.set(line.variantId, (quantities.get(line.variantId) ?? 0) + line.quantity);
  }
  return groups.map((group, index) =>
    group.variants.flatMap(({ variantId }) => {
      const quantity = ordered[index]?.get(variantId);
      return quantity ? [{ variantId, quantity }] : [];
    }),
  );
}

/**
 * Whether each signed design (aligned with `designPayload.request.groups`, signed indices kept) has at least
 * one ordered line. Designs that were not ordered need no artwork and are not production work. When the mapping
 * cannot be verified every design counts as ordered, so readiness stays conservative. Whole-quote v2 orders
 * always contain every design.
 */
export function orderedGroups(binding: Binding): boolean[] {
  const groups = binding.designPayload?.request.groups ?? [];
  const ordered = orderedGroupVariants(binding);
  return groups.map((_, index) => !ordered || (ordered[index]?.length ?? 0) > 0);
}
