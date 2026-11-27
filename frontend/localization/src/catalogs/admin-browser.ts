import { type ResolvedLocale, resolveLocale, type SupportedLanguage } from '../core.js';
import type { TranslationCatalog } from '../internal/fixed-translator.js';
import english from './admin-en.js';

const loadCatalog = {
  de: () => import('./admin-de.js'),
  es: () => import('./admin-es.js'),
  fr: () => import('./admin-fr.js'),
  it: () => import('./admin-it.js'),
  nl: () => import('./admin-nl.js'),
};

const loaded: Partial<Record<SupportedLanguage, TranslationCatalog>> & { en: TranslationCatalog } = { en: english };
export const adminCatalogs: Readonly<typeof loaded> = loaded;

export async function prepareAdminCatalog(language: ResolvedLocale['activeLanguage']): Promise<void> {
  if (language === 'en' || language === 'en-XA' || loaded[language]) return;
  loaded[language] = (await loadCatalog[language]()).default;
}

// Match the server snapshot during island hydration, before applying the browser preference.
const { activeLanguage } = resolveLocale(document.documentElement.dataset.adminRequestedLocale);
await prepareAdminCatalog(activeLanguage).catch(async () => {
  // Wait for streamed islands to arrive before discarding markup in the unavailable language.
  if (document.readyState === 'loading')
    await new Promise<void>((resolve) =>
      document.addEventListener('readystatechange', () => resolve(), { once: true }),
    );
  for (const island of document.querySelectorAll('astro-island[client="polaris"][ssr]')) {
    const slots = [...island.querySelectorAll('astro-slot, template[data-astro-template]')].filter(
      (slot) => slot.closest('astro-island') === island,
    );
    island.replaceChildren(...slots);
  }
});
