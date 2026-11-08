import { createCustomerTranslator } from '@insignia/ui-localization/customer';

// Modal handoff can briefly have two owners (opening loader, then the frame).
// Restore the theme's exact scroll style only when the last owner closes.
const owners = new Set<HTMLDialogElement>();
let previousOverflow = '';
export function createDesignerModal(input: { locale?: string; title?: string; onCancel(): void; onRetry?(): void }) {
  const { t } = createCustomerTranslator(input.locale ?? 'en');
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', input.title ?? t('customer:startup.loading'));
  dialog.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:0;background:Canvas;color:CanvasText;overflow:hidden;';
  const loading = document.createElement('section');
  loading.style.cssText =
    'box-sizing:border-box;position:absolute;inset:0;display:grid;place-content:center;gap:12px;padding:24px;font:inherit;background:Canvas;color:CanvasText;';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = t('customer:startup.loading');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = t('customer:chrome.closeCustomizer');
  close.onclick = input.onCancel;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.hidden = true;
  retry.textContent = t('customer:startup.retry');
  retry.onclick = () => input.onRetry?.();
  loading.append(message, retry, close);
  dialog.append(loading);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    input.onCancel();
  });
  document.body.append(dialog);
  function show() {
    if (!dialog.isConnected) return false;
    if (!owners.size) previousOverflow = document.documentElement.style.overflow;
    owners.add(dialog);
    document.documentElement.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return true;
  }
  function hide() {
    if (dialog.open) dialog.close();
    const owned = owners.delete(dialog);
    if (owned && !owners.size) {
      document.documentElement.style.overflow = previousOverflow;
      if (focused?.isConnected) focused.focus();
    }
  }
  show();
  close.focus();
  return {
    dialog,
    show,
    hide,
    loaded() {
      loading.hidden = true;
      loading.style.display = 'none';
    },
    failed() {
      message.setAttribute('role', 'alert');
      message.textContent = t('customer:startup.failure');
      retry.hidden = !input.onRetry;
      close.focus();
    },
    destroy() {
      if (!dialog.isConnected) return;
      hide();
      dialog.remove();
    },
  };
}
