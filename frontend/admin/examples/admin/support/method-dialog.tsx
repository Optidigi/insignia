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
  const previousFocus = useRef(document.activeElement);
  useLayoutEffect(() => {
    const element = modal.current;
    element?.toggleAttribute('inert', suspended);
    if (suspended) {
      hideStartedSuspended.current = true;
      element?.hideOverlay();
    } else element?.showOverlay();
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
      onHide={() => {
        if (!hideStartedSuspended.current) hideStartedSuspended.current = suspendedRef.current;
      }}
      onAfterShow={() => {
        if (!suspendedRef.current && matchMedia('(min-width: 768px) and (pointer: fine)').matches)
          modal.current?.querySelector<HTMLElement>('input[type=search],s-search-field,s-text-field')?.focus();
      }}
      onAfterHide={() => {
        const hiddenWhileSuspended = hideStartedSuspended.current;
        hideStartedSuspended.current = false;
        if (!active.current) return;
        if (hiddenWhileSuspended) {
          if (!suspendedRef.current) modal.current?.showOverlay();
          return;
        }
        if (!suspendedRef.current) onClose();
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
          if (element) element.hideOverlay();
          else onClose();
        }}
      >
        {cancelLabel ?? t('common:actions.cancel')}
      </s-button>
    </s-modal>
  );
}
