import { MerchantPreferencesViewSchema } from '@insignia/contracts';
import {
  createLanguagePreferenceState,
  LANGUAGE_OPTIONS,
  languagePreferenceReducer,
  parseLanguagePreference,
  selectedLanguagePreference,
} from '@insignia/ui-localization/core';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import {
  ADMIN_LANGUAGE_PREFERENCE_KEY,
  getAdminLocaleController,
  originalAdminHostLocale,
  readAdminLanguagePreference,
  useAdminLocale,
  withAdminLocale,
  writeAdminLanguagePreference,
} from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready.js';
import { authenticatedJson } from '../shared/admin-request.js';

const destinations = [
  {
    title: 'settings:destinations.storefront.title',
    description: 'settings:destinations.storefront.description',
    href: '/admin/settings/storefront',
  },
  {
    title: 'settings:destinations.translations.title',
    description: 'settings:destinations.translations.description',
    href: '/admin/settings/translations',
  },
  {
    title: 'settings:destinations.permissions.title',
    description: 'settings:destinations.permissions.description',
    href: '/admin/settings/permissions',
  },
  {
    title: 'settings:destinations.billing.title',
    description: 'settings:destinations.billing.description',
    href: '/admin/settings/billing',
  },
] as const;
const automaticLanguageValue = 'automatic';

function MerchantSettings({ real = false }: { real?: boolean }) {
  const [canReadPrivacy, setCanReadPrivacy] = useState(false);
  useEffect(() => {
    if (!real) return;
    const controller = new AbortController();
    void authenticatedJson<unknown>('/api/admin/preferences', { signal: controller.signal })
      .then((value) => {
        const preferences = MerchantPreferencesViewSchema.parse(value);
        if (!controller.signal.aborted) setCanReadPrivacy(preferences.canReadPrivacy === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCanReadPrivacy(false);
      });
    return () => controller.abort();
  }, [real]);
  const rows =
    real && canReadPrivacy
      ? [
          ...destinations,
          {
            title: 'settings:destinations.privacy.title',
            description: 'settings:destinations.privacy.description',
            href: '/admin/settings/privacy',
          } as const,
        ]
      : destinations;
  const { t: translateUi } = useAdminLocale();
  const [languageState, dispatchLanguage] = useReducer(languagePreferenceReducer, createLanguagePreferenceState());
  const languagePreference = selectedLanguagePreference(languageState) ?? automaticLanguageValue;
  const languagePending = languageState.status === 'changing';
  const languageFailed = languageState.status === 'failed';
  const languageRequest = useRef(0);
  const languageField = useRef<HTMLElementTagNameMap['s-select']>(null);
  const restoreLanguageFocus = useRef(false);

  useLayoutEffect(() => {
    if (languagePending || !restoreLanguageFocus.current) return;
    restoreLanguageFocus.current = false;
    // Disabling a native field moves focus to the document. Restore through
    // Polaris's public focus method after it applies the enabled state.
    const frame = requestAnimationFrame(() => {
      if (
        !document.activeElement ||
        document.activeElement === document.body ||
        document.activeElement === document.documentElement
      ) {
        languageField.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [languagePending]);

  useLayoutEffect(() => {
    const restorePreference = () => {
      dispatchLanguage({
        type: 'restored',
        revision: ++languageRequest.current,
        preference: readAdminLanguagePreference(document),
      });
    };
    const restoreStoragePreference = (event: StorageEvent) => {
      if (event.key === ADMIN_LANGUAGE_PREFERENCE_KEY || event.key === null) restorePreference();
    };
    const restoreHistoryPreference = (event: PageTransitionEvent) => {
      if (event.persisted) restorePreference();
    };
    restorePreference();
    window.addEventListener('pageshow', restoreHistoryPreference);
    window.addEventListener('storage', restoreStoragePreference);
    return () => {
      window.removeEventListener('pageshow', restoreHistoryPreference);
      window.removeEventListener('storage', restoreStoragePreference);
    };
  }, []);

  async function chooseLanguage(value: string) {
    restoreLanguageFocus.current = document.activeElement === languageField.current;
    const requestedLanguage = parseLanguagePreference(value);
    const request = ++languageRequest.current;
    dispatchLanguage({ type: 'requested', revision: request, preference: requestedLanguage });
    try {
      const result = await getAdminLocaleController(document).setLocale(
        requestedLanguage ?? originalAdminHostLocale(document),
      );
      if (request !== languageRequest.current) return;
      if (result.status === 'activated') {
        writeAdminLanguagePreference(document, requestedLanguage);
        dispatchLanguage({ type: 'activated', revision: request });
        return;
      }
      dispatchLanguage({ type: result.status === 'failed' ? 'failed' : 'cancelled', revision: request });
    } catch {
      if (request !== languageRequest.current) return;
      dispatchLanguage({ type: 'failed', revision: request });
    }
  }

  useAdminPageReady(true);
  return (
    <s-page inlineSize="small" heading={translateUi('settings:merchantSettings.settings')}>
      <s-section heading={translateUi('settings:language.preferences')}>
        <s-select
          id="admin-language"
          ref={languageField}
          name="admin-language"
          label={translateUi('settings:language.label')}
          details={translateUi('settings:language.help')}
          error={languageFailed ? translateUi('settings:language.failure') : undefined}
          value={languagePreference}
          disabled={languagePending}
          onChange={(event) => void chooseLanguage(event.currentTarget.value)}
        >
          <s-option value={automaticLanguageValue}>{translateUi('settings:language.automatic')}</s-option>
          {LANGUAGE_OPTIONS.map((option) => (
            <s-option key={option.value} value={option.value}>
              {option.label}
            </s-option>
          ))}
        </s-select>
      </s-section>
      <s-section accessibilityLabel={translateUi('settings:merchantSettings.settings')} padding="none">
        <s-box padding="small-400">
          {rows.map((row, index) => (
            <s-box key={row.href}>
              {index > 0 && (
                <s-box paddingInline="small-100">
                  <s-divider />
                </s-box>
              )}
              <s-clickable
                href={row.href}
                accessibilityLabel={translateUi(row.title)}
                padding="small-100"
                borderRadius="base"
              >
                <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
                  <s-box>
                    <s-heading>{translateUi(row.title)}</s-heading>
                    <s-paragraph color="subdued">{translateUi(row.description)}</s-paragraph>
                  </s-box>
                  <s-icon type="chevron-right" />
                </s-grid>
              </s-clickable>
            </s-box>
          ))}
        </s-box>
      </s-section>
    </s-page>
  );
}

export default withAdminLocale(MerchantSettings);
