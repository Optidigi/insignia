import type { MerchantCustomerWordingView } from '@insignia/contracts';
import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import {
  customerBrowserLanguages,
  resolveCustomerHostLocale,
} from '../../../../frontend/designer/src/customer-language-policy.ts';
import { readCustomerLanguagePreference } from '../../../../frontend/designer/src/customer-language-preference.ts';
import primitives from '../../../../frontend/designer/src/primitives.css?inline';
import theme from '../../../../frontend/designer/src/theme.css?inline';
import { readThemePreference, resolveThemePreference } from '../../../../frontend/designer/src/theme-preference.ts';

// Modal handoff can briefly have two owners (opening loader, then the frame).
// Restore the theme's exact scroll style only when the last owner closes.
const owners = new Set<HTMLDialogElement>();
let previousOverflow = '';
export function createDesignerModal(input: {
  locale?: string;
  title?: string;
  wording?: MerchantCustomerWordingView;
  onCancel(): void;
  onRetry?(): void;
}) {
  const locale =
    readCustomerLanguagePreference() ?? resolveCustomerHostLocale(input.locale, customerBrowserLanguages());
  const { t } = createCustomerTranslator(locale, { wordingOverlay: input.wording?.overlays[locale] ?? null });
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', input.title ?? t('customer:startup.loading'));
  dialog.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;padding:0;background:Canvas;color:CanvasText;overflow:hidden;';
  const loading = document.createElement('div');
  loading.dataset.theme = resolveThemePreference(
    readThemePreference(),
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const shadow = loading.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${theme.replaceAll(/:root(\[data-theme="(?:light|dark)"\])/g, ':host($1)').replaceAll(':root', ':host')}\n${primitives.replaceAll(':root', ':host')}\n:host{position:absolute;inset:0;display:block;font-family:"Inter Variable",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}[hidden]{display:none!important}h1,p{margin:0}.admin-preview-message{height:100%;overflow:auto}`;
  const main = document.createElement('main');
  main.className = 'admin-preview-message';
  const panel = document.createElement('section');
  main.append(panel);
  shadow.append(style, main);
  const message = document.createElement('h1');
  message.setAttribute('role', 'status');
  message.textContent = t('customer:startup.loading');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'secondary-button';
  close.textContent = t('customer:chrome.closeCustomizer');
  close.onclick = input.onCancel;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'primary-button';
  retry.hidden = true;
  retry.textContent = t('customer:startup.retry');
  retry.onclick = () => input.onRetry?.();
  panel.append(message, retry, close);
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
