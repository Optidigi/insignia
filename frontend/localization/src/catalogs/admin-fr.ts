import type { TranslationCatalog } from '../internal/fixed-translator.js';
import adminPreview from './fr/admin-preview.json' with { type: 'json' };
import adminShell from './fr/admin-shell.json' with { type: 'json' };
import artwork from './fr/artwork.json' with { type: 'json' };
import common from './fr/common.json' with { type: 'json' };
import editor from './fr/editor.json' with { type: 'json' };
import exports from './fr/exports.json' with { type: 'json' };
import home from './fr/home.json' with { type: 'json' };
import methods from './fr/methods.json' with { type: 'json' };
import orders from './fr/orders.json' with { type: 'json' };
import products from './fr/products.json' with { type: 'json' };
import settings from './fr/settings.json' with { type: 'json' };

export default {
  'admin-preview': adminPreview,
  'admin-shell': adminShell,
  artwork,
  common,
  editor,
  exports,
  home,
  methods,
  orders,
  products,
  settings,
} satisfies TranslationCatalog;
