/** Local-only overlay shared by the Methods exploration. */
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
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const active = useRef(true);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const hideStartedSuspended = useRef(false);
  const previousFocus = useRef(document.activeElement);
  useLayoutEffect(() => {
    const element = modal.current;
    element?.toggleAttribute('inert', suspended);
    if (suspended) element?.hideOverlay();
    else element?.showOverlay();
  }, [suspended]);
  useLayoutEffect(() => {
    const element = modal.current;
    return () => {
      active.current = false;
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
      data-method-dialog
      ref={modal}
      heading={heading}
      size={size}
      padding={padding}
      aria-hidden={suspended ? 'true' : undefined}
      onHide={() => {
        hideStartedSuspended.current = suspendedRef.current;
      }}
      onAfterShow={() => {
        if (!suspendedRef.current && matchMedia('(min-width: 768px) and (pointer: fine)').matches)
          modal.current?.querySelector<HTMLElement>('input[type=search],s-search-field,s-text-field')?.focus();
      }}
      onAfterHide={() => {
        if (active.current && !hideStartedSuspended.current && !suspendedRef.current) onClose();
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
      <s-button slot="secondary-actions" variant="secondary" onClick={onClose}>
        {cancelLabel ?? t('common:actions.cancel')}
      </s-button>
    </s-modal>
  );
}
