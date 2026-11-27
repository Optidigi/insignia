import type { TranslationCatalog } from '../internal/fixed-translator.js';
import adminPreview from './es/admin-preview.json' with { type: 'json' };
import adminShell from './es/admin-shell.json' with { type: 'json' };
import artwork from './es/artwork.json' with { type: 'json' };
import common from './es/common.json' with { type: 'json' };
import editor from './es/editor.json' with { type: 'json' };
import exports from './es/exports.json' with { type: 'json' };
import home from './es/home.json' with { type: 'json' };
import methods from './es/methods.json' with { type: 'json' };
import orders from './es/orders.json' with { type: 'json' };
import products from './es/products.json' with { type: 'json' };
import settings from './es/settings.json' with { type: 'json' };

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
