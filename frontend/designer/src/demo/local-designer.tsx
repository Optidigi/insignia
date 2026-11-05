import { useMemo } from "preact/hooks";
import type { ProductConfig } from "../config";
import { Designer } from "../designer";
import { createProductModel, samples, type Position } from "../model";
import { StorefrontHostPreview } from "../storefront-host-preview";
import { createLocalRuntime } from "./local-runtime";

/** The only composition that knows fixture artwork, preview URLs and the local saved-design store. */
export function LocalDesigner({
  config,
  showExample,
  onLocationChange,
  previewOnly = false,
  locale,
  previewContextLabel,
  previewNotice,
  previewProductImageLabel,
}: {
  config: ProductConfig;
  showExample: boolean;
  onLocationChange: () => void;
  previewOnly?: boolean;
  locale?: string | undefined;
  previewContextLabel?: string;
  previewNotice?: string;
  previewProductImageLabel?: string;
}) {
  const local = useMemo(() => createLocalRuntime(), [config]);
  const initialPrints = useMemo(() => {
    const first = config.positions[0];
    if (!showExample || !first) return [];
    const model = createProductModel(config);
    return [
      first,
      config.positions.find((position) => position.view !== first.view) ??
        config.positions[1],
    ]
      .filter((position): position is Position => position !== undefined)
      .map((position, index) => ({
        ...model.initialPrint(position.id),
        artworkId: samples[index % samples.length]?.id ?? null,
      }));
  }, [config, showExample]);
  function navigate(open: boolean) {
    const url = new URL(window.location.href);
    url.pathname = open ? "/" : "/product";
    url.hash = "";
    if (url.href !== window.location.href) window.history.pushState({}, "", url);
    onLocationChange();
  }
  return (
    <Designer
      config={config}
      ports={local.ports}
      isOpen={window.location.pathname !== "/product"}
      onOpenChange={navigate}
      initialPrints={initialPrints}
      initialArtworks={previewOnly ? [] : samples}
      previewOnly={previewOnly}
      {...(locale !== undefined ? { locale } : {})}
      {...(previewContextLabel !== undefined ? { previewContextLabel } : {})}
      {...(previewNotice !== undefined ? { previewNotice } : {})}
      {...(previewProductImageLabel !== undefined ? { previewProductImageLabel } : {})}
      allowUnload={new URLSearchParams(window.location.search).get("lab") === "1"}
      renderClosed={(props) => (
        <StorefrontHostPreview
          {...props}
          productName={config.productName}
          savedDesigns={local.savedDesigns()}
        />
      )}
    />
  );
}
