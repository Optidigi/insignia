import type { ProductConfigurationSummary } from './admin-view.js';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function names(value: unknown, labels: unknown, key: 'methods' | 'placements'): string[] | null {
  const entries = record(value)?.[key];
  if (!Array.isArray(entries)) return null;
  const map = record(record(labels)?.[key]);
  return entries.map((entry: unknown) => {
    const id = record(entry)?.id;
    const label = typeof id === 'string' ? map?.[id] : undefined;
    return typeof label === 'string' && label.trim()
      ? label
      : key === 'methods'
        ? 'Method unavailable'
        : 'Location unavailable';
  });
}
/** Effective revision values cannot be replaced by newer, unpublished saved edits. */
export function productConfigurationSummary(
  config: {
    effectiveRevisionId: string | null;
    draftValue?: unknown;
    effectivePublishedValue?: unknown;
    effectivePresentation?: unknown;
  } | null,
): ProductConfigurationSummary {
  if (!config) return { state: 'not_configured', methods: [], locations: [] };
  const published = !!config.effectiveRevisionId;
  const value = published ? config.effectivePublishedValue : config.draftValue;
  const labels = record(published ? config.effectivePresentation : value)?.labels;
  return {
    state: published ? 'published' : 'draft',
    methods: names(value, labels, 'methods'),
    locations: names(value, labels, 'placements'),
  };
}
