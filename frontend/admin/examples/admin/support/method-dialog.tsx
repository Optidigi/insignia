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
  suspended = false,
  cancelLabel,
  padding = 'base',
  size = 'small-100',
}: {
  heading: string;
  children: ComponentChildren;
  actions: ComponentChildren;
  onClose(): void;
  onBack?: () => void;
  suspended?: boolean;
  cancelLabel?: string;
  padding?: 'base' | 'none';
  size?: HTMLElementTagNameMap['s-modal']['size'];
}) {
  const { t } = useAdminLocale();
  const id = useRef('');
  if (!id.current) id.current = `insignia-method-dialog-${crypto.randomUUID()}`;
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const active = useRef(true);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const hideStartedSuspended = useRef(false);
  const opening = useRef(false);
  const shown = useRef(false);
  const dismissalRequested = useRef(false);
  const closed = useRef(false);
  function closeOnce() {
    if (!active.current || closed.current || suspendedRef.current) return;
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
    const element = modal.current;
    element?.toggleAttribute('inert', suspended);
    if (suspended) {
      if (!opening.current && shown.current) {
        hideStartedSuspended.current = true;
        element?.hideOverlay();
      }
    } else if (dismissalRequested.current && !opening.current) closeOnce();
    else if (!hideStartedSuspended.current) show();
  }, [suspended]);
  useLayoutEffect(() => {
    return () => {
      active.current = false;
      // Polaris hides the Shopify overlay from s-modal's disconnected callback.
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
      aria-hidden={suspended ? 'true' : undefined}
      onShow={() => {
        shown.current = true;
        opening.current = false;
      }}
      onHide={() => {
        if (!active.current) return;
        if (!hideStartedSuspended.current) hideStartedSuspended.current = suspendedRef.current;
        if (!hideStartedSuspended.current) dismissalRequested.current = true;
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
        if (suspendedRef.current) {
          hideStartedSuspended.current = true;
          modal.current?.hideOverlay();
          return;
        }
        if (!suspendedRef.current && matchMedia('(min-width: 768px) and (pointer: fine)').matches)
          modal.current?.querySelector<HTMLElement>('input[type=search],s-search-field,s-text-field')?.focus();
      }}
      onAfterHide={() => {
        shown.current = false;
        const hiddenWhileSuspended = hideStartedSuspended.current;
        hideStartedSuspended.current = false;
        if (!active.current) return;
        if (hiddenWhileSuspended) {
          if (!suspendedRef.current) show();
          return;
        }
        if (!suspendedRef.current && !opening.current) closeOnce();
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
