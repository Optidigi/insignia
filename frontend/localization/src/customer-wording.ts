import { customerCatalogs } from './catalogs/customer.js';
import common from './catalogs/en/common.json' with { type: 'json' };
import customer from './catalogs/en/customer.json' with { type: 'json' };
import { resolveLocale } from './core.js';
import type { CustomerMessageTable } from './generated/catalog-types.js';
import { customerParameterContracts } from './generated/customer-parameters.js';

type CatalogMessageKey = keyof CustomerMessageTable & string;

export type CustomerWordingPluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type CustomerWordingForm = 'message' | CustomerWordingPluralForm;
export type CustomerWordingParameterType = 'string' | 'number';

export interface CustomerWordingParameter {
  readonly name: string;
  readonly type: CustomerWordingParameterType;
}

export interface CustomerWordingManifestEntry {
  /** Stable, namespaced base key. Plural suffixes are represented by `sourceForms`. */
  readonly key: CatalogMessageKey;
  readonly namespace: 'common' | 'customer';
  readonly group: Readonly<{ id: string; label: string }>;
  /** Human-readable fallback label derived from the final catalog key segment. */
  readonly label: string;
  readonly kind: 'message' | 'plural';
  readonly sourceForms: Readonly<Partial<Record<CustomerWordingForm, string>>>;
  readonly parameters: readonly CustomerWordingParameter[];
}

export type CustomerWordingOverlay = Readonly<{
  /** Exact, canonical storefront locale tag. It does not advertise a built-in catalog. */
  locale: string;
  /** Sparse customer-only copy, keyed by stable base message ID and form. */
  messages: Readonly<Partial<Record<CatalogMessageKey, Readonly<Partial<Record<CustomerWordingForm, string>>>>>>;
}>;

export type CustomerWordingIssueCode =
  | 'invalid-record'
  | 'invalid-locale'
  | 'noncanonical-locale'
  | 'reserved-locale'
  | 'unknown-key'
  | 'invalid-forms'
  | 'unknown-form'
  | 'invalid-text'
  | 'text-too-long'
  | 'markup-not-allowed'
  | 'placeholder-mismatch';

export interface CustomerWordingIssue {
  readonly code: CustomerWordingIssueCode;
  readonly key?: string;
  readonly form?: string;
}

export type CustomerWordingValidation =
  | { readonly status: 'valid'; readonly overlay: CustomerWordingOverlay }
  | { readonly status: 'invalid'; readonly issues: readonly CustomerWordingIssue[] };

const formOrder: readonly CustomerWordingPluralForm[] = Object.freeze(['zero', 'one', 'two', 'few', 'many', 'other']);
const pluralSuffix = /_(zero|one|two|few|many|other)$/;
const placeholderPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const markupPattern = /<\s*\/?\s*[A-Za-z][^<>]*>/;
const maxTextLength = 4000;
interface CatalogBranch {
  readonly [key: string]: CatalogNode;
}
type CatalogNode = string | CatalogBranch;
type Catalogs = Readonly<Record<'common' | 'customer', CatalogNode>>;
type ParameterContracts = Readonly<Record<string, Readonly<Record<string, CustomerWordingParameterType>>>>;

const sourceCatalogs: Catalogs = { common, customer };
const sourceContracts = customerParameterContracts as ParameterContracts;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function titleWords(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Customer message';
  const humanized = words.map((word) => word.toLowerCase());
  const first = humanized[0];
  if (first !== undefined) humanized[0] = `${first[0]?.toUpperCase() ?? ''}${first.slice(1)}`;
  return humanized.join(' ');
}

const commonGroupLabels: Readonly<Record<string, string>> = Object.freeze({
  actions: 'Shared actions',
  counts: 'Shared counts',
  resources: 'Shared resources',
  summary: 'Shared status',
});

const customerGroupLabels: Readonly<Record<string, string>> = Object.freeze({
  artwork: 'Artwork',
  chrome: 'Designer controls',
  files: 'Files',
  options: 'Options',
  placements: 'Placements',
  positioning: 'Positioning',
  quantities: 'Quantities',
  recovery: 'Recovery',
  review: 'Review',
  steps: 'Steps',
  theme: 'Theme',
  validation: 'Validation',
});

function groupFor(namespace: 'common' | 'customer', path: string): CustomerWordingManifestEntry['group'] {
  const firstSegment = path.split('.')[0] ?? 'general';
  const label =
    namespace === 'common'
      ? (commonGroupLabels[firstSegment] ?? `Shared ${titleWords(firstSegment).toLowerCase()}`)
      : (customerGroupLabels[firstSegment] ?? titleWords(firstSegment));
  return Object.freeze({ id: `${namespace}.${firstSegment}`, label });
}

function sourceLeafMessages(catalogs: Catalogs): Map<string, string> {
  const messages = new Map<string, string>();
  function collect(namespace: 'common' | 'customer', node: CatalogNode, prefix: string): void {
    if (typeof node === 'string') {
      messages.set(`${namespace}:${prefix}`, node);
      return;
    }
    for (const [key, child] of Object.entries(node)) collect(namespace, child, prefix ? `${prefix}.${key}` : key);
  }
  for (const namespace of ['common', 'customer'] as const) collect(namespace, catalogs[namespace], '');
  return messages;
}

function buildManifest(catalogs: Catalogs, contracts: ParameterContracts): readonly CustomerWordingManifestEntry[] {
  const leaves = sourceLeafMessages(catalogs);
  const regular = new Map<string, Readonly<Record<string, string>>>();
  const plurals = new Map<string, { namespace: 'common' | 'customer'; path: string; forms: Record<string, string> }>();

  for (const [qualifiedKey, source] of leaves) {
    const separator = qualifiedKey.indexOf(':');
    const namespace = qualifiedKey.slice(0, separator) as 'common' | 'customer';
    const path = qualifiedKey.slice(separator + 1);
    const suffix = pluralSuffix.exec(path);
    if (suffix?.[1]) {
      const basePath = path.slice(0, -suffix[0].length);
      const key = `${namespace}:${basePath}`;
      const group = plurals.get(key) ?? { namespace, path: basePath, forms: {} };
      group.forms[suffix[1]] = source;
      plurals.set(key, group);
    } else {
      regular.set(qualifiedKey, { message: source });
    }
  }

  for (const [key, value] of plurals) {
    if (regular.has(key)) throw new Error(`Customer wording source has both a message and plural forms for ${key}`);
    if (!value.forms.other) throw new Error(`Customer wording source is missing its other form for ${key}`);
    regular.set(key, Object.freeze({ ...value.forms }));
  }

  const entries = [...regular.entries()].map(([key, sourceForms]) => {
    const separator = key.indexOf(':');
    const namespace = key.slice(0, separator) as 'common' | 'customer';
    const path = key.slice(separator + 1);
    const segments = path.split('.');
    const leaf = segments.at(-1) ?? '';
    const contract = contracts[key];
    if (contract === undefined) throw new Error(`Customer wording source is missing its parameter contract for ${key}`);
    const parameters = Object.entries(contract)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, type]) => Object.freeze({ name, type }));
    const frozenSource = Object.freeze({ ...sourceForms }) as CustomerWordingManifestEntry['sourceForms'];
    const isPlural = Object.hasOwn(frozenSource, 'other');
    if (isPlural && !Object.hasOwn(frozenSource, 'one')) {
      throw new Error(`English customer wording source is missing its one form for ${key}`);
    }
    return Object.freeze({
      key: key as CatalogMessageKey,
      namespace,
      group: groupFor(namespace, path),
      label: titleWords(leaf),
      kind: isPlural ? 'plural' : 'message',
      sourceForms: frozenSource,
      parameters: Object.freeze(parameters),
    }) satisfies CustomerWordingManifestEntry;
  });

  return Object.freeze(entries.sort((left, right) => left.key.localeCompare(right.key)));
}

export const CUSTOMER_WORDING_MANIFEST = buildManifest(sourceCatalogs, sourceContracts);
const manifestByKey = new Map(CUSTOMER_WORDING_MANIFEST.map((entry) => [entry.key, entry]));

/** Lists the form fields required by the target locale. Invalid plural locales return no forms. */
export function requiredCustomerWordingForms(
  entry: CustomerWordingManifestEntry,
  locale: string,
): readonly CustomerWordingForm[] {
  if (entry.kind === 'message') return Object.freeze(['message'] as const);
  try {
    const categories = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    return Object.freeze(formOrder.filter((form) => categories.has(form)));
  } catch {
    return Object.freeze([]);
  }
}

/** Selects the target plural category for a validated interpolation count. */
export function customerWordingFormForCount(
  entry: CustomerWordingManifestEntry,
  locale: string,
  count: number,
): CustomerWordingPluralForm | null {
  if (entry.kind !== 'plural' || !Number.isSafeInteger(count) || count < 0) return null;
  try {
    return new Intl.PluralRules(locale).select(count) as CustomerWordingPluralForm;
  } catch {
    return null;
  }
}

/** Uses the exact English source form where available, then `other` for added target plural forms. */
export function customerWordingSourceText(entry: CustomerWordingManifestEntry, form: CustomerWordingForm): string {
  return entry.sourceForms[form] ?? entry.sourceForms.other ?? entry.sourceForms.message ?? '';
}

/** Uninterpolated built-in wording for one form; unsupported authoring locales use English. */
export function customerWordingDefaultText(
  entry: CustomerWordingManifestEntry,
  form: CustomerWordingForm,
  requestedLocale: string,
): string {
  const resolved = resolveLocale(requestedLocale);
  const language = resolved.activeLanguage === 'en-XA' ? 'en' : resolved.activeLanguage;
  const path = entry.key.slice(entry.key.indexOf(':') + 1).split('.');
  if (entry.kind === 'plural') path[path.length - 1] = `${path.at(-1)}_${form}`;
  let node: unknown = customerCatalogs[language][entry.namespace];
  for (const segment of path) node = isRecord(node) ? node[segment] : undefined;
  return typeof node === 'string' ? node : customerWordingSourceText(entry, form);
}

function placeholderCounts(value: string): ReadonlyMap<string, number> | null {
  const counts = new Map<string, number>();
  for (const match of value.matchAll(placeholderPattern)) {
    const name = match[1];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (/\{\{|\}\}/.test(value.replace(placeholderPattern, ''))) return null;
  return counts;
}

function samePlaceholders(source: string, target: string): boolean {
  const sourceCounts = placeholderCounts(source);
  const targetCounts = placeholderCounts(target);
  if (!sourceCounts || !targetCounts || sourceCounts.size !== targetCounts.size) return false;
  return [...sourceCounts].every(([name, count]) => targetCounts.get(name) === count);
}

function issue(code: CustomerWordingIssueCode, key?: string, form?: string): CustomerWordingIssue {
  return Object.freeze({ code, ...(key !== undefined ? { key } : {}), ...(form !== undefined ? { form } : {}) });
}

function inspectLocale(locale: unknown): { canonical: string | null; issue: CustomerWordingIssueCode | null } {
  if (typeof locale !== 'string' || locale.length === 0 || locale.length > 128)
    return { canonical: null, issue: 'invalid-locale' };
  try {
    const canonical = Intl.getCanonicalLocales(locale)[0] ?? null;
    if (canonical === null) return { canonical: null, issue: 'invalid-locale' };
    if (canonical !== locale) return { canonical: null, issue: 'noncanonical-locale' };
    if (['en-XA', 'en-XB', 'und'].includes(canonical)) return { canonical: null, issue: 'reserved-locale' };
    if (Intl.PluralRules.supportedLocalesOf([locale]).length !== 1) return { canonical: null, issue: 'invalid-locale' };
    return { canonical, issue: null };
  } catch {
    return { canonical: null, issue: 'invalid-locale' };
  }
}

/** Validates and freezes a sparse overlay before it reaches the customer translator or storage. */
export function validateCustomerWordingOverlay(value: unknown): CustomerWordingValidation {
  const issues: CustomerWordingIssue[] = [];
  if (!isRecord(value)) return { status: 'invalid', issues: Object.freeze([issue('invalid-record')]) };
  if (Object.keys(value).some((key) => key !== 'locale' && key !== 'messages')) issues.push(issue('invalid-record'));

  const inspectedLocale = inspectLocale(value.locale);
  const locale = inspectedLocale.canonical;
  if (inspectedLocale.issue) issues.push(issue(inspectedLocale.issue));

  if (!isRecord(value.messages)) {
    issues.push(issue('invalid-record'));
    return { status: 'invalid', issues: Object.freeze(issues) };
  }

  const messages: Partial<Record<CatalogMessageKey, Partial<Record<CustomerWordingForm, string>>>> = {};
  for (const [key, rawForms] of Object.entries(value.messages)) {
    const entry = manifestByKey.get(key as CatalogMessageKey);
    if (!entry) {
      issues.push(issue('unknown-key', key));
      continue;
    }
    if (!isRecord(rawForms)) {
      issues.push(issue('invalid-forms', key));
      continue;
    }
    const forms: Partial<Record<CustomerWordingForm, string>> = {};
    const allowedForms = locale === null ? [] : requiredCustomerWordingForms(entry, locale);
    for (const [form, rawText] of Object.entries(rawForms)) {
      if (!allowedForms.includes(form as CustomerWordingForm)) {
        issues.push(issue('unknown-form', key, form));
        continue;
      }
      if (typeof rawText !== 'string') {
        issues.push(issue('invalid-text', key, form));
        continue;
      }
      if (rawText.trim().length === 0) continue;
      if (rawText.length > maxTextLength) {
        issues.push(issue('text-too-long', key, form));
        continue;
      }
      if (markupPattern.test(rawText)) {
        issues.push(issue('markup-not-allowed', key, form));
        continue;
      }
      if (!samePlaceholders(customerWordingSourceText(entry, form as CustomerWordingForm), rawText)) {
        issues.push(issue('placeholder-mismatch', key, form));
        continue;
      }
      forms[form as CustomerWordingForm] = rawText;
    }
    if (Object.keys(forms).length) messages[key as CatalogMessageKey] = Object.freeze(forms);
  }

  if (issues.length || locale === null) return { status: 'invalid', issues: Object.freeze(issues) };
  return {
    status: 'valid',
    overlay: Object.freeze({ locale, messages: Object.freeze(messages) }),
  };
}

function assignPath(root: Record<string, unknown>, path: readonly string[], value: string): void {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = path.at(-1);
  if (leaf) current[leaf] = value;
}

/** Fills exact-locale custom copy with its built-in language baseline, or English for unsupported locales. */
export function customerWordingCatalog(overlay: CustomerWordingOverlay): Readonly<Record<string, CatalogNode>> {
  const catalog: { common: Record<string, unknown>; customer: Record<string, unknown> } = {
    common: {},
    customer: {},
  };
  const overrides = overlay.messages;
  for (const entry of CUSTOMER_WORDING_MANIFEST) {
    const path = entry.key.slice(entry.key.indexOf(':') + 1).split('.');
    const customForms = overrides[entry.key];
    if (entry.kind === 'message') {
      const value = customForms?.message ?? customerWordingDefaultText(entry, 'message', overlay.locale);
      assignPath(catalog[entry.namespace], path, value);
      continue;
    }
    for (const form of requiredCustomerWordingForms(entry, overlay.locale)) {
      const value = customForms?.[form] ?? customerWordingDefaultText(entry, form, overlay.locale);
      assignPath(catalog[entry.namespace], [...path.slice(0, -1), `${path.at(-1)}_${form}`], value);
    }
  }
  return Object.freeze({
    common: catalog.common as CatalogNode,
    customer: catalog.customer as CatalogNode,
  });
}

/** True only for locales all relevant Intl formatters can use without falling back. */
export function customerIntlSupports(locale: string): boolean {
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

const rtlLanguages = new Set([
  'ar',
  'arc',
  'ckb',
  'dv',
  'fa',
  'he',
  'khw',
  'ks',
  'ku',
  'ps',
  'sd',
  'syr',
  'ug',
  'ur',
  'yi',
]);
const rtlScripts = new Set(['Adlm', 'Arab', 'Hebr', 'Mand', 'Mend', 'Nkoo', 'Rohg', 'Samr', 'Syrc', 'Thaa']);

/** Direction inferred from a canonical customer tag; callers with host direction may override it. */
export function customerDirectionForLocale(locale: string): 'ltr' | 'rtl' {
  const parts = locale.split('-');
  const script = parts.find((part) => /^[A-Z][a-z]{3}$/.test(part));
  if (script) return rtlScripts.has(script) ? 'rtl' : 'ltr';
  const language = parts[0]?.toLowerCase();
  return language && rtlLanguages.has(language) ? 'rtl' : 'ltr';
}
