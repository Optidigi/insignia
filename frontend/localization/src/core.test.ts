import { describe, expect, it } from 'vitest';
import {
  createLocaleController,
  formatExactCount,
  LANGUAGE_OPTIONS,
  type LocaleSnapshot,
  parseLanguagePreference,
  resolveLocale,
  SUPPORTED_LANGUAGES,
} from './core.js';

describe('locale resolution', () => {
  it('keeps a supported English formatting region while rendering English', () => {
    expect(resolveLocale('en-GB')).toMatchObject({
      requestedLocale: 'en-GB',
      canonicalRequestedLocale: 'en-GB',
      activeLanguage: 'en',
      formatLocale: 'en-GB',
      lang: 'en',
      dir: 'ltr',
    });
  });

  it('uses a complete English context for missing, malformed, and unsupported requests', () => {
    for (const locale of [null, 'not a locale', 'pl-PL', 'ar-EG']) {
      expect(resolveLocale(locale)).toMatchObject({
        requestedLocale: locale,
        activeLanguage: 'en',
        formatLocale: 'en',
        lang: 'en',
        dir: 'ltr',
      });
    }
  });

  it('uses complete supported language families and retains valid regional formatting', () => {
    for (const [requested, language] of [
      ['nl-BE', 'nl'],
      ['de-CH', 'de'],
      ['fr-CA', 'fr'],
      ['es-MX', 'es'],
      ['it-IT', 'it'],
    ] as const) {
      expect(resolveLocale(requested)).toMatchObject({
        activeLanguage: language,
        lang: language,
        formatLocale: requested,
        dir: 'ltr',
      });
    }
    expect(resolveLocale('FR-fr')).toMatchObject({
      canonicalRequestedLocale: 'fr-FR',
      activeLanguage: 'fr',
      formatLocale: 'fr-FR',
    });
  });

  it('enables expanded pseudo English only when explicitly requested', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'nl', 'de', 'fr', 'es', 'it']);
    expect(resolveLocale('en-XA').activeLanguage).toBe('en');
    expect(resolveLocale('en-XA', { allowPseudoLocale: true })).toMatchObject({
      activeLanguage: 'en-XA',
      formatLocale: 'en',
      lang: 'en-XA',
      dir: 'ltr',
    });
  });
});

describe('exact aggregate counts', () => {
  it('formats BigInt exactly and only exposes safe values for plural selection', () => {
    expect(formatExactCount(1n, 'en-US')).toEqual({
      kind: 'plural',
      formatted: '1',
      count: 1,
    });
    expect(formatExactCount(0n, 'en-US')).toEqual({
      kind: 'plural',
      formatted: '0',
      count: 0,
    });
    expect(formatExactCount(9_007_199_254_740_992n, 'en-US')).toEqual({
      kind: 'exact-only',
      formatted: '9,007,199,254,740,992',
    });
  });

  it('rejects negative values because an aggregate count cannot be negative', () => {
    expect(() => formatExactCount(-1n, 'en-US')).toThrow(RangeError);
  });
});

describe('locale controller', () => {
  it('publishes the latest snapshot to other roots even if one subscriber fails', async () => {
    const controller = createLocaleController<string>('en', (requestedLocale) => ({
      ...resolveLocale(requestedLocale),
      t: requestedLocale ?? 'en',
    }));
    const observed: string[] = [];
    controller.subscribe(() => {
      throw new Error('broken view subscriber');
    });
    controller.subscribe(() => observed.push(controller.getSnapshot().t));
    await expect(controller.setLocale('en-GB')).resolves.toEqual({ status: 'activated' });
    expect(observed).toEqual(['en-GB']);
    expect(controller.getSnapshot().formatLocale).toBe('en-GB');
  });

  it('keeps independent snapshots and only activates the latest prepared request', async () => {
    const pending = new Map<string, () => void>();
    const factory = (requestedLocale: string | null | undefined): LocaleSnapshot<string> => ({
      ...resolveLocale(requestedLocale),
      t: requestedLocale ?? 'en',
    });
    const prepareLocale = (locale: ReturnType<typeof resolveLocale>): Promise<void> =>
      new Promise((resolve) => pending.set(locale.requestedLocale ?? 'en', resolve));
    const first = createLocaleController('en', factory, { prepareLocale });
    const second = createLocaleController('en', factory);

    const oldRequest = first.setLocale('nl-NL');
    const latestRequest = first.setLocale('en-GB');
    pending.get('nl-NL')?.();
    await Promise.resolve();
    expect(first.getSnapshot().requestedLocale).toBe('en');
    pending.get('en-GB')?.();

    await expect(oldRequest).resolves.toMatchObject({ status: 'superseded' });
    await expect(latestRequest).resolves.toMatchObject({ status: 'activated' });
    expect(first.getSnapshot()).toMatchObject({ requestedLocale: 'en-GB', t: 'en-GB' });
    expect(second.getSnapshot()).toMatchObject({ requestedLocale: 'en', t: 'en' });
  });

  it('keeps the active snapshot when locale preparation fails', async () => {
    const factory = (requestedLocale: string | null | undefined): LocaleSnapshot<string> => ({
      ...resolveLocale(requestedLocale),
      t: requestedLocale ?? 'en',
    });
    const controller = createLocaleController('en', factory, {
      prepareLocale: async () => {
        throw new Error('catalog unavailable');
      },
    });

    await expect(controller.setLocale('nl-NL')).resolves.toEqual({ status: 'failed' });
    expect(controller.getSnapshot()).toMatchObject({ requestedLocale: 'en', t: 'en' });
  });
});

describe('explicit interface language preferences', () => {
  it('only accepts a shipped language, preserving automatic fallback for invalid persisted data', () => {
    for (const language of SUPPORTED_LANGUAGES) expect(parseLanguagePreference(language)).toBe(language);
    for (const value of [null, undefined, '', 'auto', 'nl-BE', 'en-XA', 'xx', {}, 1]) {
      expect(parseLanguagePreference(value)).toBeNull();
    }
  });
  it('offers every shipped language once using recognizable native names', () => {
    expect(LANGUAGE_OPTIONS.map(({ value }) => value)).toEqual(SUPPORTED_LANGUAGES);
    expect(LANGUAGE_OPTIONS.map(({ label }) => label)).toEqual([
      'English',
      'Nederlands',
      'Deutsch',
      'Français',
      'Español',
      'Italiano',
    ]);
  });
});
