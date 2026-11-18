/** Shared Polaris modal wrapper for the selected editor and Methods UI. */
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
export default function MethodDialog({
  heading,
  children,
  actions,
  onClose,
  onBack,
  cancelLabel,
  padding = 'base',
  size = 'small-100',
}: {
  heading: string;
  children: ComponentChildren;
  actions: ComponentChildren;
  onClose(): void;
  onBack?: () => void;
  cancelLabel?: string;
  padding?: 'base' | 'none';
  size?: HTMLElementTagNameMap['s-modal']['size'];
}) {
  const { t } = useAdminLocale();
  const id = useRef('');
  if (!id.current) id.current = `insignia-method-dialog-${crypto.randomUUID()}`;
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const active = useRef(true);
  const opening = useRef(false);
  const dismissalRequested = useRef(false);
  const closed = useRef(false);
  function closeOnce() {
    if (!active.current || closed.current) return;
    closed.current = true;
    onClose();
  }
  function show() {
    if (opening.current || dismissalRequested.current || closed.current) return;
    opening.current = true;
    modal.current?.showOverlay();
  }
  const previousFocus = useRef(document.activeElement);
  useLayoutEffect(() => {
    show();
  }, []);
  useLayoutEffect(() => {
    const element = modal.current;
    return () => {
      active.current = false;
      // An owner that closes the dialog in the same transition (e.g. apply) unmounts it while open.
      // App Bridge finds the host modal by element ID, so hide it while the element is still in the
      // document; s-modal's own disconnected-callback hide arrives too late and leaves the backdrop.
      element?.hideOverlay();
      requestAnimationFrame(() => {
        const target = previousFocus.current;
        if (
          target instanceof HTMLElement &&
          target.isConnected &&
          !target.closest('[inert], [hidden], [aria-hidden="true"]')
        )
          target.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <s-modal
      id={id.current}
      data-method-dialog
      ref={modal}
      heading={heading}
      size={size}
      padding={padding}
      onShow={() => {
        opening.current = false;
      }}
      onHide={() => {
        if (active.current) dismissalRequested.current = true;
      }}
      onAfterShow={() => {
        opening.current = false;
        // hideOverlay is a no-op while Polaris awaits the host show promise.
        // Retain the owner until that show finishes, then retire both surfaces.
        if (dismissalRequested.current || !active.current) {
          modal.current?.hideOverlay();
          closeOnce();
          return;
        }
        if (matchMedia('(min-width: 768px) and (pointer: fine)').matches)
          modal.current?.querySelector<HTMLElement>('input[type=search],s-search-field,s-text-field')?.focus();
      }}
      onAfterHide={() => {
        if (active.current && !opening.current) closeOnce();
      }}
    >
      {children}
      {actions}
      {onBack && (
        <s-button
          slot="secondary-actions"
          variant="secondary"
          icon="arrow-left"
          accessibilityLabel={t('methods:picker.backToMethods')}
          onClick={onBack}
        >
          {t('methods:picker.backToMethods')}
        </s-button>
      )}
      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={() => {
          const element = modal.current;
          dismissalRequested.current = true;
          if (element) element.hideOverlay();
          else closeOnce();
        }}
      >
        {cancelLabel ?? t('common:actions.cancel')}
      </s-button>
    </s-modal>
  );
}
