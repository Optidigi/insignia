/** Explicit inheritance belongs to mutable drafts, never published revisions. */
export type MethodField = { source: 'catalog' | 'product'; value: string };
export type MethodReview = {
  reason: 'unassigned' | 'deleted';
  catalogVersion: string;
  decision: 'pending' | 'keep';
  assignmentKey?: string;
};
export type MethodDraftBinding = {
  catalogMethodId: string;
  observedVersion: string;
  name: MethodField;
  explanation: MethodField;
  translations: Record<string, { name?: MethodField; explanation?: MethodField }>;
  prices: Record<string, MethodField>;
  review: MethodReview | null;
};
type CurrentMethod = {
  configuration: {
    id: string;
    name: string;
    explanation: string;
    pricing: 'fixed' | 'product';
    amount: string;
    translations?: Record<string, { name?: string; explanation?: string }>;
  };
  version: string;
};
const inherited = (field: MethodField, value: string): MethodField => ({
  source: field.source,
  value: field.source === 'catalog' ? value : field.value,
});

export function reconcileMethodBinding(
  previous: MethodDraftBinding,
  current: CurrentMethod | null,
  assigned: boolean,
  assignmentKey?: string,
  updatePrices = true,
): MethodDraftBinding {
  // Keeping a deleted catalog copy makes it independent, even if that UUID is later reused.
  if (previous.review?.reason === 'deleted') {
    current = null;
    assignmentKey = previous.review.assignmentKey;
  }
  if (current && current.configuration.id !== previous.catalogMethodId)
    throw new Error('Method catalog identity mismatch');
  const value = current?.configuration;
  const version = current?.version ?? previous.observedVersion;
  const reason = !current ? 'deleted' : !assigned ? 'unassigned' : null;
  const review: MethodReview | null =
    reason === null
      ? null
      : {
          reason,
          catalogVersion: version,
          ...(assignmentKey === undefined ? {} : { assignmentKey }),
          decision:
            previous.review?.reason === reason &&
            (assignmentKey === undefined
              ? previous.review.catalogVersion === version
              : previous.review.assignmentKey === assignmentKey)
              ? previous.review.decision
              : 'pending',
        };
  const resolvedName = inherited(previous.name, value?.name ?? previous.name.value);
  const resolvedExplanation = inherited(previous.explanation, value?.explanation ?? previous.explanation.value);
  const translations: MethodDraftBinding['translations'] = Object.fromEntries(
    Object.entries(previous.translations).map(([locale, fields]) => [
      locale,
      {
        ...(fields.name
          ? {
              name: inherited(
                fields.name,
                value ? (value.translations?.[locale]?.name ?? resolvedName.value) : fields.name.value,
              ),
            }
          : {}),
        ...(fields.explanation
          ? {
              explanation: inherited(
                fields.explanation,
                value
                  ? (value.translations?.[locale]?.explanation ?? resolvedExplanation.value)
                  : fields.explanation.value,
              ),
            }
          : {}),
      },
    ]),
  );
  if (value)
    for (const [locale, fields] of Object.entries(value.translations ?? {})) {
      const prior = translations[locale] ?? {};
      translations[locale] = {
        ...prior,
        ...(fields.name !== undefined && !prior.name ? { name: { source: 'catalog', value: fields.name } } : {}),
        ...(fields.explanation !== undefined && !prior.explanation
          ? { explanation: { source: 'catalog', value: fields.explanation } }
          : {}),
      };
    }
  return {
    catalogMethodId: previous.catalogMethodId,
    observedVersion: version,
    name: resolvedName,
    explanation: resolvedExplanation,
    translations,
    prices: Object.fromEntries(
      Object.entries(previous.prices).map(([key, field]) => [
        key,
        inherited(field, value && updatePrices ? (value.pricing === 'fixed' ? value.amount : '') : field.value),
      ]),
    ),
    review,
  };
}

/** Remove returns no binding; keep acknowledges only the exact reviewed source state. */
export function reviewMethodBinding(
  binding: MethodDraftBinding,
  decision: 'keep' | 'remove',
): MethodDraftBinding | null {
  if (decision === 'remove') return null;
  if (binding.review?.reason === 'deleted') {
    const independent = (field: MethodField): MethodField => ({ source: 'product', value: field.value });
    return {
      ...binding,
      name: independent(binding.name),
      explanation: independent(binding.explanation),
      translations: Object.fromEntries(
        Object.entries(binding.translations).map(([locale, fields]) => [
          locale,
          {
            ...(fields.name ? { name: independent(fields.name) } : {}),
            ...(fields.explanation ? { explanation: independent(fields.explanation) } : {}),
          },
        ]),
      ),
      prices: Object.fromEntries(Object.entries(binding.prices).map(([key, field]) => [key, independent(field)])),
      review: { ...binding.review, decision: 'keep' },
    };
  }
  return { ...binding, review: binding.review ? { ...binding.review, decision: 'keep' } : null };
}
