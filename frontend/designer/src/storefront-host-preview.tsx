import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Design } from "./model";
import { ThemeControl } from "./theme";
import "./storefront-host-preview.css";
import "./design-switch.css";

/** Developer harness only. Shopify renders the real product page and cart. */
export interface StorefrontHostPreviewProps {
  productName: string;
  savedDesigns: readonly Design[];
  completion: { operation: "added" | "updated"; designId: string } | null;
  hasDraft: boolean;
  editing: string | null;
  switchingDesign: string | null;
  onResume: () => void;
  onStartNew: () => void;
  onEdit: (design: Design) => void;
  onCancelSwitch: () => void;
  onConfirmSwitch: () => void;
}

/** Never embedded in a merchant's theme or presented as an Insignia cart. */
export function StorefrontHostPreview(props: StorefrontHostPreviewProps) {
  const [selectedId, setSelectedId] = useState(
    props.editing ?? props.savedDesigns[0]?.id ?? "",
  );
  const selected =
    props.savedDesigns.find((design) => design.id === selectedId) ??
    props.savedDesigns[0];
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    if (props.switchingDesign) dialog.current?.showModal();
    else dialog.current?.close();
  }, [props.switchingDesign]);
  useEffect(() => {
    document.getElementById("host-personalise")?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="storefront-host-preview">
      <header>
        <span>Development preview</span>
        <ThemeControl />
      </header>
      <h1>Shopify host preview</h1>
      <p>
        The Insignia customizer is closed. In a connected store, the customer is
        back on Shopify’s product page or cart.
      </p>
      <p>This local preview does not change a Shopify cart.</p>
      {props.completion && (
        <p role="status" className="host-preview-result">
          {props.completion.operation === "added"
            ? "Added to cart"
            : "Cart updated"}{" "}
          <span>— simulated host result</span>
        </p>
      )}
      <button
        id="host-personalise"
        className="primary-button"
        onClick={props.hasDraft ? props.onResume : props.onStartNew}
      >
        Personalise
      </button>
      {props.hasDraft && (
        <small>The unfinished preview design will resume.</small>
      )}
      <section aria-label="Developer preview controls">
        <h2>Preview controls</h2>
        <p>{props.productName}</p>
        {props.savedDesigns.length > 0 && (
          <>
            <label>
              Saved design preview
              <select
                aria-label="Saved design preview"
                value={selected?.id ?? ""}
                onChange={(event) => setSelectedId(event.currentTarget.value)}
              >
                {props.savedDesigns.map((design, index) => (
                  <option value={design.id} key={design.id}>
                    Design {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              onClick={() => selected && props.onEdit(selected)}
            >
              Open saved design
            </button>
          </>
        )}
        <button className="secondary-button" onClick={props.onStartNew}>
          Start a new design
        </button>
      </section>
      <dialog
        ref={dialog}
        className="host-preview-switch"
        aria-labelledby={title}
        onCancel={props.onCancelSwitch}
      >
        <h2 id={title}>Discard changes?</h2>
        <p>
          Discard your changes to edit another design. Items already in your
          cart won’t change.
        </p>
        <div>
          <button className="secondary-button" onClick={props.onCancelSwitch}>
            Cancel
          </button>
          <button className="primary-button" onClick={props.onConfirmSwitch}>
            Discard and edit
          </button>
        </div>
      </dialog>
    </main>
  );
}
