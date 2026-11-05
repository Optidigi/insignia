import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';

interface ToolbarFilter {
  label: string;
  content: ComponentChildren;
  count?: number;
  text?: string;
  inlineSize?: HTMLElementTagNameMap['s-popover']['inlineSize'];
}
interface Props {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  maxLength: number;
  loading?: boolean;
  onInput: (value: string) => void;
  onSubmit?: (value: string) => void;
  filter?: ToolbarFilter;
  clearLabel?: string;
  loadingLabel?: string;
  resultStatus?: string;
  actions?: ComponentChildren;
  appliedFilters?: ComponentChildren;
}

/** App-owned search surface. Public Polaris owns all actions and overlays.
 * A standard input avoids copying Shopify's private contenteditable query editor.
 */
export default function AdminIndexToolbar({
  id,
  label,
  placeholder = label,
  value,
  maxLength,
  loading = false,
  onInput,
  onSubmit,
  filter,
  clearLabel,
  loadingLabel,
  resultStatus,
  actions,
  appliedFilters,
}: Props) {
  const { t, formatLocale } = useAdminLocale();
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [draft, setDraft] = useState(value);
  useLayoutEffect(() => {
    if (!composing.current) setDraft(value);
  }, [value]);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    // Bind the platform's lowercase events explicitly; Preact's JSX event
    // casing does not normalize composition events in every browser.
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
      setDraft(field.value);
      onInput(field.value);
    };
    field.addEventListener('compositionstart', start);
    field.addEventListener('compositionend', end);
    return () => {
      field.removeEventListener('compositionstart', start);
      field.removeEventListener('compositionend', end);
    };
  }, [onInput]);
  function clear() {
    setDraft('');
    onInput('');
    onSubmit?.('');
    input.current?.focus({ preventScroll: true });
  }
  return (
    <div class="admin-index-toolbar">
      <div class="admin-index-search">
        {filter && (
          <div class="admin-index-filter-trigger">
            <div class="admin-index-filter-desktop">
              <s-button icon="filter" variant="tertiary" commandFor={`${id}-filters`} accessibilityLabel={filter.label}>
                <s-text>
                  {filter.text ?? t('admin-shell:shared.filters.defaultLabel')}
                  {filter.count
                    ? t('admin-shell:shared.filters.withCount', {
                        formattedCount: new Intl.NumberFormat(formatLocale).format(filter.count),
                      })
                    : ''}
                </s-text>
              </s-button>
            </div>
            <div class="admin-index-filter-mobile">
              <s-button
                icon="filter"
                variant="tertiary"
                commandFor={`${id}-filters`}
                accessibilityLabel={filter.label}
              />
            </div>
          </div>
        )}
        <div class="admin-index-search-glyph">
          {loading ? (
            <s-spinner size="base" accessibilityLabel={loadingLabel ?? t('admin-shell:shared.loading.results')} />
          ) : (
            <s-icon type="search" color="subdued" />
          )}
        </div>
        <input
          ref={input}
          type="search"
          id={`${id}-query`}
          name={`${id}-query`}
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          maxLength={maxLength}
          autoComplete="off"
          spellcheck={false}
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            if (!composing.current) onInput(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.isComposing || composing.current) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit?.(event.currentTarget.value);
            }
            if (event.key === 'Escape' && event.currentTarget.value) {
              event.preventDefault();
              clear();
            }
          }}
        />
        <div class="admin-index-clear" data-empty={!draft || undefined}>
          <s-button
            icon="x"
            variant="tertiary"
            accessibilityLabel={clearLabel ?? t('admin-shell:shared.search.clear')}
            disabled={!draft}
            onClick={clear}
          />
        </div>
        {actions && <div class="admin-index-actions">{actions}</div>}
      </div>
      {filter && (
        <s-popover id={`${id}-filters`} inlineSize={filter.inlineSize ?? '280px'}>
          <div class="admin-index-overlay-scroll">
            <s-box padding="base">
              <s-stack gap="base">{filter.content}</s-stack>
            </s-box>
          </div>
        </s-popover>
      )}
      <div class="admin-index-status" role="status" aria-atomic="true">
        {loading ? '' : resultStatus}
      </div>
      {appliedFilters && <div class="admin-index-applied">{appliedFilters}</div>}
    </div>
  );
}

/** Applied filters edit through their label and clear through Polaris' remove control. */
export function AdminFilterChip({
  toolbarId,
  label,
  children,
  disabled = false,
  onRemove,
}: {
  toolbarId: string;
  label: string;
  children: ComponentChildren;
  disabled?: boolean;
  onRemove(): void;
}) {
  return (
    <s-clickable-chip
      removable
      commandFor={`${toolbarId}-filters`}
      accessibilityLabel={label}
      disabled={disabled}
      onRemove={() => {
        onRemove();
        requestAnimationFrame(() => document.getElementById(`${toolbarId}-query`)?.focus({ preventScroll: true }));
      }}
    >
      {children}
    </s-clickable-chip>
  );
}
