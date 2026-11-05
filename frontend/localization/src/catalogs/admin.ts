import type { SupportedLanguage } from '../core.js';
import type { TranslationCatalog } from '../internal/fixed-translator.js';
import deAdminPreview from './de/admin-preview.json' with { type: 'json' };
import deAdminShell from './de/admin-shell.json' with { type: 'json' };
import deArtwork from './de/artwork.json' with { type: 'json' };
import deCommon from './de/common.json' with { type: 'json' };
import deEditor from './de/editor.json' with { type: 'json' };
import deExports from './de/exports.json' with { type: 'json' };
import deHome from './de/home.json' with { type: 'json' };
import deMethods from './de/methods.json' with { type: 'json' };
import deOrders from './de/orders.json' with { type: 'json' };
import deProducts from './de/products.json' with { type: 'json' };
import deSettings from './de/settings.json' with { type: 'json' };
import enAdminPreview from './en/admin-preview.json' with { type: 'json' };
import enAdminShell from './en/admin-shell.json' with { type: 'json' };
import enArtwork from './en/artwork.json' with { type: 'json' };
import enCommon from './en/common.json' with { type: 'json' };
import enEditor from './en/editor.json' with { type: 'json' };
import enExports from './en/exports.json' with { type: 'json' };
import enHome from './en/home.json' with { type: 'json' };
import enMethods from './en/methods.json' with { type: 'json' };
import enOrders from './en/orders.json' with { type: 'json' };
import enProducts from './en/products.json' with { type: 'json' };
import enSettings from './en/settings.json' with { type: 'json' };
import esAdminPreview from './es/admin-preview.json' with { type: 'json' };
import esAdminShell from './es/admin-shell.json' with { type: 'json' };
import esArtwork from './es/artwork.json' with { type: 'json' };
import esCommon from './es/common.json' with { type: 'json' };
import esEditor from './es/editor.json' with { type: 'json' };
import esExports from './es/exports.json' with { type: 'json' };
import esHome from './es/home.json' with { type: 'json' };
import esMethods from './es/methods.json' with { type: 'json' };
import esOrders from './es/orders.json' with { type: 'json' };
import esProducts from './es/products.json' with { type: 'json' };
import esSettings from './es/settings.json' with { type: 'json' };
import frAdminPreview from './fr/admin-preview.json' with { type: 'json' };
import frAdminShell from './fr/admin-shell.json' with { type: 'json' };
import frArtwork from './fr/artwork.json' with { type: 'json' };
import frCommon from './fr/common.json' with { type: 'json' };
import frEditor from './fr/editor.json' with { type: 'json' };
import frExports from './fr/exports.json' with { type: 'json' };
import frHome from './fr/home.json' with { type: 'json' };
import frMethods from './fr/methods.json' with { type: 'json' };
import frOrders from './fr/orders.json' with { type: 'json' };
import frProducts from './fr/products.json' with { type: 'json' };
import frSettings from './fr/settings.json' with { type: 'json' };
import itAdminPreview from './it/admin-preview.json' with { type: 'json' };
import itAdminShell from './it/admin-shell.json' with { type: 'json' };
import itArtwork from './it/artwork.json' with { type: 'json' };
import itCommon from './it/common.json' with { type: 'json' };
import itEditor from './it/editor.json' with { type: 'json' };
import itExports from './it/exports.json' with { type: 'json' };
import itHome from './it/home.json' with { type: 'json' };
import itMethods from './it/methods.json' with { type: 'json' };
import itOrders from './it/orders.json' with { type: 'json' };
import itProducts from './it/products.json' with { type: 'json' };
import itSettings from './it/settings.json' with { type: 'json' };
import nlAdminPreview from './nl/admin-preview.json' with { type: 'json' };
import nlAdminShell from './nl/admin-shell.json' with { type: 'json' };
import nlArtwork from './nl/artwork.json' with { type: 'json' };
import nlCommon from './nl/common.json' with { type: 'json' };
import nlEditor from './nl/editor.json' with { type: 'json' };
import nlExports from './nl/exports.json' with { type: 'json' };
import nlHome from './nl/home.json' with { type: 'json' };
import nlMethods from './nl/methods.json' with { type: 'json' };
import nlOrders from './nl/orders.json' with { type: 'json' };
import nlProducts from './nl/products.json' with { type: 'json' };
import nlSettings from './nl/settings.json' with { type: 'json' };

export const adminCatalogs: Readonly<Record<SupportedLanguage, TranslationCatalog>> = {
  en: {
    common: enCommon,
    'admin-shell': enAdminShell,
    home: enHome,
    products: enProducts,
    methods: enMethods,
    editor: enEditor,
    orders: enOrders,
    settings: enSettings,
    artwork: enArtwork,
    exports: enExports,
    'admin-preview': enAdminPreview,
  },
  nl: {
    common: nlCommon,
    'admin-shell': nlAdminShell,
    home: nlHome,
    products: nlProducts,
    methods: nlMethods,
    editor: nlEditor,
    orders: nlOrders,
    settings: nlSettings,
    artwork: nlArtwork,
    exports: nlExports,
    'admin-preview': nlAdminPreview,
  },
  de: {
    common: deCommon,
    'admin-shell': deAdminShell,
    home: deHome,
    products: deProducts,
    methods: deMethods,
    editor: deEditor,
    orders: deOrders,
    settings: deSettings,
    artwork: deArtwork,
    exports: deExports,
    'admin-preview': deAdminPreview,
  },
  fr: {
    common: frCommon,
    'admin-shell': frAdminShell,
    home: frHome,
    products: frProducts,
    methods: frMethods,
    editor: frEditor,
    orders: frOrders,
    settings: frSettings,
    artwork: frArtwork,
    exports: frExports,
    'admin-preview': frAdminPreview,
  },
  es: {
    common: esCommon,
    'admin-shell': esAdminShell,
    home: esHome,
    products: esProducts,
    methods: esMethods,
    editor: esEditor,
    orders: esOrders,
    settings: esSettings,
    artwork: esArtwork,
    exports: esExports,
    'admin-preview': esAdminPreview,
  },
  it: {
    common: itCommon,
    'admin-shell': itAdminShell,
    home: itHome,
    products: itProducts,
    methods: itMethods,
    editor: itEditor,
    orders: itOrders,
    settings: itSettings,
    artwork: itArtwork,
    exports: itExports,
    'admin-preview': itAdminPreview,
  },
};
