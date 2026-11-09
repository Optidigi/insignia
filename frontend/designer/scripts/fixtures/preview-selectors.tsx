import { render } from 'preact';
import { configSchema } from '../../src/config';
import { Designer } from '../../src/designer';
import { createProductModel } from '../../src/model';
import type { Artwork } from '../../src/model';
import type { DesignerPorts } from '../../src/runtime';
import '../../src/style.css';
import '../../src/theme.css';
import '../../src/polish.css';
import '../../src/review.css';

const parameters = new URLSearchParams(location.search);
const named = parameters.get('palette') === 'named';
const missingSwatches = parameters.get('palette') === 'missing';
const count = Number(parameters.get('views') ?? 3);
const config = configSchema.parse({
  id: 'preview-selector-fixture', name: 'Preview selector fixture',
  description: 'Product preview selector regression fixture.',
  storeName: 'Fixture store', productName: 'Fixture product',
  productDescription: 'Product preview selector regression fixture.',
  basePrice: 1000, currency: 'EUR', locale: 'en-GB',
  garment: 'tshirt', preview: 'illustration', maxQuantity: 99, artworkLater: false,
  optionPresentation: {
    rowOption: { label: 'Colour', display: named ? 'named-choice' : 'swatch' },
    columnOption: { label: 'Size' },
  },
  sizes: [{ id: 'small', label: 'Small' }],
  colors: [
    { id: 'white', name: 'Warm white with a very long merchant supplied finish name', ...(!named && !missingSwatches && { hex: '#ffffff' }), availableSizeIds: ['small'] },
    { id: 'navy', name: 'Midnight navy with a very long merchant supplied finish name', ...(!named && !missingSwatches && { hex: '#102030' }), availableSizeIds: ['small'] },
  ],
  views: [
    { id: 'front', label: 'Front with a very long merchant supplied view name', illustration: 'front' },
    { id: 'back', label: 'Back with a very long merchant supplied view name', illustration: 'back' },
    { id: 'left', label: 'Left sleeve', illustration: 'left' },
    { id: 'right', label: 'Right sleeve', illustration: 'right' },
  ].slice(0, count),
  positions: [{
    id: 'front-print', name: 'Front print', view: 'front', x: 50, y: 45, width: 20,
    movementArea: { x: 50, y: 45, width: 40, height: 40 },
    price: 100, dimensions: [10], sizePrices: [100], methodIds: ['screen'],
  }],
  methods: [{ id: 'screen', label: 'Screen printing', surcharge: 0 }],
});
const artwork: Artwork = {
  id: 'fixture-artwork', name: 'fixture-logo.svg', width: 10, height: 10,
  url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpath fill='red' d='M0 0h10v10H0z'/%3E%3C/svg%3E",
};
const ports: DesignerPorts = {
  artwork: { upload: async () => { throw new Error('Not used by selector checks'); } },
  cart: { commit: async () => { throw new Error('Not used by selector checks'); } },
};
render(<Designer
  config={config} ports={ports} isOpen onOpenChange={() => undefined}
  initialPrints={[{ ...createProductModel(config).initialPrint('front-print'), artworkId: artwork.id }]}
  initialArtworks={[artwork]} locale="en-GB"
/>, document.getElementById('root')!);
