import type { I18nextToolkitConfig } from 'i18next-cli';

/**
 * The CLI handles source-language literals in selected TSX. Astro and Liquid
 * templates are checked by verify-copy-source.mts because the CLI does not
 * parse those file types.
 */
const config = {
  locales: ['en'],
  extract: {
    input: [
      'frontend/admin/src/**/*.{ts,tsx}',
      'frontend/admin/examples/admin/support/method-dialog.tsx',
      'frontend/admin/examples/admin/support/method-index.tsx',
      'frontend/admin/examples/admin/support/method-product-picker.tsx',
      'frontend/admin/examples/admin/support/method-summary.tsx',
      'frontend/admin/examples/admin/support/method-workflow-preview.tsx',
      'frontend/admin/examples/admin/support/placement-copy-destinations.tsx',
      'frontend/admin/examples/admin/support/placement-image-picker.tsx',
      'frontend/admin/examples/admin/support/placement-method-manager.tsx',
      'frontend/admin/examples/admin/support/placement-setup-copy-dialog.tsx',
      'frontend/admin/examples/admin/support/placement-setup-copy-entry.tsx',
      'frontend/admin/examples/admin/support/placement-setup-copy-review.tsx',
      'frontend/admin/examples/admin/support/placement-variant-photo-panel.tsx',
      'frontend/admin/examples/admin/support/placement-workflow-canvas.tsx',
      'frontend/admin/examples/admin/support/placement-workflow-preview.tsx',
    ],
    output: 'packages/localization/src/catalogs/{{language}}/{{namespace}}.json',
    defaultNS: false,
    primaryLanguage: 'en',
    nsSeparator: ':',
    functions: ['t', '*.t', 'adminMessage', 'customerMessage', 'guestMessage'],
  },
  lint: {
    acceptedTags: ['all'],
    acceptedAttributes: [
      'accessibilityLabel',
      'accessibilityDescription',
      'alt',
      'aria-description',
      'aria-label',
      'aria-valuetext',
      'buttonLabel',
      'caption',
      'description',
      'details',
      'emptyLabel',
      'error',
      'errorMessage',
      'heading',
      'helpText',
      'hint',
      'info',
      'label',
      'message',
      'placeholder',
      'summary',
      'subheading',
      'text',
      'title',
      'viewAllLabel',
    ],
    ignoredTags: ['code', 'pre', 'script', 'style'],
    checkConcatenation: 'error',
    checkPunctuationConcatenation: 'error',
  },
} satisfies I18nextToolkitConfig;

export default config;
