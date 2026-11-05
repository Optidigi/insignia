import {
  type AdminLocaleController,
  type AdminLocaleSnapshot,
  type AdminMessageKey,
  type AdminTranslationParams,
  createAdminLocaleController,
  createAdminTranslator,
} from '@insignia/ui-localization/admin';
import { parseLanguagePreference, type SupportedLanguage } from '@insignia/ui-localization/core';
import { createPreactLocaleBindings } from '@insignia/ui-localization/preact';
import { type ComponentType, h } from 'preact';
import { useRef } from 'preact/hooks';

const controllerSlot: unique symbol = Symbol.for('insignia.admin.locale.controller.v1');
const installedSlot: unique symbol = Symbol.for('insignia.admin.locale.installed.v1');
const hostLocaleSlot: unique symbol = Symbol.for('insignia.admin.locale.host.v1');
const preferenceSlot: unique symbol = Symbol.for('insignia.admin.locale.preference.v1');
const preferenceStorageSlot: unique symbol = Symbol.for('insignia.admin.locale.preference-storage.v1');
export const ADMIN_LANGUAGE_PREFERENCE_KEY = 'insignia.admin.language.v1';
type PreferenceStorage = 'durable' | 'session';
type LocalizedDocument = Document & {
  [controllerSlot]?: AdminLocaleController;
  [installedSlot]?: boolean;
  [hostLocaleSlot]?: string | null;
  [preferenceSlot]?: SupportedLanguage | null;
  [preferenceStorageSlot]?: PreferenceStorage;
};

const bindings = createPreactLocaleBindings(() => createAdminTranslator());
export const AdminLocaleProvider = bindings.LocaleProvider;
export const useAdminLocale = bindings.useLocale;

function previewExpansion(document: Document): boolean {
  const url = new URL(document.URL);
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.searchParams.get('__i18n') === 'expanded';
}

export function adminHostLocale(document: Document): string | null {
  if (previewExpansion(document)) return 'en-XA';
  const host = document.defaultView as unknown as { shopify?: { config?: { locale?: unknown } } } | null;
  let value: unknown;
  try {
    value = host?.shopify?.config?.locale;
  } catch {
    // A host bootstrap failure must still allow a complete local fallback.
  }
  return typeof value === 'string' && value.length <= 128
    ? value
    : (document.documentElement.dataset.adminRequestedLocale ?? new URL(document.URL).searchParams.get('locale'));
}

/** The host language is a per-document constant even when Insignia uses another language. */
export function originalAdminHostLocale(document: Document): string | null {
  const owner = document as LocalizedDocument;
  if (owner[hostLocaleSlot] === undefined) owner[hostLocaleSlot] = adminHostLocale(document);
  return owner[hostLocaleSlot] ?? null;
}

/** A missing, inaccessible or malformed browser preference means automatic host language. */
export function readAdminLanguagePreference(document: Document): SupportedLanguage | null {
  const owner = document as LocalizedDocument;
  if (owner[preferenceSlot] !== undefined) return owner[preferenceSlot] ?? null;
  try {
    const preference = parseLanguagePreference(
      document.defaultView?.localStorage.getItem(ADMIN_LANGUAGE_PREFERENCE_KEY),
    );
    owner[preferenceSlot] = preference;
    owner[preferenceStorageSlot] = 'durable';
    return preference;
  } catch {
    owner[preferenceStorageSlot] = 'session';
    return null;
  }
}

/** Refresh durable choices on BFCache return while retaining session-only choices when writes were blocked. */
function refreshAdminLanguagePreference(document: Document): SupportedLanguage | null {
  const owner = document as LocalizedDocument;
  if (owner[preferenceStorageSlot] === 'session') return owner[preferenceSlot] ?? null;
  try {
    const preference = parseLanguagePreference(
      document.defaultView?.localStorage.getItem(ADMIN_LANGUAGE_PREFERENCE_KEY),
    );
    owner[preferenceSlot] = preference;
    owner[preferenceStorageSlot] = 'durable';
    return preference;
  } catch {
    owner[preferenceStorageSlot] = 'session';
    return owner[preferenceSlot] ?? null;
  }
}

/** Persistence is best-effort: a blocked browser store must not block this session's language change. */
export function writeAdminLanguagePreference(document: Document, value: SupportedLanguage | null): void {
  const owner = document as LocalizedDocument;
  owner[preferenceSlot] = value;
  try {
    const storage = document.defaultView?.localStorage;
    if (!storage) {
      owner[preferenceStorageSlot] = 'session';
      return;
    }
    if (value === null) storage.removeItem(ADMIN_LANGUAGE_PREFERENCE_KEY);
    else storage.setItem(ADMIN_LANGUAGE_PREFERENCE_KEY, value);
    owner[preferenceStorageSlot] = 'durable';
  } catch {
    owner[preferenceStorageSlot] = 'session';
    // Private browsing and embedded browser policies can disable local storage.
  }
}

/** One browser document, including separately bundled preview roots, owns one controller. */
export function getAdminLocaleController(document: Document): AdminLocaleController {
  const owner = document as LocalizedDocument;
  owner[controllerSlot] ??= createAdminLocaleController(originalAdminHostLocale(document), {
    allowPseudoLocale: previewExpansion(document),
  });
  return owner[controllerSlot];
}

/** SSR callers receive a fresh snapshot; mutable language never crosses requests. */
export function getAdminLocalization(): AdminLocaleSnapshot {
  return typeof document === 'undefined' ? createAdminTranslator() : getAdminLocaleController(document).getSnapshot();
}

export function adminText<Key extends AdminMessageKey>(
  key: Key,
  ...args: [keyof AdminTranslationParams<Key>] extends [never] ? [] : [values: AdminTranslationParams<Key>]
): string {
  return getAdminLocalization().t(key, ...args);
}

/** Stable provider wrapper for each independently hydrated Astro island. */
export function withAdminLocale<Props extends object>(
  Component: ComponentType<Props>,
  options: { neutralWithoutLocale?: boolean } = {},
) {
  return function LocalizedAdminIsland(props: Props & { locale?: string | null }) {
    const retained = useRef<AdminLocaleController>();
    const initial = useRef<AdminLocaleSnapshot>();
    if (!initial.current) {
      const serverSnapshot = createAdminTranslator(props.locale);
      initial.current =
        options.neutralWithoutLocale && serverSnapshot.canonicalRequestedLocale === null
          ? { ...serverSnapshot, t: () => '', message: () => '' }
          : serverSnapshot;
    }
    retained.current ??=
      typeof document === 'undefined' ? createAdminLocaleController(props.locale) : getAdminLocaleController(document);
    return h(
      AdminLocaleProvider,
      { controller: retained.current, initialSnapshot: initial.current },
      h(Component, props),
    );
  };
}

/** Preserve only presentation context on app-owned navigation, never API/signature URLs. */
export function adminLocaleHref(href: string, document: Document, requestedLocale: string | null): string {
  try {
    const url = new URL(href, document.URL);
    if (url.origin !== new URL(document.URL).origin || !url.pathname.startsWith('/admin/')) return href;
    if (!requestedLocale || requestedLocale === 'en') url.searchParams.delete('locale');
    else url.searchParams.set('locale', requestedLocale);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function installAdminLocalization(document: Document): void {
  const owner = document as LocalizedDocument;
  if (owner[installedSlot]) return;
  owner[installedSlot] = true;
  const controller = getAdminLocaleController(document);
  const hostLocale = originalAdminHostLocale(document);
  const syncMetadata = () => {
    const snapshot = controller.getSnapshot();
    document.documentElement.lang = snapshot.lang;
    document.documentElement.dir = snapshot.dir;
    document.documentElement.dataset.adminFormatLocale = snapshot.formatLocale;
    const titles = [
      'home',
      'products',
      'orders',
      'order',
      'methods',
      'configuration',
      'settings',
      'billing',
      'permissions',
      'storefront',
      'unavailable',
    ] as const;
    const titleKey = titles
      .map((name) => `admin-shell:titles.${name}` as const)
      .find((key) => key === document.documentElement.dataset.adminTitleKey);
    if (titleKey) document.title = snapshot.t('admin-shell:pageTitle', { title: snapshot.t(titleKey) });
    const navigationTemplate = document.querySelector<HTMLTemplateElement>('[data-admin-nav-template]');
    const navigationRoot = navigationTemplate?.content ?? document;
    for (const name of ['home', 'products', 'orders', 'methods', 'settings'] as const) {
      const node = navigationRoot.querySelector(`[data-admin-nav="${name}"]`);
      if (node) node.textContent = snapshot.t(`admin-shell:navigation.${name}`);
    }
    // App Bridge can read navigation outside the iframe; CSS hiding alone cannot gate registration.
    if (navigationTemplate) navigationTemplate.replaceWith(navigationTemplate.content);
    document
      .querySelector('[data-admin-failure-heading]')
      ?.setAttribute('heading', snapshot.t('admin-shell:failure.heading'));
    const failureBody = document.querySelector('[data-admin-failure-body]');
    if (failureBody) failureBody.textContent = snapshot.t('admin-shell:failure.body');
    document.getElementById('admin-route-skeleton')?.removeAttribute('aria-hidden');
    for (const [key, selector, attribute] of [
      ['admin-shell:unavailable.heading', '[data-admin-unavailable-page]', 'heading'],
      ['admin-shell:unavailable.bannerHeading', '[data-admin-unavailable-banner]', 'heading'],
      ['admin-shell:unavailable.recoveryHeading', '[data-admin-unavailable-recovery]', 'heading'],
      ['admin-shell:unavailable.body', '[data-admin-unavailable-body]', null],
      ['admin-shell:unavailable.recoveryBody', '[data-admin-unavailable-recovery-body]', null],
      ['admin-shell:unavailable.return', '[data-admin-unavailable-return]', null],
    ] as const) {
      const node = document.querySelector(selector);
      if (node && attribute) node.setAttribute(attribute, snapshot.t(key));
      else if (node) node.textContent = snapshot.t(key);
    }
    document.documentElement.dataset.adminLocaleReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-locale-ready'));
  };
  controller.subscribe(syncMetadata);
  void controller.setLocale(readAdminLanguagePreference(document) ?? hostLocale).then(syncMetadata);
  document.addEventListener(
    'click',
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event
        .composedPath()
        .find(
          (entry): entry is Element =>
            entry instanceof Element && entry.matches('a[href],s-link[href],s-button[href],s-clickable[href]'),
        );
      if (!link || link.hasAttribute('download') || link.getAttribute('target') === '_blank') return;
      const href = link.getAttribute('href');
      if (href) link.setAttribute('href', adminLocaleHref(href, document, hostLocale));
    },
    true,
  );
  document.defaultView?.addEventListener('pageshow', (event) => {
    if (event.persisted)
      void controller.setLocale(refreshAdminLanguagePreference(document) ?? hostLocale).then(syncMetadata);
  });
  document.defaultView?.addEventListener('storage', (event) => {
    if (event.key !== ADMIN_LANGUAGE_PREFERENCE_KEY && event.key !== null) return;
    const owner = document as LocalizedDocument;
    owner[preferenceSlot] = parseLanguagePreference(event.newValue);
    owner[preferenceStorageSlot] = 'durable';
    void controller.setLocale(owner[preferenceSlot] ?? hostLocale).then(syncMetadata);
  });
}
