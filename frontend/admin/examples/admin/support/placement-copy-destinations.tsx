/** Compact, inspectable recipient context for the staged copy task. */
import { useState } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import type { PlacementProduct } from './placement-workflow-model.mts';

export default function PlacementCopyDestinations({
  products,
  total,
  busy,
  onChange,
}: {
  products: Pick<PlacementProduct, 'id' | 'title' | 'images'>[];
  total: number;
  busy: boolean;
  onChange?: () => void;
}) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = products.filter((product) =>
    product.title.toLocaleLowerCase(formatLocale).includes(query.trim().toLocaleLowerCase(formatLocale)),
  );
  const pageSize = 10;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const start = currentPage * pageSize;
  const list = (
    <div class="placement-setup-copy__destination-list">
      {filtered.slice(start, start + pageSize).map((product) => (
        <div class="placement-setup-copy__destination" key={product.id}>
          {product.images[0] ? (
            <s-thumbnail src={product.images[0].url} alt="" size="small" />
          ) : (
            <s-icon type="product" />
          )}
          <s-text>{product.title}</s-text>
        </div>
      ))}
      {!filtered.length && (
        <s-text color="subdued">
          {translateUi('editor:placementCopyDestinations.noDestinationProductsMatchYourSearch')}
        </s-text>
      )}
    </div>
  );
  return (
    <section
      class="placement-setup-copy__destination-group"
      aria-label={translateUi('editor:placementCopyDestinations.destinationProducts')}
    >
      <div class="placement-setup-copy__destination-bar">
        <s-text type="strong">
          {translateUi('editor:placementCopyDestinations.destinationCount', {
            count: total,
            formattedCount: new Intl.NumberFormat(formatLocale).format(total),
          })}
        </s-text>
        {onChange && (
          <s-button variant="tertiary" disabled={busy} onClick={onChange}>
            {translateUi('editor:placementCopyDestinations.changeProducts')}
          </s-button>
        )}
      </div>
      {products.length <= 3 ? (
        list
      ) : (
        <details class="placement-setup-copy__destinations">
          <summary>
            {translateUi('editor:placementCopyDestinations.destinationSummary', {
              count: total,
              formattedCount: new Intl.NumberFormat(formatLocale).format(total),
            })}
          </summary>
          <div class="placement-setup-copy__destination-browser">
            {products.length > pageSize && (
              <s-search-field
                label={translateUi('editor:placementCopyDestinations.searchDestinationProducts')}
                labelAccessibilityVisibility="exclusive"
                placeholder={translateUi('editor:placementCopyDestinations.searchDestinationProducts')}
                value={query}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setPage(0);
                }}
              />
            )}
            {list}
            {filtered.length > pageSize && (
              <div class="placement-setup-copy__pagination">
                <s-button
                  icon="chevron-left"
                  variant="tertiary"
                  accessibilityLabel={translateUi('editor:placementCopyDestinations.previousDestinationProducts')}
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                />
                <s-text color="subdued">
                  {translateUi('editor:placementCopyDestinations.destinationRange', {
                    start: new Intl.NumberFormat(formatLocale).format(start + 1),
                    end: new Intl.NumberFormat(formatLocale).format(Math.min(start + pageSize, filtered.length)),
                    total: new Intl.NumberFormat(formatLocale).format(filtered.length),
                  })}
                </s-text>
                <s-button
                  icon="chevron-right"
                  variant="tertiary"
                  accessibilityLabel={translateUi('editor:placementCopyDestinations.nextDestinationProducts')}
                  disabled={start + pageSize >= filtered.length}
                  onClick={() => setPage(currentPage + 1)}
                />
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
