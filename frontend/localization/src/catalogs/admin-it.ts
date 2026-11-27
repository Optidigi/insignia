import type { TranslationCatalog } from '../internal/fixed-translator.js';
import adminPreview from './it/admin-preview.json' with { type: 'json' };
import adminShell from './it/admin-shell.json' with { type: 'json' };
import artwork from './it/artwork.json' with { type: 'json' };
import common from './it/common.json' with { type: 'json' };
import editor from './it/editor.json' with { type: 'json' };
import exports from './it/exports.json' with { type: 'json' };
import home from './it/home.json' with { type: 'json' };
import methods from './it/methods.json' with { type: 'json' };
import orders from './it/orders.json' with { type: 'json' };
import products from './it/products.json' with { type: 'json' };
import settings from './it/settings.json' with { type: 'json' };

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
