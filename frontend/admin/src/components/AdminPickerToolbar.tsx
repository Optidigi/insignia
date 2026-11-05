import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';

export interface AdminPickerSearchOption {
  value: string;
  label: string;
}

export interface AdminPickerSearchBy {
  value: string;
  options: AdminPickerSearchOption[];
  onChange(value: string): void;
}

export interface AdminPickerFilter {
  label: string;
  content: ComponentChildren;
  inlineSize: '100px' | '280px';
  onOpen(): void;
}

/** Public Polaris search row for product and resource pickers. */
export default function AdminPickerToolbar({
  id,
  searchLabel,
  query,
  onQueryChange,
  searchBy,
  filter,
  appliedFilters,
  resultStatus,
}: {
  id: string;
  searchLabel: string;
  query: string;
  onQueryChange(value: string): void;
  searchBy?: AdminPickerSearchBy;
  filter?: AdminPickerFilter;
  appliedFilters?: ComponentChildren;
  resultStatus?: string;
}) {
  const { t } = useAdminLocale();
  const [filterOpen, setFilterOpen] = useState(false);
  const filterOpenRef = useRef(false);
  const filterPopover = useRef<HTMLElementTagNameMap['s-popover']>(null);

  return (
    <div class="admin-picker-toolbar">
      <div class={`admin-picker-toolbar__search-row${searchBy ? '' : ' admin-picker-toolbar__search-row--single'}`}>
        <s-search-field
          id={`${id}-query`}
          name={`${id}-query`}
          label={searchLabel}
          labelAccessibilityVisibility="exclusive"
          placeholder={searchLabel}
          value={query}
          maxLength={100}
          autocomplete="off"
          onInput={(event) => onQueryChange(event.currentTarget.value)}
        />
        {searchBy && (
          <s-select
            name={`${id}-search-by`}
            label={t('admin-shell:shared.search.searchBy')}
            labelAccessibilityVisibility="exclusive"
            value={searchBy.value}
            onChange={(event) => searchBy.onChange(event.currentTarget.value)}
          >
            {searchBy.options.map((option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ))}
          </s-select>
        )}
      </div>
      {(filter || appliedFilters) && (
        <div class="admin-picker-toolbar__filter-row">
          {appliedFilters && <div class="admin-picker-toolbar__applied">{appliedFilters}</div>}
          {filter && (
            <div class="admin-picker-toolbar__filter-trigger">
              {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Polaris s-button exposes button semantics through its public component. */}
              <s-button
                id={`${id}-filter-trigger`}
                variant="tertiary"
                icon="plus"
                commandFor={`${id}-filters`}
                command="--toggle"
                accessibilityLabel={filter.label}
                aria-controls={`${id}-filters`}
                aria-expanded={filterOpen}
                onClick={() => {
                  if (!filterOpenRef.current) filter.onOpen();
                }}
              >
                {t('admin-shell:shared.filters.add')}
              </s-button>
            </div>
          )}
        </div>
      )}
      {filter && (
        <s-popover
          ref={filterPopover}
          id={`${id}-filters`}
          inlineSize={filter.inlineSize}
          onShow={() => {
            filterOpenRef.current = true;
            setFilterOpen(true);
          }}
          onHide={() => {
            filterOpenRef.current = false;
            setFilterOpen(false);
          }}
          onAfterShow={() => {
            requestAnimationFrame(() =>
              filterPopover.current?.querySelector<HTMLElement>('s-search-field, s-clickable, s-button')?.focus(),
            );
          }}
        >
          <s-box padding="small">{filter.content}</s-box>
        </s-popover>
      )}
      {resultStatus && (
        <div class="admin-picker-toolbar__status" role="status" aria-atomic="true">
          {resultStatus}
        </div>
      )}
    </div>
  );
}
