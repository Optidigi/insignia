export {
  createLanguagePreferenceState,
  type LanguagePreference,
  type LanguagePreferenceEvent,
  type LanguagePreferenceState,
  languagePreferenceReducer,
  selectedLanguagePreference,
} from './language-preference.js';

export type LocaleInput = string | null | undefined;
export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'nl', 'de', 'fr', 'es', 'it'] as const);

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Native language names are metadata, not text translated into the current UI language. */
export const LANGUAGE_OPTIONS = Object.freeze([
  { value: 'en', label: 'English' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'it', label: 'Italiano' },
] as const satisfies readonly { readonly value: SupportedLanguage; readonly label: string }[]);

/** An absent, stale or malformed preference follows the host instead of guessing a language. */
export function parseLanguagePreference(value: unknown): SupportedLanguage | null {
  return SUPPORTED_LANGUAGES.find((language) => language === value) ?? null;
}

export type TypedTranslator<MessageTable extends object> = <Key extends keyof MessageTable & string>(
  key: Key,
  ...args: [keyof MessageTable[Key]] extends [never] ? [] : [values: MessageTable[Key]]
) => string;

export type MessageArguments<Parameters> = [keyof Parameters] extends [never]
  ? readonly []
  : readonly [values: Parameters];

export type MessageDescriptorFor<MessageTable extends object, Key extends keyof MessageTable & string> = Readonly<{
  key: Key;
  args: MessageArguments<MessageTable[Key]>;
}>;

export type MessageDescriptor<MessageTable extends object> = {
  [Key in keyof MessageTable & string]: MessageDescriptorFor<MessageTable, Key>;
}[keyof MessageTable & string];

export type MessageFactory<MessageTable extends object> = <Key extends keyof MessageTable & string>(
  key: Key,
  ...args: MessageArguments<MessageTable[Key]>
) => MessageDescriptorFor<MessageTable, Key>;

/** Builds immutable, translation-neutral messages that can live in state. */
export function createMessageFactory<MessageTable extends object>(): MessageFactory<MessageTable> {
  return ((key: string, ...args: unknown[]) => {
    const values = args[0];
    const stableArgs: readonly unknown[] =
      values !== null && typeof values === 'object' ? Object.freeze([Object.freeze({ ...values })]) : Object.freeze([]);
    return Object.freeze({ key, args: stableArgs });
  }) as unknown as MessageFactory<MessageTable>;
}

/** Renders a stored descriptor with the current translator. */
export function renderMessage<MessageTable extends object>(
  translator: TypedTranslator<MessageTable>,
  descriptor: MessageDescriptor<MessageTable>,
): string {
  const dynamicTranslator = translator as unknown as (key: string, ...values: unknown[]) => string;
  return dynamicTranslator(descriptor.key, ...descriptor.args);
}

export interface ResolvedLocale {
  readonly requestedLocale: string | null;
  readonly canonicalRequestedLocale: string | null;
  readonly activeLanguage: SupportedLanguage | 'en-XA';
  readonly formatLocale: string;
  readonly lang: SupportedLanguage | 'en-XA';
  readonly dir: 'ltr';
}

export interface LocaleResolutionOptions {
  readonly allowPseudoLocale?: boolean;
}

export type LocaleSnapshot<TTranslator, TMessage = never> = Readonly<
  Omit<ResolvedLocale, 'lang' | 'dir'> & {
    /** Effective audience language; customer-authored exact-locale copy may be outside the built-in registry. */
    lang: string;
    /** Effective text direction for the audience, including customer-authored locales. */
    dir: 'ltr' | 'rtl';
    /**
     * Returns plain text. Render it as a text node or through an HTML-escaping
     * template interpolation; never insert it as raw HTML.
     */
    t: TTranslator;
  } & ([TMessage] extends [never] ? object : { message(descriptor: TMessage): string })
>;

export type SnapshotFactory<TTranslator, TMessage = never> = (
  requestedLocale: LocaleInput,
) => LocaleSnapshot<TTranslator, TMessage>;

export type LocaleUpdateResult =
  | { readonly status: 'activated' }
  | { readonly status: 'superseded' }
  | { readonly status: 'failed' };

export interface LocaleControllerOptions extends LocaleResolutionOptions {
  readonly prepareLocale?: (locale: ResolvedLocale) => Promise<void>;
}

export interface LocaleController<TTranslator, TMessage = never> {
  getSnapshot(): LocaleSnapshot<TTranslator, TMessage>;
  subscribe(listener: () => void): () => void;
  setLocale(requestedLocale: LocaleInput): Promise<LocaleUpdateResult>;
}

function canonicalizeLocale(requestedLocale: string | null): string | null {
  if (requestedLocale === null || requestedLocale.trim() === '') return null;

  try {
    return Intl.getCanonicalLocales(requestedLocale)[0] ?? null;
  } catch {
    return null;
  }
}

function supportsFormattingLocale(locale: string): boolean {
  try {
    return (
      Intl.NumberFormat.supportedLocalesOf([locale]).length === 1 &&
      Intl.DateTimeFormat.supportedLocalesOf([locale]).length === 1 &&
      Intl.Collator.supportedLocalesOf([locale]).length === 1
    );
  } catch {
    return false;
  }
}

/**
 * Resolves a host-provided language into the language actually rendered and
 * the independent locale used by Intl formatters. Supported language families share a complete catalog while regional tags
 * remain formatting preferences. Unsupported language families use English
 * copy and formatting together.
 */
export function resolveLocale(requestedLocale: LocaleInput, options: LocaleResolutionOptions = {}): ResolvedLocale {
  const requested = typeof requestedLocale === 'string' ? requestedLocale : null;
  const canonical = canonicalizeLocale(requested);

  if (options.allowPseudoLocale === true && canonical === 'en-XA') {
    return Object.freeze({
      requestedLocale: requested,
      canonicalRequestedLocale: canonical,
      activeLanguage: 'en-XA',
      formatLocale: 'en',
      lang: 'en-XA',
      dir: 'ltr',
    });
  }

  const family = canonical?.split('-')[0]?.toLowerCase();
  const activeLanguage = SUPPORTED_LANGUAGES.find((language) => language === family) ?? 'en';
  const supported = family === activeLanguage;
  const formatLocale =
    supported && canonical !== null && supportsFormattingLocale(canonical) ? canonical : activeLanguage;

  return Object.freeze({
    requestedLocale: requested,
    canonicalRequestedLocale: canonical,
    activeLanguage,
    formatLocale,
    lang: activeLanguage,
    dir: 'ltr',
  });
}

export type ExactCountFormatting =
  | { readonly kind: 'plural'; readonly formatted: string; readonly count: number }
  | { readonly kind: 'exact-only'; readonly formatted: string };

/**
 * Formats an aggregate count without losing BigInt precision. `count` is
 * present only while the exact value remains safe for i18next plural rules.
 */
export function formatExactCount(value: bigint, locale: string): ExactCountFormatting {
  if (value < 0n) throw new RangeError('Aggregate counts cannot be negative');

  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(value);

  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return { kind: 'plural', formatted, count: Number(value) };
  }

  return { kind: 'exact-only', formatted };
}

/**
 * Creates an instance-scoped locale controller. Resource preparation happens
 * before the snapshot is built or published; a newer request invalidates older
 * work, and a preparation failure leaves the current complete snapshot active.
 */
export function createLocaleController<TTranslator, TMessage = never>(
  initialLocale: LocaleInput,
  createSnapshot: SnapshotFactory<TTranslator, TMessage>,
  options: LocaleControllerOptions = {},
): LocaleController<TTranslator, TMessage> {
  let snapshot = createSnapshot(initialLocale);
  let latestGeneration = 0;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async setLocale(requestedLocale) {
      const generation = ++latestGeneration;
      const resolved = resolveLocale(requestedLocale, options);

      try {
        await (options.prepareLocale?.(resolved) ?? Promise.resolve());
        if (generation !== latestGeneration) return { status: 'superseded' };

        const nextSnapshot = createSnapshot(requestedLocale);
        if (generation !== latestGeneration) return { status: 'superseded' };

        snapshot = nextSnapshot;
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch {
            // A view failure cannot undo the published locale or starve other roots.
          }
        }
        return { status: 'activated' };
      } catch {
        return generation === latestGeneration ? { status: 'failed' } : { status: 'superseded' };
      }
    },
  };
}
