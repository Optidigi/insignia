import type { SupportedLanguage } from '../core.js';
import type { TranslationCatalog } from '../internal/fixed-translator.js';
import deCommon from './de/common.json' with { type: 'json' };
import deGuestArtwork from './de/guest-artwork.json' with { type: 'json' };
import enCommon from './en/common.json' with { type: 'json' };
import enGuestArtwork from './en/guest-artwork.json' with { type: 'json' };
import esCommon from './es/common.json' with { type: 'json' };
import esGuestArtwork from './es/guest-artwork.json' with { type: 'json' };
import frCommon from './fr/common.json' with { type: 'json' };
import frGuestArtwork from './fr/guest-artwork.json' with { type: 'json' };
import itCommon from './it/common.json' with { type: 'json' };
import itGuestArtwork from './it/guest-artwork.json' with { type: 'json' };
import nlCommon from './nl/common.json' with { type: 'json' };
import nlGuestArtwork from './nl/guest-artwork.json' with { type: 'json' };

export const guestCatalogs: Readonly<Record<SupportedLanguage, TranslationCatalog>> = {
  en: { common: enCommon, 'guest-artwork': enGuestArtwork },
  nl: { common: nlCommon, 'guest-artwork': nlGuestArtwork },
  de: { common: deCommon, 'guest-artwork': deGuestArtwork },
  fr: { common: frCommon, 'guest-artwork': frGuestArtwork },
  es: { common: esCommon, 'guest-artwork': esGuestArtwork },
  it: { common: itCommon, 'guest-artwork': itGuestArtwork },
};
