import { useLayoutEffect, useId, useRef } from 'preact/hooks';
import { useLocale } from './customer-locale';
import './design-switch.css';

/** The selected discard decision, without the developer's Shopify stand-in. */
export function DesignerDesignSwitch({ onCancel, onConfirm }: { onCancel(): void; onConfirm(): void }) {
  const { t } = useLocale();
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="host-preview-switch" aria-labelledby={title} onCancel={onCancel}>
      <h2 id={title}>{t('customer:host.discardTitle')}</h2>
      <p>{t('customer:host.discardHelp')}</p>
      <div>
        <button className="secondary-button" onClick={onCancel}>
          {t('customer:host.cancel')}
        </button>
        <button className="primary-button" onClick={onConfirm}>
          {t('customer:host.discardEdit')}
        </button>
      </div>
    </dialog>
  );
}
