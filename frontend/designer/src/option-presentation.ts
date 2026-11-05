import type { ProductConfig } from "./config";

export type OptionPresentation = NonNullable<ProductConfig["optionPresentation"]>;

const GENERIC_PRESENTATION: OptionPresentation = {
  rowOption: {
    label: "Option",
    display: "named-choice",
  },
  columnOption: {
    label: "Option",
  },
};

/** Resolve presentation labels while leaving the existing option matrix intact. */
export function resolveOptionPresentation(
  presentation: ProductConfig["optionPresentation"],
): OptionPresentation {
  return presentation ?? GENERIC_PRESENTATION;
}
