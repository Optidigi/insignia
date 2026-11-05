import { createElement } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { initialLeaveGuardState, leaveGuardReducer } from '../shared/leave-guard-state.js';

type Bridge = {
  saveBar?: { show(id: string): Promise<void>; hide(id: string): Promise<void>; leaveConfirmation?(): Promise<void> };
};

/** App Bridge requires button declarations; Shopify renders these in the host save bar. */
export default function AdminSaveBar({
  dirty,
  saving,
  canSave,
  canDiscard,
  onSave,
  onDiscard,
  id = 'product-draft-save-bar',
  saveLabel,
  discardDescription,
  showFallback = true,
  manageNavigation = true,
}: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  canDiscard: boolean;
  onSave(): void;
  onDiscard(): void;
  id?: string;
  saveLabel?: string;
  discardDescription?: string;
  showFallback?: boolean;
  manageNavigation?: boolean;
}) {
  const { t } = useAdminLocale();
  const barId = id;
  const modalId = id === 'product-draft-save-bar' ? 'discard-product-changes' : `${id}-discard`;
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const [guard, dispatch] = useReducer(leaveGuardReducer, undefined, initialLeaveGuardState);
  const confirming = guard.phase === 'confirming';
  const leaving = useRef(false);
  const [hostAvailable, setHostAvailable] = useState(false);
  const pending = useRef<number | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const current = useRef({ canDiscard, saving });
  current.current = { canDiscard, saving };
  const allowed = () => current.current.canDiscard && !current.current.saving;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    const bridge = (window as unknown as { shopify?: Bridge }).shopify?.saveBar;
    let active = true;
    setHostAvailable(!!bridge);
    void (dirty ? bridge?.show(barId) : bridge?.hide(barId))?.catch(() => {
      if (active) setHostAvailable(false);
    });
    return () => {
      active = false;
      void bridge?.hide(barId).catch(() => {});
    };
  }, [dirty]);
  function dismiss(request: number) {
    if (pending.current !== request) return;
    pending.current = null;
    dispatch({ type: 'dismissed', request });
  }
  async function confirmDestination(destination: string | null, host = false) {
    if (!allowed() || pending.current !== null) return;
    const request = ++sequence.current;
    pending.current = request;
    dispatch({ type: 'confirmation-requested', request, destination, host, allowed: true });
    try {
      const bridge = (window as unknown as { shopify?: Bridge }).shopify?.saveBar;
      if (host && bridge?.leaveConfirmation) {
        await bridge.leaveConfirmation();
        if (!mounted.current || pending.current !== request) return;
        if (!allowed()) {
          dismiss(request);
          return;
        }
        dispatch({ type: 'confirmed', request, allowed: true });
        pending.current = null;
        leaving.current = true;
        if (destination) location.assign(destination);
      } else {
        await customElements.whenDefined('s-modal');
        if (!mounted.current || pending.current !== request) return;
        if (!allowed()) {
          dismiss(request);
          return;
        }
        dispatch({ type: 'dialog-ready', request });
        modal.current?.showOverlay();
      }
    } catch {
      dismiss(request);
    }
  }
  useEffect(() => {
    if (!dirty || !manageNavigation) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
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
      const bridge = (window as unknown as { shopify?: Bridge }).shopify?.saveBar;
      void confirmDestination(url.href, !!bridge?.leaveConfirmation);
    };
    document.addEventListener('click', navigate, true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('click', navigate, true);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty, manageNavigation]);
  function ask() {
    void confirmDestination(null);
  }

  return (
    <>
      {createElement(
        'ui-save-bar',
        { id: barId },
        createElement(
          'button',
          { variant: 'primary', disabled: !canSave, loading: saving ? '' : undefined, onClick: onSave },
          t('admin-shell:shared.saveBar.save'),
        ),
        createElement(
          'button',
          { disabled: !canDiscard || saving, onClick: ask },
          t('admin-shell:shared.saveBar.discard'),
        ),
      )}
      {!hostAvailable && showFallback && (
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" disabled={!canSave || saving} loading={saving} onClick={onSave}>
            {saveLabel ?? t('admin-shell:shared.saveBar.saveDraft')}
          </s-button>
          <s-button disabled={!dirty || !canDiscard || saving} onClick={ask}>
            {t('admin-shell:shared.saveBar.discardChanges')}
          </s-button>
        </s-stack>
      )}
      <s-modal
        ref={modal}
        id={modalId}
        heading={t('admin-shell:shared.saveBar.heading')}
        onHide={() => {
          if (pending.current !== null) dismiss(pending.current);
        }}
      >
        <s-paragraph>{discardDescription ?? t('admin-shell:shared.saveBar.productDiscardBody')}</s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          disabled={!confirming || !canDiscard || saving}
          onClick={() => {
            if (!allowed() || guard.phase !== 'confirming' || pending.current !== guard.request) return;
            const next = guard.destination;
            pending.current = null;
            dispatch({ type: 'confirmed', request: guard.request, allowed: true });
            onDiscard();
            modal.current?.hideOverlay();
            if (next) {
              leaving.current = true;
              location.assign(next);
            }
          }}
        >
          {t('admin-shell:shared.saveBar.discard')}
        </s-button>
        <s-button slot="secondary-actions" commandFor={modalId} command="--hide">
          {t('admin-shell:shared.saveBar.keepEditing')}
        </s-button>
      </s-modal>
    </>
  );
}
