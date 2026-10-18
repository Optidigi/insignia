import { createElement } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

type Bridge = {
  saveBar?: { show(id: string): Promise<void>; hide(id: string): Promise<void>; leaveConfirmation?(): Promise<void> };
};
const barId = 'product-draft-save-bar';

/** App Bridge requires button declarations; Shopify renders these in the host save bar. */
export default function AdminSaveBar({
  dirty,
  saving,
  canSave,
  canDiscard,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  canDiscard: boolean;
  onSave(): void;
  onDiscard(): void;
}) {
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const destination = useRef<string | null>(null);
  const leaving = useRef(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const bridge = (window as unknown as { shopify?: Bridge }).shopify?.saveBar;
    void (dirty ? bridge?.show(barId) : bridge?.hide(barId))?.catch(() => {});
    return () => {
      void bridge?.hide(barId).catch(() => {});
    };
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) {
        event.preventDefault();
      }
    };
    const navigate = async (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event
        .composedPath()
        .find((node) => node instanceof Element && node.matches('s-link[href],s-button[href],s-clickable[href]')) as
        | Element
        | undefined;
      if (!link || link.getAttribute('target') === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.getAttribute('href') ?? '', location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search)
        return;
      event.preventDefault();
      // Unknown writes must be reconciled; a navigation/discard dialog cannot clear them.
      if (!canDiscard || saving) return;
      const bridge = (window as unknown as { shopify?: Bridge }).shopify?.saveBar;
      if (bridge?.leaveConfirmation) {
        try {
          await bridge.leaveConfirmation();
          leaving.current = true;
          location.assign(url.href);
        } catch {
          /* Keep editing. */
        }
      } else {
        destination.current = url.href;
        void showConfirmation();
      }
    };
    document.addEventListener('click', navigate, true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('click', navigate, true);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, saving, canDiscard]);
  async function showConfirmation() {
    await customElements.whenDefined('s-modal');
    setConfirming(true);
    modal.current?.showOverlay();
  }
  function ask() {
    destination.current = null;
    void showConfirmation();
  }
  return (
    <>
      {createElement(
        'ui-save-bar',
        { id: barId },
        createElement(
          'button',
          { variant: 'primary', disabled: !canSave, loading: saving ? '' : undefined, onClick: onSave },
          'Save',
        ),
        createElement('button', { disabled: !canDiscard || saving, onClick: ask }, 'Discard'),
      )}
      <s-button disabled={!dirty || !canDiscard || saving} onClick={ask}>
        Discard changes
      </s-button>
      <s-modal
        ref={modal}
        id="discard-product-changes"
        heading="Discard unsaved changes?"
        onAfterHide={() => {
          setConfirming(false);
          destination.current = null;
        }}
      >
        <s-paragraph>
          Your unsaved product changes will be lost. The last saved configuration and published product will stay
          unchanged.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          disabled={!confirming || !canDiscard || saving}
          onClick={() => {
            if (!canDiscard || saving) return;
            const next = destination.current;
            onDiscard();
            modal.current?.hideOverlay();
            if (next) {
              leaving.current = true;
              location.assign(next);
            }
          }}
        >
          Discard
        </s-button>
        <s-button slot="secondary-actions" commandFor="discard-product-changes" command="--hide">
          Keep editing
        </s-button>
      </s-modal>
    </>
  );
}
