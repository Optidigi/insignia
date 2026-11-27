import type { TranslationCatalog } from '../internal/fixed-translator.js';
import adminPreview from './en/admin-preview.json' with { type: 'json' };
import adminShell from './en/admin-shell.json' with { type: 'json' };
import artwork from './en/artwork.json' with { type: 'json' };
import common from './en/common.json' with { type: 'json' };
import editor from './en/editor.json' with { type: 'json' };
import exports from './en/exports.json' with { type: 'json' };
import home from './en/home.json' with { type: 'json' };
import methods from './en/methods.json' with { type: 'json' };
import orders from './en/orders.json' with { type: 'json' };
import products from './en/products.json' with { type: 'json' };
import settings from './en/settings.json' with { type: 'json' };

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
