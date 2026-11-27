import type { TranslationCatalog } from '../internal/fixed-translator.js';
import adminPreview from './nl/admin-preview.json' with { type: 'json' };
import adminShell from './nl/admin-shell.json' with { type: 'json' };
import artwork from './nl/artwork.json' with { type: 'json' };
import common from './nl/common.json' with { type: 'json' };
import editor from './nl/editor.json' with { type: 'json' };
import exports from './nl/exports.json' with { type: 'json' };
import home from './nl/home.json' with { type: 'json' };
import methods from './nl/methods.json' with { type: 'json' };
import orders from './nl/orders.json' with { type: 'json' };
import products from './nl/products.json' with { type: 'json' };
import settings from './nl/settings.json' with { type: 'json' };

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
