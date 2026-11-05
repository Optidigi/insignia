import { useAdminLocale } from '../shared/admin-i18n.js';
import type { ProductionSheetResult } from '../shared/production-sheet-render';
import '../styles/production-sheet-preview.css';

export default function ProductionSheetPreview({
  pages,
  pageIndex,
  onPageChange,
}: {
  pages: readonly Pick<ProductionSheetResult['pages'][number], 'label' | 'selectorLabel' | 'url'>[];
  pageIndex: number;
  onPageChange(index: number): void;
}) {
  const { t } = useAdminLocale();
  const page = pages[pageIndex] ?? pages[0];
  if (!page) return null;

  return (
    <s-stack gap="small">
      {pages.length > 1 && (
        <s-select
          label={t('exports:productionSheet.pageSelectLabel')}
          labelAccessibilityVisibility="exclusive"
          value={String(pageIndex)}
          onChange={(event) => {
            const index = Number(event.currentTarget.value);
            if (Number.isInteger(index) && index >= 0 && index < pages.length) onPageChange(index);
          }}
        >
          {pages.map((entry, index) => (
            <s-option key={entry.url} value={String(index)}>
              {entry.selectorLabel ?? entry.label}
            </s-option>
          ))}
        </s-select>
      )}
      <div class="production-sheet-preview-label">
        <s-text color="subdued">{page.label}</s-text>
      </div>
      <s-box padding="small" background="subdued" border="base" borderRadius="base">
        <div class="production-sheet-preview-frame">
          <s-image
            src={page.url}
            alt={page.selectorLabel ?? page.label}
            aspectRatio="1240/1754"
            objectFit="contain"
            inlineSize="fill"
            loading="eager"
          />
        </div>
      </s-box>
    </s-stack>
  );
}
