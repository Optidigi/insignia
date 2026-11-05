import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintAstroSource, lintLiquidSchema, lintTsxSource } from './verify-copy-source.mts';

test('TSX copy lint catches visible text, Polaris copy props and hidden accessible names', () => {
  const issues = lintTsxSource(
    `const view = <s-button accessibilityLabel="Save the order" accessibilityDescription="Saves this order." details="Applies to every view of this product." aria-label="Save the order" placeholder="Search products" id="save" href="/admin/orders" value="ready" data-testid="save">Save order</s-button>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-attribute', 'accessibilityLabel: Save the order'],
      ['tsx-attribute', 'accessibilityDescription: Saves this order.'],
      ['tsx-attribute', 'details: Applies to every view of this product.'],
      ['tsx-attribute', 'aria-label: Save the order'],
      ['tsx-attribute', 'placeholder: Search products'],
      ['tsx-text', 'Save order'],
    ],
  );
});

test('TSX copy lint leaves translations and technical values alone but catches interpolated raw prose', () => {
  const issues = lintTsxSource(
    `const view = <><s-page aria-label="Insignia"><s-button id="cancel" href="/admin" value="save" aria-describedby="save-help">{t('common:actions.save')}</s-button><s-tooltip title={isOpen ? 'Close dialog' : 'Open dialog'} /><s-text>{'Unsaved changes'}</s-text></s-page></>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-attribute', 'title: Close dialog'],
      ['tsx-attribute', 'title: Open dialog'],
      ['tsx-text', 'Unsaved changes'],
    ],
  );
});

test('TSX copy lint checks static values selected from inline object and array lookups', () => {
  const issues = lintTsxSource(
    `const view = <><s-badge>{{ clean: 'All changes saved', dirty: 'Unsaved changes', saving: 'Saving changes…' }[saveState]}</s-badge><s-text>{['Ready for review', 'Changes saved'][statusIndex]}</s-text></>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'All changes saved'],
      ['tsx-text', 'Unsaved changes'],
      ['tsx-text', 'Saving changes…'],
      ['tsx-text', 'Ready for review'],
      ['tsx-text', 'Changes saved'],
    ],
  );
});

test('TSX copy lint resolves local constant labels without following merchant data or enum comparisons', () => {
  const issues = lintTsxSource(
    `const fallback = 'Outer app label'; function Panel({ label, product, status }: { label: string; product: { name: string }; status: string }) { const statusLabel = status === 'ready' ? 'Ready for review' : 'Changes saved'; const merchantLabel = label; const productTitle = product.name; return <><s-badge>{statusLabel}</s-badge><s-text>{merchantLabel}</s-text><s-text>{productTitle}</s-text><s-text>{fallback}</s-text></>; }`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'Ready for review'],
      ['tsx-text', 'Changes saved'],
      ['tsx-text', 'Outer app label'],
    ],
  );
});

test('TSX copy lint does not confuse lookup keys or technical enum comparisons with visible labels', () => {
  const issues = lintTsxSource(
    `const view = <><s-text>{({ ready: 'Ready', waiting: 'Waiting' }[order.status])}</s-text><s-text>{order.status === 'artwork-needed' ? 'Artwork needed' : 'Artwork ready'}</s-text><s-text>{product.name}</s-text></>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'Ready'],
      ['tsx-text', 'Waiting'],
      ['tsx-text', 'Artwork needed'],
      ['tsx-text', 'Artwork ready'],
    ],
  );
});

test('TSX copy lint walks JSX nested in visible branches but ignores their technical conditions', () => {
  const issues = lintTsxSource(
    `const view = <>{saveState === 'dirty' ? <s-badge>Unsaved changes</s-badge> : <s-badge>All changes saved</s-badge>}{order.status === 'artwork-needed' && <s-text>Artwork needed</s-text>}</>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'Unsaved changes'],
      ['tsx-text', 'All changes saved'],
      ['tsx-text', 'Artwork needed'],
    ],
  );
});

test('TSX copy lint does not mistake a translation-key guard for rendered copy', () => {
  const issues = lintTsxSource(
    `const statusMessageKey = { dirty: 'editor:notice.unsaved', clean: 'editor:notice.saved' }[saveState]; const view = statusMessageKey && <s-paragraph>{t(statusMessageKey)}</s-paragraph>;`,
    'fixture.tsx',
  );
  assert.deepEqual(issues, []);
});

test('TSX copy lint leaves physical key legends stable but still checks their accessible names', () => {
  const issues = lintTsxSource(
    `const view = <><kbd>Shift</kbd><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Z</kbd><kbd>Delete artwork</kbd><kbd>{'Z'}</kbd><span>Shift</span><kbd aria-label="Control key">Ctrl</kbd><kbd aria-label="Shift">Alt</kbd></>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'Delete artwork'],
      ['tsx-text', 'Shift'],
      ['tsx-attribute', 'aria-label: Control key'],
      ['tsx-attribute', 'aria-label: Shift'],
    ],
  );
});

test('TSX copy lint exempts only A/B inside the hidden calibration SVG', () => {
  const issues = lintTsxSource(
    `const view = <><svg class="placement-calibration-line" aria-hidden="true"><text>A</text><text>B</text><text>Calibration points</text><text>C</text></svg><svg class="placement-calibration-line"><text>A</text></svg><svg aria-hidden="true"><text>B</text></svg><div aria-hidden="true"><span>A</span></div></>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'Calibration points'],
      ['tsx-text', 'C'],
      ['tsx-text', 'A'],
      ['tsx-text', 'B'],
      ['tsx-text', 'A'],
    ],
  );
});

test('TSX copy lint leaves UTC alone only as a timezone fallback identifier', () => {
  const issues = lintTsxSource(
    `const page = maybePage; const timeZone = page?.timeZone ?? 'UTC'; const caption = labelValue ?? 'UTC'; const view = <><s-text>{timeZone}</s-text><s-text>{caption}</s-text><s-text>UTC</s-text></>;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-text', 'UTC'],
      ['tsx-text', 'UTC'],
    ],
  );
});

test('Astro copy lint parses template text and text props while excluding code and frontmatter', () => {
  const issues = lintAstroSource(
    `---\nconst internal = 'not UI copy';\n---\n<s-page aria-label="Order settings"><s-button>Save changes</s-button><pre>shopify://admin</pre><style>.body { color: red }</style></s-page>`,
    'fixture.astro',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['astro-attribute', 'aria-label: Order settings'],
      ['astro-text', 'Save changes'],
    ],
  );
});

test('Liquid schema lint requires localized display fields, resolves Shopify t: keys and keeps protocol defaults', () => {
  const locale = {
    blocks: {
      customize: {
        name: 'Insignia customization',
        button_label: 'Button label',
        button_default: 'Customize this product',
        proxy_prefix: 'App proxy prefix',
      },
    },
  };
  const valid = `{% schema %}{"name":"t:blocks.customize.name","settings":[{"type":"text","id":"button_label","label":"t:blocks.customize.button_label","default":"t:blocks.customize.button_default"},{"type":"text","id":"proxy_prefix","label":"t:blocks.customize.proxy_prefix","default":"insignia"}]}{% endschema %}`;
  assert.deepEqual(lintLiquidSchema(valid, locale, 'customize.liquid'), []);

  const incomplete = `{% schema %}{"name":"Customize product","settings":[{"type":"text","id":"button_label","label":"Button label","default":"Customize this product"},{"type":"select","id":"theme","label":"t:blocks.missing.theme","options":[{"value":"primary","label":"Primary"}]}]}{% endschema %}`;
  assert.deepEqual(
    lintLiquidSchema(incomplete, locale, 'customize.liquid').map(({ kind, text }) => [kind, text]),
    [
      ['liquid-schema-copy', 'name: Customize product'],
      ['liquid-schema-copy', 'settings.0.label: Button label'],
      ['liquid-schema-copy', 'settings.0.default: Customize this product'],
      ['liquid-schema-key', 't:blocks.missing.theme'],
      ['liquid-schema-copy', 'settings.1.options.0.label: Primary'],
    ],
  );
});

test('TSX copy lint catches UI sentences assembled with an inline array join', () => {
  const issues = lintTsxSource(
    `const view = <s-text-field label={['Value', index + 1, 'name'].join(' ')} />;`,
    'fixture.tsx',
  );
  assert.deepEqual(
    issues.map(({ kind, text }) => [kind, text]),
    [
      ['tsx-attribute', 'label: Value'],
      ['tsx-attribute', 'label: name'],
    ],
  );
  assert.deepEqual(
    lintTsxSource(
      `const view = <s-text>{[t('common:actions.save'), product.title].join(' · ')}</s-text>;`,
      'fixture.tsx',
    ),
    [],
  );
});
