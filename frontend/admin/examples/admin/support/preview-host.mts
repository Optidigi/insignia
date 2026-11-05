import { createAdminTranslator } from '@insignia/ui-localization/admin';

/** Preview-only host chrome. Never imported by the production application. */
const frame = document.querySelector<HTMLIFrameElement>('iframe');
const title = document.querySelector('s-heading');
const icon = document.querySelector<HTMLElementTagNameMap['s-icon']>('[data-page-icon]');
const actions = document.querySelector('[data-page-actions]');
const breadcrumbs = document.querySelector('[data-page-breadcrumbs]');
let signature = '';
let editorMenuSignature = '';
let pendingNavigation: string | null = null;
let observedDocument: Document | null = null;
let destinationFrame: number | undefined;
const editorControlNames = ['panels', 'undo', 'redo'] as const;
type EditorControlName = (typeof editorControlNames)[number];
type EditorControlSources = Partial<Record<EditorControlName, HTMLElementTagNameMap['s-button']>>;
let editorPanelProxy: HTMLElementTagNameMap['s-button'] | null = null;
let editorPanelWrapper: HTMLElement | null = null;
let editorPanelTooltip: HTMLElement | null = null;
let editorHistoryProxies: Record<'undo' | 'redo', HTMLElementTagNameMap['s-button']> | null = null;
let editorHistoryContainer: HTMLElement | null = null;
let editorHistoryTooltips: Record<'undo' | 'redo', HTMLElement> | null = null;
customElements.whenDefined('s-page').then(() => {
  document.documentElement.dataset.previewReady = 'true';
});
// Shopify supplies this navigation in the actual host. This proxy is local-only.
const navigation = document.querySelector('[data-preview-navigation]');
function hostTransition(active: boolean) {
  for (const control of [actions, breadcrumbs, document.querySelector('.preview-mobile-actions')]) {
    if (control instanceof HTMLElement) control.inert = active;
  }
}
function showDestination(path: string) {
  const context: Record<string, { heading: string; icon: HTMLElementTagNameMap['s-icon']['type'] }> = {
    '/admin/home': { heading: 'Insignia', icon: 'home' },
    '/admin/products': { heading: 'Products', icon: 'product' },
    '/admin/orders': { heading: 'Orders', icon: 'order' },
    '/admin/methods': { heading: 'Methods', icon: 'settings' },
    '/admin/settings': { heading: 'Settings', icon: 'settings' },
    '/admin/settings/translations': { heading: 'Translations', icon: 'settings' },
  };
  const next = context[path];
  if (!next) return;
  pendingNavigation = path;
  hostTransition(true);
  if (destinationFrame !== undefined) window.cancelAnimationFrame(destinationFrame);
  const started = performance.now();
  const present = () => {
    destinationFrame = undefined;
    if (pendingNavigation !== path) return;
    // Keep the current heading with its current body until the iframe commits.
    if (frame?.contentDocument?.location.pathname === path) {
      if (title) title.textContent = next.heading;
      if (icon) icon.type = next.icon;
      actions?.replaceChildren();
      breadcrumbs?.replaceChildren();
      signature = '';
      sync();
    } else if (performance.now() - started < 15000) {
      destinationFrame = window.requestAnimationFrame(present);
    } else {
      pendingNavigation = null;
      hostTransition(false);
    }
  };
  destinationFrame = window.requestAnimationFrame(present);
}
function openDestination(path: string) {
  showDestination(path);
  frame?.contentWindow?.location.assign(path);
}
function navigate(path: string) {
  if (!frame?.contentDocument || !/^\/admin\/[a-z0-9/_-]+$/i.test(path)) return;
  const existing = frame.contentDocument.querySelector<HTMLElement>(`s-app-nav s-link[href="${path}"]`);
  if (existing) {
    const allowed = existing.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
    if (allowed) openDestination(path);
    return;
  }
  // Send the app's real navigation guard a link event, then navigate only if it allows it.
  // Programmatic custom-element clicks do not supply the internal anchor's default action.
  const source = frame.contentDocument.createElement('s-link');
  source.setAttribute('href', path);
  source.hidden = true;
  frame.contentDocument.body.append(source);
  const allowed = source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  source.remove();
  if (allowed) openDestination(path);
}
document.addEventListener('insignia:preview-navigate', (event) => {
  if (event instanceof CustomEvent && typeof event.detail === 'string') navigate(event.detail);
});
navigation?.addEventListener('click', (event) => {
  const link = event
    .composedPath()
    .find((node): node is Element => node instanceof Element && node.matches('s-link[href]'));
  const path = link?.getAttribute('href');
  if (
    !frame ||
    !path ||
    ![
      '/admin/home',
      '/admin/products',
      '/admin/orders',
      '/admin/methods',
      '/admin/settings',
      '/admin/settings/translations',
    ].includes(path)
  )
    return;
  event.preventDefault();
  document
    .getElementById('preview-navigation')
    ?.dispatchEvent(Object.assign(new Event('command'), { command: '--hide' }));
  navigate(path);
});
function sourceActions() {
  return Array.from(
    frame?.contentDocument
      ?.querySelector('s-page')
      ?.querySelectorAll<HTMLElementTagNameMap['s-button']>(
        ':scope > s-button[slot="secondary-actions"], :scope > s-button[slot="primary-action"]',
      ) ?? [],
  ).sort((first, second) => Number(first.slot === 'primary-action') - Number(second.slot === 'primary-action'));
}
function sourceMenu(button: HTMLElementTagNameMap['s-button']) {
  const target = button.commandFor && frame?.contentDocument?.getElementById(button.commandFor);
  return target && target.localName === 's-menu' ? target : null;
}
function menuButtons(button: HTMLElementTagNameMap['s-button']) {
  return Array.from(sourceMenu(button)?.querySelectorAll<HTMLElementTagNameMap['s-button']>(':scope > s-button') ?? []);
}
function copyButton(target: HTMLElementTagNameMap['s-button'], source: HTMLElementTagNameMap['s-button']) {
  target.textContent = source.textContent;
  target.icon = source.icon;
  target.accessibilityLabel = source.accessibilityLabel;
  target.variant = source.variant;
  target.tone = source.tone;
  target.disabled = source.disabled || source.loading;
  target.loading = source.loading;
  target.href = source.href;
  target.target = source.target;
}
function editorControlSources(app: Document): EditorControlSources {
  const container = app.querySelector('[data-preview-editor-chrome]');
  const sources: EditorControlSources = {};
  for (const name of editorControlNames) {
    const source = container?.querySelector<HTMLElementTagNameMap['s-button']>(
      `s-button[data-editor-control="${name}"]`,
    );
    if (source) sources[name] = source;
  }
  return sources;
}
function ensureEditorProxies() {
  if (editorPanelProxy && editorHistoryProxies) return;
  const panelWrapper = document.createElement('span');
  panelWrapper.className = 'preview-editor-panel-toggle';
  panelWrapper.dataset.previewEditorPanelToggle = '';
  panelWrapper.hidden = true;
  const panel = document.createElement('s-button');
  panel.dataset.previewEditorControl = 'panels';
  panel.variant = 'tertiary';
  panel.setAttribute('interestfor', 'preview-editor-panels-tooltip');
  panel.addEventListener('click', (event) => {
    event.preventDefault();
    forwardEditorControl('panels');
  });
  const panelTooltip = document.createElement('s-tooltip');
  panelTooltip.id = 'preview-editor-panels-tooltip';
  panelTooltip.textContent = 'Show views and placements';
  panelWrapper.append(panel);
  if (breadcrumbs) breadcrumbs.after(panelWrapper);
  else document.querySelector('.preview-context')?.prepend(panelWrapper);

  const history = document.createElement('div');
  history.className = 'preview-editor-history';
  history.dataset.previewEditorHistory = '';
  history.setAttribute('role', 'group');
  history.setAttribute('aria-label', 'Edit history');
  history.hidden = true;
  const undo = document.createElement('s-button');
  undo.dataset.previewEditorControl = 'undo';
  undo.variant = 'tertiary';
  undo.addEventListener('click', (event) => {
    event.preventDefault();
    forwardEditorControl('undo');
  });
  const redo = document.createElement('s-button');
  redo.dataset.previewEditorControl = 'redo';
  redo.variant = 'tertiary';
  undo.setAttribute('interestfor', 'preview-editor-undo-tooltip');
  redo.setAttribute('interestfor', 'preview-editor-redo-tooltip');
  redo.addEventListener('click', (event) => {
    event.preventDefault();
    forwardEditorControl('redo');
  });
  const undoTooltip = document.createElement('s-tooltip');
  undoTooltip.id = 'preview-editor-undo-tooltip';
  undoTooltip.textContent = 'Undo';
  const redoTooltip = document.createElement('s-tooltip');
  redoTooltip.id = 'preview-editor-redo-tooltip';
  redoTooltip.textContent = 'Redo';
  history.append(undo, redo);
  // A closed tooltip can occupy a zero-width flex item. Keep overlays outside
  // the button group so showing one cannot add/remove a flex gap.
  const tooltipLayer = document.createElement('div');
  tooltipLayer.className = 'preview-editor-tooltips';
  tooltipLayer.append(panelTooltip, undoTooltip, redoTooltip);
  document.querySelector('header')?.append(tooltipLayer);
  actions?.before(history);
  editorPanelProxy = panel;
  editorPanelWrapper = panelWrapper;
  editorPanelTooltip = panelTooltip;
  editorHistoryProxies = { undo, redo };
  editorHistoryContainer = history;
  editorHistoryTooltips = { undo: undoTooltip, redo: redoTooltip };
}
function forwardEditorControl(name: EditorControlName) {
  const app = frame?.contentDocument;
  if (!app || !/^\/admin\/products\/\d+\/config\/?$/.test(app.location.pathname)) return;
  if (app.querySelector('s-modal[data-method-dialog]')) return;
  const source = editorControlSources(app)[name];
  if (!source || source.disabled || source.loading) return;
  source.click();
}
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLocaleLowerCase();
  const app = frame?.contentDocument;
  if (key === 's' && !event.shiftKey && app?.querySelector('[data-preview-editor-chrome]')) {
    event.preventDefault();
    if (app.querySelector('s-modal[data-method-dialog]')) return;
    const source = app.querySelector<HTMLElementTagNameMap['s-button']>('s-page > s-button[data-editor-save-draft]');
    if (source && !source.disabled && !source.loading) source.click();
    return;
  }
  if (!event.composedPath().some((node) => node instanceof Element && node.matches('[data-preview-editor-control]')))
    return;
  if (key !== 'z' && key !== 'y') return;
  event.preventDefault();
  forwardEditorControl(key === 'y' || event.shiftKey ? 'redo' : 'undo');
});
function syncEditorProxies(isPlacement: boolean, sources: EditorControlSources) {
  ensureEditorProxies();
  if (
    !editorPanelProxy ||
    !editorPanelWrapper ||
    !editorPanelTooltip ||
    !editorHistoryProxies ||
    !editorHistoryContainer ||
    !editorHistoryTooltips
  )
    return;
  const panel = isPlacement ? sources.panels : undefined;
  editorPanelWrapper.hidden = !panel;
  if (panel) {
    editorPanelProxy.icon = panel.icon;
    editorPanelProxy.accessibilityLabel = panel.accessibilityLabel;
    editorPanelTooltip.textContent = panel.accessibilityLabel;
    editorPanelProxy.disabled = panel.disabled || panel.loading;
  } else {
    editorPanelProxy.disabled = true;
  }
  const historySources: Pick<EditorControlSources, 'undo' | 'redo'> = isPlacement
    ? { undo: sources.undo, redo: sources.redo }
    : {};
  const hasHistory = !!historySources.undo && !!historySources.redo;
  editorHistoryContainer.hidden = !hasHistory;
  for (const name of ['undo', 'redo'] as const) {
    const proxy = editorHistoryProxies[name];
    const source = historySources[name];
    if (source) {
      proxy.icon = source.icon;
      proxy.accessibilityLabel = source.accessibilityLabel;
      editorHistoryTooltips[name].textContent = source.accessibilityLabel;
      proxy.disabled = source.disabled || source.loading;
    } else proxy.disabled = true;
  }
  syncMobileEditorHistory(historySources);
}
function hideEditorProxies() {
  editorPanelWrapper?.toggleAttribute('hidden', true);
  editorHistoryContainer?.toggleAttribute('hidden', true);
  syncMobileEditorHistory({});
}
function syncMobileEditorHistory(sources: Pick<EditorControlSources, 'undo' | 'redo'>) {
  for (const name of ['undo', 'redo'] as const) {
    const proxy = document.querySelector<HTMLElementTagNameMap['s-button']>(
      `#preview-mobile-page-menu s-button[data-preview-editor-control="${name}"]`,
    );
    const source = sources[name];
    if (proxy) proxy.disabled = !source || source.disabled || source.loading;
  }
}
function forwardMenuAction(event: MouseEvent, source: HTMLElementTagNameMap['s-button'] | undefined) {
  if (!source) return;
  if (source.href) {
    const target = new URL(source.href, frame?.contentDocument?.location.href ?? location.href);
    if (
      target.origin !== location.origin ||
      !/^\/admin\/[a-z0-9/_-]+$/i.test(target.pathname) ||
      source.target === '_blank' ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    const allowed = source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    if (allowed) frame?.contentWindow?.location.assign(target.href);
    return;
  }
  event.preventDefault();
  source.click();
}
function mobilePageActions(
  buttons: HTMLElementTagNameMap['s-button'][],
  editorHistory: Pick<EditorControlSources, 'undo' | 'redo'>,
  isPlacement: boolean,
) {
  const menu = document.getElementById('preview-mobile-page-menu');
  const trigger = document.querySelector<HTMLElementTagNameMap['s-button']>('[data-mobile-page-trigger]');
  if (!menu || !trigger) return;
  menu.setAttribute('accessibilitylabel', isPlacement ? 'Editor actions' : 'Page actions');
  trigger.accessibilityLabel = isPlacement ? 'Editor actions' : 'Page actions';
  const entries = [
    ...buttons.flatMap((button, index) =>
      button.slot === 'primary-action' || button.hasAttribute('data-preview-keep-visible')
        ? []
        : sourceMenu(button)
          ? menuButtons(button).map((source, itemIndex) => ({ source, index, itemIndex, editorControl: null }))
          : [{ source: button, index, itemIndex: -1, editorControl: null }],
    ),
    ...(['undo', 'redo'] as const).flatMap((name) => {
      const source = editorHistory[name];
      return source ? [{ source, index: -1, itemIndex: -1, editorControl: name }] : [];
    }),
  ];
  // Hide the structural wrapper: the custom button's own display can override [hidden].
  trigger.parentElement?.toggleAttribute('hidden', entries.length === 0);
  menu.replaceChildren(
    ...entries.map(({ source, index, itemIndex, editorControl }) => {
      const option = document.createElement('s-button');
      option.variant = 'auto';
      if (editorControl) {
        option.dataset.previewEditorControl = editorControl;
        copyButton(option, source);
        option.textContent = source.textContent?.trim() || source.accessibilityLabel || '';
        option.variant = 'auto';
        option.disabled = source.disabled || source.loading;
      } else copyButton(option, source);
      option.addEventListener('click', (event) => {
        if (editorControl) {
          event.preventDefault();
          forwardEditorControl(editorControl);
          return;
        }
        const current = sourceActions()[index];
        forwardMenuAction(event, current ? (itemIndex < 0 ? current : menuButtons(current)[itemIndex]) : undefined);
      });
      return option;
    }),
  );
}
// Preview-only stand-in for the embedded app's App Bridge Save Bar.
type PreviewSaveAction = 'discard' | 'save';
function sourceSaveButton(source: Element | null, action: PreviewSaveAction) {
  const buttons = Array.from(source?.querySelectorAll<HTMLElementTagNameMap['s-button']>('s-button') ?? []);
  const primary = buttons.find(
    (button) => button.variant === 'primary' || button.getAttribute('variant') === 'primary',
  );
  return action === 'save' ? primary : buttons.find((button) => button !== primary);
}

function syncPreviewSaveBar(app: Document) {
  const source = app.querySelector<HTMLElement>('[data-preview-save-bar]');
  let bar = document.querySelector<HTMLElement>('[data-preview-host-save-bar]');
  if (!source) {
    const restoreFocus = bar?.contains(document.activeElement);
    document.documentElement.removeAttribute('data-preview-saving');
    bar?.remove();
    if (restoreFocus) {
      if (app.querySelector('[data-preview-editor-chrome]')) {
        const target = window.matchMedia('(max-width: 639px)').matches
          ? document.querySelector<HTMLElement>('[data-mobile-page-trigger]')
          : editorPanelProxy;
        target?.focus({ preventScroll: true });
      } else app.querySelector<HTMLElement>('s-text-field[name="method-name"]')?.focus({ preventScroll: true });
    }
    return;
  }
  if (!bar) {
    bar = document.createElement('section');
    bar.dataset.previewHostSaveBar = '';
    bar.setAttribute('aria-label', source.getAttribute('aria-label') ?? '');
    const status = document.createElement('span');
    status.textContent = source.getAttribute('aria-label') ?? '';
    status.className = 'preview-save-status';
    const desktopActions = document.createElement('div');
    desktopActions.className = 'preview-save-desktop-actions';
    const mobileActions = document.createElement('div');
    mobileActions.className = 'preview-save-mobile-actions';
    const forward = (action: PreviewSaveAction) => {
      const app = frame?.contentDocument;
      if (!app || app.querySelector('s-modal[data-method-dialog]')) return;
      const current = app.querySelector('[data-preview-save-bar]');
      sourceSaveButton(current, action)?.click();
    };
    for (const action of ['discard', 'save'] as const) {
      const label = sourceSaveButton(source, action)?.textContent?.trim() ?? '';
      const button = document.createElement('s-button');
      button.dataset.previewSaveAction = action;
      button.icon = action === 'save' ? 'check' : 'x';
      button.variant = action === 'save' ? 'primary' : 'secondary';
      button.accessibilityLabel = label;
      button.addEventListener('click', () => forward(action));
      mobileActions.append(button);

      const desktopButton = document.createElement('button');
      desktopButton.type = 'button';
      desktopButton.dataset.previewSaveAction = action;
      desktopButton.className = `preview-save-button preview-save-button-${action}`;
      desktopButton.textContent = label;
      desktopButton.addEventListener('click', () => forward(action));
      desktopActions.append(desktopButton);
    }
    bar.append(status, desktopActions, mobileActions);
    document.querySelector('header')?.append(bar);
  }
  bar.setAttribute('aria-label', source.getAttribute('aria-label') ?? '');
  const status = bar.querySelector('.preview-save-status');
  const statusText = source.getAttribute('aria-label') ?? '';
  if (status && status.textContent !== statusText) status.textContent = statusText;
  for (const button of bar.querySelectorAll<HTMLElement>('[data-preview-save-action]')) {
    const sourceButton = sourceSaveButton(source, button.dataset.previewSaveAction === 'save' ? 'save' : 'discard');
    const label = sourceButton?.textContent?.trim() ?? '';
    if (button instanceof HTMLButtonElement) {
      if (button.textContent !== label) button.textContent = label;
    } else (button as HTMLElementTagNameMap['s-button']).accessibilityLabel = label;
    const disabled = sourceButton?.disabled ?? true;
    if (button instanceof HTMLButtonElement) {
      button.disabled = disabled || !!sourceButton?.loading;
    } else if (button.localName === 's-button') {
      const proxy = button as HTMLElementTagNameMap['s-button'];
      proxy.disabled = disabled || !!sourceButton?.loading;
      proxy.loading = !!sourceButton?.loading;
    }
  }
  document.documentElement.dataset.previewSaving = 'true';
}
function sync() {
  const app = frame?.contentDocument;
  if (pendingNavigation && app?.location.pathname !== pendingNavigation) return;
  pendingNavigation = null;
  hostTransition(false);
  const page = app?.querySelector('s-page');
  const mobileTrigger = document.querySelector<HTMLElementTagNameMap['s-button']>('[data-mobile-page-trigger]');
  if (!app || !page || !title || !actions || !icon) {
    document.documentElement.removeAttribute('data-preview-placement');
    if (app) syncPreviewSaveBar(app);
    if (mobileTrigger) mobileTrigger.disabled = true;
    hideEditorProxies();
    return;
  }
  if (mobileTrigger) mobileTrigger.disabled = false;
  const methodDialogOpen = !!app.querySelector('s-modal[data-method-dialog]');
  document.documentElement.toggleAttribute('data-preview-modal-open', methodDialogOpen);
  syncPreviewSaveBar(app);
  const isMethods =
    app.location.pathname.startsWith('/admin/methods') || app.location.pathname === '/admin/settings/methods';
  const catalogControls = document.querySelector<HTMLElement>('[data-method-catalog-controls]');
  catalogControls?.toggleAttribute('hidden', !isMethods);
  const isPlacement = /^\/admin\/products\/\d+\/config\/?$/.test(app.location.pathname);
  const isProducts = app.location.pathname === '/admin/products';
  document.documentElement.toggleAttribute('data-preview-placement', isPlacement);
  const editorSources = editorControlSources(app);
  syncEditorProxies(isPlacement, editorSources);
  document.querySelector('[data-placement-example-controls]')?.toggleAttribute('hidden', !isPlacement && !isProducts);
  const example = document.querySelector<HTMLElementTagNameMap['s-select']>('[data-placement-example]');
  if (example && (isPlacement || isProducts)) {
    try {
      example.value =
        new URLSearchParams(app.location.search).get('__variant_example') ??
        app.defaultView?.sessionStorage.getItem('insignia-placement-example') ??
        'configured';
    } catch {
      /* Optional local preview storage. */
    }
  }
  for (const control of document.querySelectorAll<HTMLElement>('[data-demo-picker],[data-demo-artwork]'))
    control.hidden = isMethods || isPlacement || isProducts;
  const catalog = document.querySelector<HTMLElementTagNameMap['s-select']>('[data-method-catalog]');
  for (const chrome of document.querySelectorAll<HTMLElement>(
    'header,footer[data-demo-controls],#preview-mobile-page-menu',
  ))
    chrome.inert = methodDialogOpen;
  if (catalog) {
    catalog.disabled = methodDialogOpen;
    try {
      catalog.value =
        app.defaultView?.sessionStorage.getItem('insignia-method-catalog') === 'large' ? 'large' : 'small';
    } catch {
      /* Optional local storage may be disabled. */
    }
  }
  for (const control of document.querySelectorAll<
    HTMLElementTagNameMap['s-button'] | HTMLElementTagNameMap['s-select']
  >('[data-demo-reset],[data-demo-order]'))
    control.disabled = methodDialogOpen;

  const buttons = sourceActions();
  const back = page.querySelector<HTMLElementTagNameMap['s-link']>(':scope > s-link[slot="breadcrumb-actions"]');
  const heading = page.heading || app.title.replace(/ · Insignia$/, '');
  const mobileEditorHistory: Pick<EditorControlSources, 'undo' | 'redo'> = isPlacement
    ? { undo: editorSources.undo, redo: editorSources.redo }
    : {};
  const nextEditorMenu = JSON.stringify([isPlacement, !!mobileEditorHistory.undo && !!mobileEditorHistory.redo]);
  const next = JSON.stringify([
    heading,
    app.documentElement.lang,
    back ? [back.textContent, back.href, back.accessibilityLabel] : null,
    buttons.map((button) => [
      button.textContent,
      button.icon,
      button.accessibilityLabel,
      button.disabled,
      button.loading,
      button.variant,
      button.tone,
      button.href,
      button.target,
      button.commandFor,
      menuButtons(button).map((item) => [
        item.textContent,
        item.icon,
        item.tone,
        item.disabled,
        item.loading,
        item.href,
        item.target,
      ]),
    ]),
  ]);
  if (next !== signature) {
    signature = next;
    title.textContent = heading;
    document.documentElement.dataset.previewHasBack = String(!!back);
    mobilePageActions(buttons, mobileEditorHistory, isPlacement);
    editorMenuSignature = nextEditorMenu;
    if (breadcrumbs) {
      breadcrumbs.replaceChildren();
      if (back) {
        const link = document.createElement('s-button');
        link.icon = 'arrow-left';
        link.variant = 'secondary';
        link.accessibilityLabel =
          back.accessibilityLabel ||
          createAdminTranslator(app.documentElement.lang, {
            allowPseudoLocale: app.documentElement.lang === 'en-XA',
          }).t('admin-shell:hostBack', { destination: back.textContent?.trim() || '' });
        link.href = back.href;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          // The iframe can reload without changing the header signature. Resolve
          // the current link so its navigation guard belongs to the current draft.
          const currentBack = frame?.contentDocument?.querySelector<HTMLElementTagNameMap['s-link']>(
            's-page > s-link[slot="breadcrumb-actions"]',
          );
          if (!currentBack) return;
          const allowed = currentBack.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
          );
          if (allowed) frame?.contentWindow?.location.assign(currentBack.href);
        });
        breadcrumbs.append(link);
      }
    }
    icon.type =
      app.location.pathname === '/admin/home'
        ? 'home'
        : app.location.pathname.startsWith('/admin/orders')
          ? 'order'
          : app.location.pathname.startsWith('/admin/products')
            ? 'product'
            : 'settings';
    let proxies = Array.from(actions.querySelectorAll<HTMLElementTagNameMap['s-button']>(':scope > s-button'));
    if (proxies.length !== buttons.length) {
      proxies = buttons.map((_, index) => {
        const proxy = document.createElement('s-button');
        proxy.addEventListener('click', (event) => {
          if (proxy.commandFor || proxy.href) return;
          event.preventDefault();
          const source = sourceActions()[index];
          source?.click();
        });
        return proxy;
      });
      actions.replaceChildren(...proxies);
    }
    buttons.forEach((button, index) => {
      const proxy = proxies[index];
      if (!proxy) return;
      copyButton(proxy, button);
      proxy.toggleAttribute('data-primary-action', button.slot === 'primary-action');
      proxy.toggleAttribute('data-preview-keep-visible', button.hasAttribute('data-preview-keep-visible'));
      const menuId = `preview-page-menu-${index}`;
      const existingMenu = document.getElementById(menuId);
      const source = sourceMenu(button);
      proxy.commandFor = source ? menuId : '';
      if (!source) {
        existingMenu?.remove();
        return;
      }
      // Host menus must anchor to the visible host button. Forward only their actions
      // into the app; forwarding the hidden source trigger anchors at the frame origin.
      const menu = existingMenu ?? document.createElement('s-menu');
      menu.id = menuId;
      menu.setAttribute('accessibilitylabel', source.getAttribute('accessibilitylabel') ?? 'Page actions');
      menu.replaceChildren(
        ...menuButtons(button).map((item, itemIndex) => {
          const option = document.createElement('s-button');
          copyButton(option, item);
          option.addEventListener('click', (event) => {
            const current = sourceActions()[index];
            forwardMenuAction(event, current ? menuButtons(current)[itemIndex] : undefined);
          });
          return option;
        }),
      );
      if (!existingMenu) actions.append(menu);
    });
    document.title = `${heading} · Insignia local preview`;
  }
  if (nextEditorMenu !== editorMenuSignature) {
    mobilePageActions(buttons, mobileEditorHistory, isPlacement);
    editorMenuSignature = nextEditorMenu;
  }
  const url = new URL(app.location.href);
  url.searchParams.delete('__preview_frame');
  if (url.href !== location.href) history.replaceState(null, '', url);
}
// Update the local mobile menu before Polaris opens it, including immediately after an iframe navigation.
document.querySelector('[data-mobile-page-trigger]')?.addEventListener('click', sync, { capture: true });
frame?.addEventListener('load', () => {
  observedDocument?.removeEventListener('insignia:admin-revealed', sync);
  observedDocument = frame.contentDocument;
  observedDocument?.addEventListener('insignia:admin-revealed', sync);
  sync();
});
window.setInterval(sync, 100);
