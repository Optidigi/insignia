import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useLocale } from './customer-locale';
import type { ClosedDesignerProps } from './designer';
import './storefront-host-preview.css';

/** The baseline host decisions, without the developer's fake Shopify page. */
export function DesignerHostActions(props: ClosedDesignerProps & {
  productName: string;
  choices?: readonly { id: string; label: string }[];
  onEditChoice?(id: string): void;
  onClose(): void;
}) {
  const { t } = useLocale();
  const [selected, setSelected] = useState(props.choices?.[0]?.id ?? '');
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (props.switchingDesign && !dialog.current?.open) dialog.current?.showModal();
    else if (!props.switchingDesign) dialog.current?.close();
  }, [props.switchingDesign]);
  const choice = props.choices?.find((item) => item.id === selected) ?? props.choices?.[0];
  return <main className="storefront-host-preview">
    <h1>{props.productName}</h1>
    <button className="primary-button" onClick={props.hasDraft ? props.onResume : props.onStartNew}>{t('customer:host.personalise')}</button>
    <section aria-label={t('customer:chrome.designControls')}>
      {!!props.choices?.length && <>
        <label>{t('customer:host.savedDesigns')}<select aria-label={t('customer:host.savedDesigns')} value={choice?.id ?? ''} onChange={(event) => setSelected(event.currentTarget.value)}>
          {props.choices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <button className="secondary-button" onClick={() => { if (choice) props.onEditChoice?.(choice.id); }}>{t('customer:host.openSaved')}</button>
      </>}
      <button className="secondary-button" onClick={props.onStartNew}>{t('customer:host.startNew')}</button>
      <button className="secondary-button" onClick={props.onClose}>{t('customer:chrome.closeCustomizer')}</button>
    </section>
    <dialog ref={dialog} className="host-preview-switch" aria-labelledby={title} onCancel={props.onCancelSwitch}>
      <h2 id={title}>{t('customer:host.discardTitle')}</h2>
      <p>{t('customer:host.discardHelp')}</p>
      <div><button className="secondary-button" onClick={props.onCancelSwitch}>{t('customer:host.cancel')}</button>
        <button className="primary-button" onClick={props.onConfirmSwitch}>{t('customer:host.discardEdit')}</button></div>
    </dialog>
  </main>;
}
