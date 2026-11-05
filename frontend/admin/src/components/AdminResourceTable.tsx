import { type ComponentChildren, createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { useAdminLocale } from '../shared/admin-i18n.js';

type Children = { children: ComponentChildren };
type Format = 'base' | 'currency' | 'numeric';
const SelectionContext = createContext(false);

function revealFocusedControl(event: FocusEvent & { currentTarget: HTMLElement }) {
  const path = event.composedPath();
  if (path.some((node) => node instanceof Element && node.matches('s-popover,s-menu,s-modal,dialog'))) return;
  const cell = path.find((node): node is HTMLTableCellElement => node instanceof HTMLTableCellElement);
  if (!cell || cell.cellIndex === 0) return;
  const target = path.find((node): node is HTMLElement => node instanceof HTMLElement);
  const identity = cell.parentElement?.firstElementChild;
  if (!target || !identity) return;
  const bounds = target.getBoundingClientRect();
  const identityBounds = identity.getBoundingClientRect();
  const obscured =
    getComputedStyle(event.currentTarget).direction === 'rtl'
      ? bounds.right > identityBounds.left - 4
      : bounds.left < identityBounds.right + 4;
  if (obscured) {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/** App-owned table structure keeps columns on phones; all controls remain Polaris.
 * Public s-table only supports auto/list and changes to cards below 490px.
 */
export default function AdminResourceTable({
  children,
  label,
  loading = false,
  paginate = false,
  hasNextPage = false,
  hasPreviousPage = false,
  onNextPage,
  onPreviousPage,
  selection,
  selectionActive = false,
  pinPrimaryColumn = false,
}: Children & {
  label: string;
  loading?: boolean;
  paginate?: boolean;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  onNextPage?: () => void;
  onPreviousPage?: () => void;
  selection?: ComponentChildren;
  selectionActive?: boolean;
  pinPrimaryColumn?: boolean;
}) {
  const { t } = useAdminLocale();
  return (
    <div
      data-resource-table
      aria-busy={loading}
      data-selection-active={selectionActive || undefined}
      data-pinned-primary={pinPrimaryColumn || undefined}
    >
      {selection && (
        <div class="resource-table-selection" aria-hidden={!selectionActive} inert={!selectionActive}>
          <s-box background="base" borderRadius="base">
            <s-box background="subdued" borderRadius="base">
              <div class="resource-table-selection-content">{selection}</div>
            </s-box>
          </s-box>
        </div>
      )}
      <section
        class="resource-table-scroll"
        aria-label={t('admin-shell:shared.table.columnsFor', { tableName: label })}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the named scrollport needs keyboard access in browsers without automatic focus for scrolling regions.
        tabIndex={0}
        onFocusIn={pinPrimaryColumn ? revealFocusedControl : undefined}
      >
        <table class="admin-resource-table" aria-label={label} inert={loading}>
          <SelectionContext.Provider value={selectionActive}>{children}</SelectionContext.Provider>
        </table>
      </section>
      {paginate && (
        <s-box padding="small">
          <s-stack direction="inline" gap="small" justifyContent="center">
            <s-button
              icon="chevron-left"
              accessibilityLabel={t('admin-shell:shared.pagination.previousPage')}
              disabled={loading || !hasPreviousPage}
              onClick={onPreviousPage}
            />
            <s-button
              icon="chevron-right"
              accessibilityLabel={t('admin-shell:shared.pagination.nextPage')}
              disabled={loading || !hasNextPage}
              onClick={onNextPage}
            />
          </s-stack>
        </s-box>
      )}
    </div>
  );
}

export function ResourceTableHead({ children }: Children) {
  return (
    <thead>
      <tr>{children}</tr>
    </thead>
  );
}
export function ResourceTableBody({ children }: Children) {
  return <tbody>{children}</tbody>;
}
export function ResourceTableHeader({
  children,
  format = 'base',
  label,
}: Children & { format?: Format; label?: string }) {
  const selected = useContext(SelectionContext);
  return (
    <th scope="col" data-format={format} aria-label={label ?? (typeof children === 'string' ? children : undefined)}>
      <div class="resource-table-heading-content" inert={selected} aria-hidden={selected || undefined}>
        {typeof children === 'string' ? <s-text>{children}</s-text> : children}
      </div>
    </th>
  );
}
export function ResourceTableCell({
  children,
  format = 'base',
  column,
}: Children & { format?: Format; column?: string }) {
  return (
    <td data-format={format} data-column={column}>
      {typeof children === 'string' || typeof children === 'number' ? <s-text>{children}</s-text> : children}
    </td>
  );
}
export function ResourceTableRow({
  children,
  clickDelegate,
  selected = false,
}: Children & { clickDelegate?: string; selected?: boolean }) {
  function open(event: MouseEvent & { currentTarget: HTMLTableRowElement }) {
    if (!clickDelegate || event.defaultPrevented || event.button !== 0) return;
    // A checkbox, menu or link owns its own interaction, including modifier clicks.
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.matches(
              'a,button,input,select,textarea,s-checkbox,s-button,s-link,s-clickable,s-clickable-chip,s-popover,s-menu,s-modal,s-tooltip',
            ),
        )
    )
      return;
    const link = event.currentTarget.ownerDocument.getElementById(clickDelegate);
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    link?.click();
  }
  return (
    <tr data-selected={selected || undefined} onClick={clickDelegate ? open : undefined}>
      {children}
    </tr>
  );
}
