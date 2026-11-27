import type { SupportedLanguage } from '../core.js';
import type { TranslationCatalog } from '../internal/fixed-translator.js';
import de from './admin-de.js';
import en from './admin-en.js';
import es from './admin-es.js';
import fr from './admin-fr.js';
import it from './admin-it.js';
import nl from './admin-nl.js';

export const adminCatalogs: Readonly<Record<SupportedLanguage, TranslationCatalog>> = { de, en, es, fr, it, nl };
