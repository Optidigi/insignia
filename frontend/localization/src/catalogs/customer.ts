import type { SupportedLanguage } from '../core.js';
import type { TranslationCatalog } from '../internal/fixed-translator.js';
import deCommon from './de/common.json' with { type: 'json' };
import deCustomer from './de/customer.json' with { type: 'json' };
import enCommon from './en/common.json' with { type: 'json' };
import enCustomer from './en/customer.json' with { type: 'json' };
import esCommon from './es/common.json' with { type: 'json' };
import esCustomer from './es/customer.json' with { type: 'json' };
import frCommon from './fr/common.json' with { type: 'json' };
import frCustomer from './fr/customer.json' with { type: 'json' };
import itCommon from './it/common.json' with { type: 'json' };
import itCustomer from './it/customer.json' with { type: 'json' };
import nlCommon from './nl/common.json' with { type: 'json' };
import nlCustomer from './nl/customer.json' with { type: 'json' };

export const customerCatalogs: Readonly<Record<SupportedLanguage, TranslationCatalog>> = {
  en: { common: enCommon, customer: enCustomer },
  nl: { common: nlCommon, customer: nlCustomer },
  de: { common: deCommon, customer: deCustomer },
  fr: { common: frCommon, customer: frCustomer },
  es: { common: esCommon, customer: esCustomer },
  it: { common: itCommon, customer: itCustomer },
};
