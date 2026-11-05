import type { AdminMessageKey } from '@insignia/ui-localization/admin';
import { resolveLocale } from '@insignia/ui-localization/core';
import {
  CUSTOMER_WORDING_MANIFEST,
  type CustomerWordingForm,
  type CustomerWordingManifestEntry,
  customerDirectionForLocale,
  customerWordingDefaultText,
  customerWordingSourceText,
  requiredCustomerWordingForms,
  validateCustomerWordingOverlay,
} from '@insignia/ui-localization/customer';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { TranslationsContentSkeleton } from '../components/AdminPageSkeleton';
import AdminSaveBar from '../components/AdminSaveBar';
import AutoSizeTextArea, { focusTextArea } from '../components/AutoSizeTextArea';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { customerWordingLabels } from '../shared/customer-wording-labels';
import { initialTranslationEditorState, translationEditorReducer } from './customer-translations-editor-state';
import {
  type CustomerTranslationsStoragePort,
  createBrowserCustomerTranslationsStorage,
  createCustomerTranslationsWorkflow,
} from './customer-translations-workflow';
import '../styles/merchant-translations.css';

const commonLanguageTags = [
  'nl',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'pl',
  'ja',
  'ko',
  'zh-CN',
  'ar',
  'he',
  'hi',
  'tr',
  'sv',
  'da',
  'nb',
  'fi',
  'cs',
  'en-GB',
  'en-US',
];
const pageSize = 50;
const navigationOrder = new Map(
  [
    'artwork',
    'quantities',
    'review',
    'addToCart',
    'updateCart',
    'chooseQuantities',
    'previousStep',
    'done',
    'addingToCart',
    'updatingCart',
    'designSteps',
  ].map((key, index) => [`customer:steps.${key}`, index]),
);
const sectionId = (entry: CustomerWordingManifestEntry) =>
  entry.group.id.startsWith('common.') ? 'common' : (entry.group.id.split('.')[1] ?? 'chrome');
type Confirmation = { kind: 'switch'; locale: string } | { kind: 'reset' | 'remove' | 'clear' };

/** Test-host ports are accepted only in the explicit loopback review environment. */
function localPreviewOptions(): { storagePort?: CustomerTranslationsStoragePort; readOnly?: boolean } {
  if (typeof window === 'undefined') return {};
  const url = new URL(window.location.href);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.searchParams.has('__translations_example'))
    return {};
  return (
    (
      window as unknown as {
        __insigniaCustomerTranslationsPreview?: { storagePort?: CustomerTranslationsStoragePort; readOnly?: boolean };
      }
    ).__insigniaCustomerTranslationsPreview ?? {}
  );
}

function MerchantTranslations({
  initialSection,
  initialWordingLocale,
}: {
  initialSection?: string | null;
  initialWordingLocale?: string | null;
}) {
  const { t, formatLocale } = useAdminLocale();
  const previewOptions = useMemo(localPreviewOptions, []);
  const workflow = useMemo(
    () =>
      createCustomerTranslationsWorkflow({
        validateOverlay: validateCustomerWordingOverlay,
        shop:
          typeof window === 'undefined'
            ? null
            : (window as unknown as { shopify?: { config?: { shop?: unknown } } }).shopify?.config?.shop,
        storage: previewOptions.storagePort ?? createBrowserCustomerTranslationsStorage(),
      }),
    [],
  );
  const [state, setState] = useState(workflow.getSnapshot());
  const knownSections = ['all', 'customized', ...new Set(CUSTOMER_WORDING_MANIFEST.map(sectionId))];
  const initialGroup = initialSection && knownSections.includes(initialSection) ? initialSection : null;
  const [view, dispatchView] = useReducer(
    translationEditorReducer,
    initialTranslationEditorState(initialGroup ?? 'steps'),
  );
  const { section: group, query, page } = view;
  const [editorOpen, setEditorOpen] = useState(initialGroup !== null);
  const [language, setLanguage] = useState('nl');
  const [customLanguage, setCustomLanguage] = useState('');
  const [languageError, setLanguageError] = useState<'invalidLanguage' | 'duplicateLanguage' | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const fieldId = (key: string, form: CustomerWordingForm) => `wording-${key.replace(/[^a-zA-Z0-9-]/g, '-')}-${form}`;
  useLayoutEffect(() => {
    if (!focusField) return;
    const frame = requestAnimationFrame(() => {
      const field = document.getElementById(focusField);
      if (field?.localName === 's-text-area') focusTextArea(field);
      else field?.focus();
      field?.scrollIntoView({ block: 'center' });
      setFocusField(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusField]);
  const addDialog = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const confirmDialog = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    const unsubscribe = workflow.subscribe(() => setState(workflow.getSnapshot()));
    void workflow.load().then((loaded) => {
      if (loaded && initialWordingLocale) workflow.selectLanguage(initialWordingLocale);
    });
    return () => {
      unsubscribe();
      workflow.dispose();
    };
  }, [workflow]);
  useAdminPageReady(state.phase !== 'loading');
  const number = (value: number) => new Intl.NumberFormat(formatLocale).format(value);
  const selectedLocale = state.selectedLocale;
  const busy = state.pending === 'saving';
  const ready = state.phase === 'ready';
  const dirty = state.dirty;
  const name = (tag: string) => {
    try {
      return new Intl.DisplayNames([formatLocale], { type: 'language' }).of(tag) ?? tag;
    } catch {
      return tag;
    }
  };
  const groups = [...new Set(CUSTOMER_WORDING_MANIFEST.map((entry) => sectionId(entry)))];
  const groupLabel = (id: string) => t(`settings:translations.groups.${id}` as AdminMessageKey);
  const fieldLabel = (entry: CustomerWordingManifestEntry) => t(customerWordingLabels[entry.key]);
  const current = state.currentOverlay;
  const customizedKeys = () => Object.keys(workflow.getSnapshot().currentOverlay.messages);
  useLayoutEffect(() => {
    if (!ready) return;
    dispatchView({
      type: 'snapshot-accepted',
      locale: selectedLocale,
      customizedKeys: customizedKeys(),
      matchingKeys: matchKeys(query),
    });
    const url = new URL(window.location.href);
    url.searchParams.set('wordingLocale', selectedLocale);
    history.replaceState(null, '', url);
  }, [ready, selectedLocale, state.savedByLocale]);
  function discard() {
    setAnnouncement('');
    workflow.discard();
    const snapshot = workflow.getSnapshot();
    dispatchView({
      type: 'snapshot-accepted',
      locale: snapshot.selectedLocale,
      customizedKeys: Object.keys(snapshot.currentOverlay.messages),
      matchingKeys: matchKeys(query),
    });
  }
  const viewLabel = (id: string) =>
    id === 'all'
      ? t('settings:translations.allText')
      : id === 'customized'
        ? t('settings:translations.customizedText')
        : groupLabel(id);

  function matchKeys(value: string): readonly string[] {
    const normalized = value.trim().toLocaleLowerCase(formatLocale);
    return CUSTOMER_WORDING_MANIFEST.filter((entry) => {
      const text = [
        fieldLabel(entry),
        ...Object.values(entry.sourceForms),
        ...requiredCustomerWordingForms(entry, selectedLocale).map((form) =>
          customerWordingDefaultText(entry, form, selectedLocale),
        ),
        ...Object.values(workflow.getSnapshot().currentOverlay.messages[entry.key] ?? {}),
      ].join(' ');
      return text.toLocaleLowerCase(formatLocale).includes(normalized);
    }).map((entry) => entry.key);
  }
  const entries = CUSTOMER_WORDING_MANIFEST.filter((entry) => {
    if (
      group === 'customized' ? !view.customizedKeys.includes(entry.key) : group !== 'all' && sectionId(entry) !== group
    )
      return false;
    return view.matchingKeys === null || view.matchingKeys.includes(entry.key);
  });
  entries.sort((left, right) => (navigationOrder.get(left.key) ?? 100) - (navigationOrder.get(right.key) ?? 100));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
  const visibleEntries = entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const editable = ready && !busy && !previewOptions.readOnly;
  const errors = current ? workflow.validateCurrent() : [];
  const errorFor = (key: string, form: CustomerWordingForm, variables: string) => {
    if (!showErrors && !touched.has(`${selectedLocale}:${key}:${form}`)) return undefined;
    const issue = errors.find((issue) => issue.key === key && issue.form === form);
    if (!issue) return undefined;
    if (issue.code === 'placeholder-mismatch') return t('settings:translations.invalidVariables', { variables });
    if (issue.code === 'text-too-long') return t('settings:translations.tooLong');
    return t('settings:translations.invalidText');
  };
  async function showConfirmation(value: Confirmation) {
    setConfirmation(value);
    await customElements.whenDefined('s-modal');
    confirmDialog.current?.showOverlay();
  }
  function chooseLocale(value: string) {
    if (value === selectedLocale) return;
    setAnnouncement('');
    if (dirty) void showConfirmation({ kind: 'switch', locale: value });
    else workflow.selectLanguage(value);
  }
  function confirm() {
    setAnnouncement('');
    if (!confirmation || busy) return;
    if (confirmation.kind === 'switch') workflow.selectLanguage(confirmation.locale, { discardChanges: true });
    if (confirmation.kind === 'reset') workflow.resetLanguage(selectedLocale, true);
    if (confirmation.kind === 'remove') workflow.removeLanguage(selectedLocale, true);
    if (confirmation.kind === 'clear') void workflow.clearInvalidStorage(true);
    confirmDialog.current?.hideOverlay();
    setConfirmation(null);
  }
  async function save() {
    setAnnouncement('');
    if (errors.length) {
      setShowErrors(true);
      setEditorOpen(true);
      const first = errors[0];
      const entry = CUSTOMER_WORDING_MANIFEST.find((candidate) => candidate.key === first?.key);
      if (entry && first?.form) {
        const section = sectionId(entry);
        dispatchView({ type: 'section-opened', section, customizedKeys: customizedKeys() });
        const index = CUSTOMER_WORDING_MANIFEST.filter((candidate) => sectionId(candidate) === section)
          .sort((left, right) => (navigationOrder.get(left.key) ?? 100) - (navigationOrder.get(right.key) ?? 100))
          .findIndex((candidate) => candidate.key === entry.key);
        dispatchView({ type: 'page-selected', page: Math.floor(index / pageSize) });
        setFocusField(fieldId(entry.key, first.form as CustomerWordingForm));
      }
      return;
    }
    await workflow.save();
    if (workflow.getSnapshot().saveError) setFocusField('translation-save-error');
    if (!workflow.getSnapshot().dirty && workflow.getSnapshot().saveError === null)
      setAnnouncement(t('settings:translations.saved'));
  }
  function addLanguage() {
    const tag = language === 'other' ? customLanguage.trim() : language;
    const outcome = workflow.addLanguage(tag);
    if (!outcome) {
      let canonical: string | undefined;
      try {
        canonical = Intl.getCanonicalLocales(tag)[0];
      } catch {}
      setLanguageError(canonical && state.locales.includes(canonical) ? 'duplicateLanguage' : 'invalidLanguage');
      return;
    }
    setLanguageError(null);
    setEditorOpen(true);
    dispatchView({ type: 'section-opened', section: 'steps', customizedKeys: customizedKeys() });
    addDialog.current?.hideOverlay();
  }
  const changed = Object.values(current?.messages ?? {}).reduce(
    (total, forms) => total + Object.values(forms ?? {}).filter(Boolean).length,
    0,
  );
  function openSection(id: string) {
    setAnnouncement('');
    dispatchView({ type: 'section-opened', section: id, customizedKeys: customizedKeys() });
    setEditorOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set('section', id);
    history.replaceState(null, '', url);
  }
  async function showAddLanguage() {
    setLanguage(commonLanguageTags.find((tag) => !state.locales.includes(tag)) ?? 'other');
    setLanguageError(null);
    await customElements.whenDefined('s-modal');
    addDialog.current?.showOverlay();
  }
  const sections = ['steps', 'artwork', 'quantities', 'options', 'placements', 'positioning', 'review'];
  const remaining = groups.filter((id) => !sections.includes(id));
  const orderedSections = [...sections, ...remaining];
  return (
    <s-page heading={t('settings:translations.title')} inlineSize="large">
      <s-link
        slot="breadcrumb-actions"
        href={
          editorOpen
            ? `/admin/settings/translations?wordingLocale=${encodeURIComponent(selectedLocale)}`
            : '/admin/settings'
        }
      >
        {editorOpen ? t('settings:translations.backToTranslations') : t('settings:merchantSettings.settings')}
      </s-link>
      {ready && (
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          disabled={!editable || !dirty}
          onClick={() => void save()}
        >
          {t('settings:translations.save')}
        </s-button>
      )}
      {ready && dirty && (
        <s-button slot="secondary-actions" disabled={busy} onClick={discard}>
          {t('settings:translations.discardAction')}
        </s-button>
      )}
      {state.phase === 'loading' ? (
        <TranslationsContentSkeleton editor={editorOpen} />
      ) : !ready ? (
        <div class="translations-content">
          <s-section>
            <s-stack gap="base">
              <s-banner
                tone="critical"
                heading={t(
                  state.error === 'invalid-record'
                    ? 'settings:translations.invalidRecord'
                    : 'settings:translations.loadFailed',
                )}
              >
                <s-paragraph>
                  {t(
                    state.error === 'invalid-record'
                      ? 'settings:translations.invalidRecordDescription'
                      : state.error === 'invalid-shop'
                        ? 'settings:translations.sessionUnavailable'
                        : 'settings:translations.loadFailedDescription',
                  )}
                </s-paragraph>
              </s-banner>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={() => void workflow.load()}>{t('settings:translations.retry')}</s-button>
                {state.error === 'invalid-record' && (
                  <s-button tone="critical" onClick={() => void showConfirmation({ kind: 'clear' })}>
                    {t('settings:translations.reset')}
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </s-section>
        </div>
      ) : (
        <>
          {previewOptions.readOnly && (
            <div class="translations-notice">
              <s-banner>
                <s-paragraph>{t('settings:translations.readOnly')}</s-paragraph>
              </s-banner>
            </div>
          )}
          {state.saveError && (
            <div id="translation-save-error" class="translations-notice" tabIndex={-1}>
              <s-banner tone="critical" heading={t('settings:translations.saveFailed')}>
                <s-paragraph>{t('settings:translations.saveFailedDescription')}</s-paragraph>
              </s-banner>
            </div>
          )}
          <div role="status" aria-live="polite" class="translations-announcement">
            {announcement}
          </div>
          {!editorOpen ? (
            <div class="translations-content translations-overview-layout">
              <main data-translations-overview>
                <div class="translations-overview-mobile-controls">
                  <s-select
                    label={t('settings:translations.language')}
                    value={selectedLocale}
                    disabled={busy}
                    onChange={(event) => chooseLocale(event.currentTarget.value)}
                  >
                    {state.locales.map((tag) => (
                      <s-option key={tag} value={tag}>
                        {tag === 'en' ? t('settings:translations.defaultLanguage') : `${name(tag)} (${tag})`}
                      </s-option>
                    ))}
                  </s-select>
                  <s-button
                    variant="tertiary"
                    icon="plus"
                    disabled={!editable || dirty}
                    onClick={() => void showAddLanguage()}
                  >
                    {t('settings:translations.addLanguage')}
                  </s-button>
                </div>
                <div class="translations-overview-heading">
                  <s-text color="subdued">{t('settings:translations.localizedContent')}</s-text>
                  <div class="translations-language-name">
                    <s-heading>{name(selectedLocale)}</s-heading>
                    {selectedLocale === 'en' && <s-badge>{t('settings:translations.default')}</s-badge>}
                  </div>
                </div>
                <s-section padding="none">
                  <div class="translations-content-categories">
                    {[
                      { heading: t('settings:translations.customizerText'), ids: sections },
                      { heading: t('settings:translations.otherText'), ids: remaining },
                    ].map(({ heading, ids }, sectionIndex) => (
                      <div key={sectionIndex}>
                        <s-box background="subdued" padding="small-200" borderRadius="base">
                          <s-heading>{heading}</s-heading>
                        </s-box>
                        {ids.map((id) => (
                          <s-clickable
                            key={id}
                            accessibilityLabel={groupLabel(id)}
                            padding="small-100"
                            borderRadius="base"
                            onClick={() => openSection(id)}
                          >
                            <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="base" alignItems="center">
                              <s-text>{groupLabel(id)}</s-text>
                              <s-icon type="chevron-right" />
                            </s-grid>
                          </s-clickable>
                        ))}
                      </div>
                    ))}
                  </div>
                </s-section>
              </main>
              <aside class="translations-languages">
                <s-stack gap="base">
                  <s-heading>{t('settings:translations.languages')}</s-heading>
                  {state.locales.map((tag) => (
                    <s-clickable
                      key={tag}
                      accessibilityLabel={t('settings:translations.editLanguage', { language: name(tag) })}
                      padding="small-200"
                      borderRadius="base"
                      onClick={() => chooseLocale(tag)}
                    >
                      <s-grid gridTemplateColumns="minmax(0, 1fr) auto" gap="small-200" alignItems="center">
                        <s-text>{name(tag)}</s-text>
                        {tag === 'en' && <s-badge>{t('settings:translations.default')}</s-badge>}
                      </s-grid>
                    </s-clickable>
                  ))}
                  <s-button
                    variant="tertiary"
                    icon="plus"
                    disabled={!editable || dirty}
                    onClick={() => void showAddLanguage()}
                  >
                    {t('settings:translations.addLanguage')}
                  </s-button>
                  <s-divider />
                  <s-paragraph color="subdued">{t('settings:translations.intro')}</s-paragraph>
                </s-stack>
              </aside>
            </div>
          ) : (
            <div class="translations-editor">
              <div class="translations-editor-top">
                <s-select
                  label={t('settings:translations.language')}
                  labelAccessibilityVisibility="exclusive"
                  value={selectedLocale}
                  disabled={busy}
                  onChange={(event) => chooseLocale(event.currentTarget.value)}
                >
                  {state.locales.map((tag) => (
                    <s-option key={tag} value={tag}>
                      {tag === 'en' ? t('settings:translations.defaultLanguage') : `${name(tag)} (${tag})`}
                    </s-option>
                  ))}
                </s-select>
                <s-button
                  variant="tertiary"
                  icon="plus"
                  disabled={!editable || dirty}
                  onClick={() => void showAddLanguage()}
                >
                  {t('settings:translations.addLanguage')}
                </s-button>
              </div>
              <div class="translations-editor-shell">
                <aside class="translations-section-nav" aria-label={t('settings:translations.category')}>
                  <s-box background="subdued" padding="none" blockSize="100%">
                    <div class="translations-nav-heading">
                      <s-box background="base" padding="small-200">
                        <s-text color="subdued">{t('settings:translations.sections')}</s-text>
                      </s-box>
                    </div>
                    {['all', 'customized', ...orderedSections].map((id) => (
                      <s-clickable
                        key={id}
                        data-active={id === group ? 'true' : undefined}
                        accessibilityLabel={
                          id === group
                            ? t('settings:translations.currentSection', { section: viewLabel(id) })
                            : viewLabel(id)
                        }
                        padding="small-100"
                        onClick={() => openSection(id)}
                      >
                        <s-text>{viewLabel(id)}</s-text>
                      </s-clickable>
                    ))}
                  </s-box>
                </aside>
                <main class="translations-editor-main">
                  <div class="translations-editor-heading">
                    <s-heading>{t('settings:translations.customerCustomizer')}</s-heading>
                  </div>
                  <div class="translations-section-select">
                    <s-select
                      label={t('settings:translations.category')}
                      value={group}
                      onChange={(event) => openSection(event.currentTarget.value)}
                    >
                      <s-option value="all">{t('settings:translations.allText')}</s-option>
                      <s-option value="customized">{t('settings:translations.customizedText')}</s-option>
                      {orderedSections.map((id) => (
                        <s-option key={id} value={id}>
                          {groupLabel(id)}
                        </s-option>
                      ))}
                    </s-select>
                  </div>
                  <s-search-field
                    label={t('settings:translations.filterFields')}
                    labelAccessibilityVisibility="exclusive"
                    placeholder={t('settings:translations.filterFields')}
                    value={query}
                    onInput={(event) => {
                      dispatchView({
                        type: 'query-edited',
                        query: event.currentTarget.value,
                        matchingKeys: matchKeys(event.currentTarget.value),
                      });
                    }}
                  />
                  <s-section padding="none" heading={viewLabel(group)}>
                    <div class="translations-comparison-head" aria-hidden="true">
                      <span>{t('settings:translations.field')}</span>
                      <span>{t('settings:translations.referenceLanguage')}</span>
                      <span>{name(selectedLocale)}</span>
                    </div>
                    {visibleEntries.map((entry) => (
                      <fieldset
                        key={`${selectedLocale}:${entry.key}`}
                        class="translations-fieldset"
                        aria-label={fieldLabel(entry)}
                      >
                        {requiredCustomerWordingForms(entry, selectedLocale).map((form, index) => {
                          const value = current?.messages[entry.key]?.[form] ?? '';
                          const variables = entry.parameters.map((parameter) => `{{${parameter.name}}}`).join(', ');
                          const error = errorFor(entry.key, form, variables);
                          const suffix = form === 'message' ? '' : ` · ${t(`settings:translations.${form}`)}`;
                          return (
                            <div class="translations-comparison-row" key={form}>
                              <div
                                class="translations-field-label"
                                id={index === 0 ? `label-${entry.key.replace(/[^a-zA-Z0-9-]/g, '-')}` : undefined}
                              >
                                {fieldLabel(entry)}
                                {suffix}
                              </div>
                              <div class="translations-reference">
                                <s-box
                                  background="subdued"
                                  paddingBlock="small-200"
                                  paddingInline="none"
                                  blockSize="100%"
                                >
                                  <div class="translations-reference-content">
                                    <span class="translations-mobile-label">
                                      {t('settings:translations.referenceLanguage')}
                                      {suffix}
                                    </span>
                                    <AutoSizeTextArea
                                      label={`${t('settings:translations.defaultText')}${suffix}`}
                                      readOnly
                                      lang="en"
                                      value={customerWordingSourceText(entry, form)}
                                    />
                                  </div>
                                </s-box>
                              </div>
                              <div class="translations-target" dir={customerDirectionForLocale(selectedLocale)}>
                                <span class="translations-mobile-label">
                                  {name(selectedLocale)}
                                  {suffix}
                                </span>
                                <div class="translations-target-controls">
                                  <AutoSizeTextArea
                                    id={fieldId(entry.key, form)}
                                    label={`${t('settings:translations.languageText', { language: name(selectedLocale) })}${suffix}`}
                                    value={value}
                                    lang={value.length ? selectedLocale : resolveLocale(selectedLocale).lang}
                                    placeholder={customerWordingDefaultText(entry, form, selectedLocale)}
                                    disabled={!editable}
                                    error={error}
                                    onBlur={() =>
                                      setTouched(
                                        (previous) => new Set([...previous, `${selectedLocale}:${entry.key}:${form}`]),
                                      )
                                    }
                                    onInput={(value) => {
                                      setAnnouncement('');
                                      setShowErrors(false);
                                      setTouched((previous) => {
                                        const next = new Set(previous);
                                        next.delete(`${selectedLocale}:${entry.key}:${form}`);
                                        return next;
                                      });
                                      workflow.editMessage(entry.key, form, value);
                                    }}
                                  />
                                  {value ? (
                                    <>
                                      <s-button
                                        variant="tertiary"
                                        icon="reset"
                                        accessibilityLabel={t('settings:translations.restoreField', {
                                          field: `${fieldLabel(entry)}${suffix}`,
                                        })}
                                        interestFor={`restore-${fieldId(entry.key, form)}`}
                                        disabled={!editable}
                                        onClick={() => {
                                          setAnnouncement('');
                                          workflow.resetMessage(entry.key, form);
                                          setFocusField(fieldId(entry.key, form));
                                        }}
                                      />
                                      <s-tooltip id={`restore-${fieldId(entry.key, form)}`}>
                                        {t('settings:translations.restoreDefault')}
                                      </s-tooltip>
                                    </>
                                  ) : (
                                    <span aria-hidden="true" />
                                  )}
                                </div>
                                {entry.parameters.length > 0 && (
                                  <s-text color="subdued">{t('settings:translations.variables', { variables })}</s-text>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </fieldset>
                    ))}
                    {visibleEntries.length === 0 && (
                      <s-box padding="large">
                        <s-stack gap="base" alignItems="center">
                          <s-heading>
                            {t(
                              group === 'customized' && query === ''
                                ? 'settings:translations.noCustomizations'
                                : 'settings:translations.noResults',
                            )}
                          </s-heading>
                          <s-paragraph color="subdued">
                            {t(
                              group === 'customized' && query === ''
                                ? 'settings:translations.noCustomizationsDescription'
                                : 'settings:translations.noResultsDescription',
                            )}
                          </s-paragraph>
                          <s-button
                            onClick={() => {
                              if (query !== '') dispatchView({ type: 'query-edited', query: '', matchingKeys: [] });
                              else openSection('all');
                            }}
                          >
                            {t(query !== '' ? 'settings:translations.clearSearch' : 'settings:translations.allText')}
                          </s-button>
                        </s-stack>
                      </s-box>
                    )}
                    {entries.length > pageSize && (
                      <s-box padding="base">
                        <div class="translations-pagination">
                          <s-text color="subdued">
                            {t('settings:translations.range', {
                              start: number(currentPage * pageSize + 1),
                              end: number(Math.min((currentPage + 1) * pageSize, entries.length)),
                              total: number(entries.length),
                            })}
                          </s-text>
                          <s-stack direction="inline" gap="small-200">
                            <s-button
                              accessibilityLabel={t('settings:translations.previous')}
                              icon="chevron-left"
                              disabled={currentPage === 0}
                              onClick={() => dispatchView({ type: 'page-selected', page: currentPage - 1 })}
                            />
                            <s-button
                              accessibilityLabel={t('settings:translations.next')}
                              icon="chevron-right"
                              disabled={(currentPage + 1) * pageSize >= entries.length}
                              onClick={() => dispatchView({ type: 'page-selected', page: currentPage + 1 })}
                            />
                          </s-stack>
                        </div>
                      </s-box>
                    )}
                  </s-section>
                  <div class="translations-bottom-actions">
                    <s-text color="subdued">{t('settings:translations.fallback')}</s-text>
                    <s-stack direction="inline" gap="small-200">
                      <s-button
                        variant="tertiary"
                        disabled={!editable || changed === 0}
                        onClick={() => void showConfirmation({ kind: 'reset' })}
                      >
                        {t('settings:translations.restoreAll')}
                      </s-button>
                      {selectedLocale !== 'en' && (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          disabled={!editable}
                          onClick={() => void showConfirmation({ kind: 'remove' })}
                        >
                          {t('settings:translations.removeLanguage')}
                        </s-button>
                      )}
                    </s-stack>
                  </div>
                </main>
              </div>
            </div>
          )}
          {dirty && (
            <AdminSaveBar
              id="customer-wording-save-bar"
              dirty={dirty}
              saving={busy}
              canSave={editable && dirty}
              canDiscard={editable && dirty}
              onSave={() => void save()}
              onDiscard={discard}
              saveLabel={t('settings:translations.save')}
              discardDescription={t('settings:translations.leaveDescription')}
              showFallback={false}
            />
          )}
        </>
      )}
      <s-modal
        id="translation-add-language"
        ref={addDialog}
        heading={t('settings:translations.addLanguage')}
        size="small"
      >
        <s-stack gap="base">
          <s-paragraph>{t('settings:translations.addDescription')}</s-paragraph>
          <s-select
            label={t('settings:translations.language')}
            value={language}
            onChange={(event) => {
              setLanguage(event.currentTarget.value);
              setLanguageError(null);
            }}
          >
            {commonLanguageTags
              .filter((tag) => !state.locales.includes(tag))
              .map((tag) => (
                <s-option key={tag} value={tag}>
                  {name(tag)}
                </s-option>
              ))}
            <s-option value="other">{t('settings:translations.otherLanguage')}</s-option>
          </s-select>
          {language === 'other' && (
            <s-text-field
              label={t('settings:translations.languageCode')}
              details={t('settings:translations.languageCodeHelp')}
              value={customLanguage}
              onInput={(event) => {
                setCustomLanguage(event.currentTarget.value);
                setLanguageError(null);
              }}
            />
          )}
          {languageError && <s-text tone="critical">{t(`settings:translations.${languageError}`)}</s-text>}
        </s-stack>
        <s-button slot="primary-action" variant="primary" onClick={addLanguage}>
          {t('settings:translations.addLanguage')}
        </s-button>
        <s-button slot="secondary-actions" commandFor="translation-add-language" command="--hide">
          {t('common:actions.cancel')}
        </s-button>
      </s-modal>
      <s-modal
        ref={confirmDialog}
        id="translation-confirm"
        size="small"
        heading={
          confirmation?.kind === 'clear'
            ? t('settings:translations.resetSavedHeading')
            : confirmation?.kind === 'switch'
              ? t('settings:translations.leaveHeading')
              : confirmation?.kind === 'remove'
                ? t('settings:translations.removeHeading', { language: name(selectedLocale) })
                : t('settings:translations.resetHeading', { language: name(selectedLocale) })
        }
        onHide={() => setConfirmation(null)}
      >
        <s-paragraph>
          {confirmation?.kind === 'clear'
            ? t('settings:translations.resetSavedDescription')
            : confirmation?.kind === 'switch'
              ? t('settings:translations.leaveDescription')
              : confirmation?.kind === 'remove'
                ? t('settings:translations.removeDescription')
                : t('settings:translations.resetDescription')}
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" disabled={busy} onClick={confirm}>
          {confirmation?.kind === 'switch'
            ? t('settings:translations.discardChanges')
            : confirmation?.kind === 'remove'
              ? t('settings:translations.remove')
              : confirmation?.kind === 'reset'
                ? t('settings:translations.restore')
                : t('settings:translations.reset')}
        </s-button>
        <s-button slot="secondary-actions" commandFor="translation-confirm" command="--hide">
          {t(confirmation?.kind === 'switch' ? 'settings:translations.keepEditing' : 'common:actions.cancel')}
        </s-button>
      </s-modal>
    </s-page>
  );
}
export default withAdminLocale(MerchantTranslations);
