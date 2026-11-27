import type { TranslationCatalog } from '../internal/fixed-translator.js';
import adminPreview from './de/admin-preview.json' with { type: 'json' };
import adminShell from './de/admin-shell.json' with { type: 'json' };
import artwork from './de/artwork.json' with { type: 'json' };
import common from './de/common.json' with { type: 'json' };
import editor from './de/editor.json' with { type: 'json' };
import exports from './de/exports.json' with { type: 'json' };
import home from './de/home.json' with { type: 'json' };
import methods from './de/methods.json' with { type: 'json' };
import orders from './de/orders.json' with { type: 'json' };
import products from './de/products.json' with { type: 'json' };
import settings from './de/settings.json' with { type: 'json' };

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
