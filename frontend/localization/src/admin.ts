import { adminCatalogs } from './catalogs/admin.js';
import { createAdminLocalization } from './internal/admin-localization.js';

export {
  type AdminControllerOptions,
  type AdminLocaleController,
  type AdminLocaleSnapshot,
  type AdminMessage,
  type AdminMessageKey,
  type AdminTranslationParams,
  type AdminTranslator,
  type AdminTranslatorOptions,
  adminMessage,
} from './internal/admin-localization.js';

export const { createAdminLocaleController, createAdminTranslator } = createAdminLocalization(adminCatalogs);
