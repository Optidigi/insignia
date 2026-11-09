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
  initiallyHidden?: boolean;
  title?: string;
  wording?: MerchantCustomerWordingView;
  onCancel(): void;
  onRetry?(): void;
}) {
  const locale =
    readCustomerLanguagePreference() ?? resolveCustomerHostLocale(input.locale, customerBrowserLanguages());
  const { t } = createCustomerTranslator(locale, { wordingOverlay: input.wording?.overlays[locale] ?? null });
  let focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let cancel = input.onCancel;
  let settled: (() => void) | undefined;
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
  style.textContent = `${theme.replaceAll(/:root(\[data-theme="(?:light|dark)"\])/g, ':host($1)').replaceAll(':root', ':host')}\n${primitives.replaceAll(':root', ':host')}\n:host{position:absolute;inset:0;display:block;font-family:"Inter Variable",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}[hidden]{display:none!important}h1,p{margin:0}.admin-preview-message{height:calc(100% - 72px);min-height:0;overflow:auto}.designer-loading-header{height:72px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:var(--surface)}.designer-loading-header h1{font-size:16px;line-height:1.3}.designer-loading-state{height:calc(100% - 72px);display:grid;place-items:center;background:var(--surface-preview);color:var(--text)}.designer-loading-state section{display:grid;gap:16px;justify-items:center}.designer-loading-state [role=status]{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--muted)}.designer-loading-state [role=status]::before{content:'';width:18px;height:18px;border:2px solid var(--line);border-right-color:var(--accent);border-radius:50%;animation:insignia-pending-spin .7s linear infinite}@keyframes insignia-pending-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.designer-loading-state [role=status]::before{animation:none}}`;
  const main = document.createElement('main');
  main.className = 'designer-loading-state';
  const panel = document.createElement('section');
  main.append(panel);
  shadow.append(style);
  const header = document.createElement('header');
  header.className = 'designer-loading-header';
  const heading = document.createElement('h1');
  heading.textContent = input.title ?? t('customer:startup.loading');
  header.append(heading);
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  message.textContent = t('customer:startup.loading');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'secondary-button';
  close.textContent = t('customer:chrome.closeCustomizer');
  close.onclick = () => cancel();
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'primary-button';
  retry.hidden = true;
  retry.textContent = t('customer:startup.retry');
  retry.onclick = () => input.onRetry?.();
  header.append(close);
  panel.append(message, retry);
  shadow.append(header, main);
  dialog.append(loading);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancel();
  });
  if (input.initiallyHidden) {
    dialog.style.display = 'block';
    dialog.style.visibility = 'hidden';
    dialog.style.opacity = '0';
    dialog.style.pointerEvents = 'none';
    dialog.inert = true;
  }
  document.body.append(dialog);
  function show() {
    if (!dialog.isConnected) return false;
    if (!dialog.open) focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.style.removeProperty('display');
    dialog.style.removeProperty('visibility');
    dialog.style.removeProperty('opacity');
    dialog.style.removeProperty('pointer-events');
    dialog.inert = false;
    if (!owners.size) previousOverflow = document.documentElement.style.overflow;
    owners.add(dialog);
    document.documentElement.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    return true;
  }
  function hide() {
    settled?.();
    if (dialog.open) dialog.close();
    const owned = owners.delete(dialog);
    if (owned && !owners.size) {
      document.documentElement.style.overflow = previousOverflow;
      if (focused?.isConnected) focused.focus();
    }
  }
  if (!input.initiallyHidden) {
    show();
    close.focus();
  }
  return {
    dialog,
    setCancelHandler(handler: () => void) {
      cancel = handler;
    },
    onSettled(handler: () => void) {
      settled = handler;
    },
    setTitle(title: string) {
      heading.textContent = title;
      dialog.setAttribute('aria-label', title);
    },
    show,
    hide,
    loaded() {
      settled?.();
      loading.hidden = true;
      loading.style.display = 'none';
    },
    failed() {
      settled?.();
      main.className = 'admin-preview-message';
      message.setAttribute('role', 'alert');
      message.textContent = t('customer:startup.failure');
      retry.hidden = !input.onRetry;
      if (dialog.open) close.focus();
    },
    destroy() {
      if (!dialog.isConnected) return;
      hide();
      dialog.remove();
    },
  };
}
