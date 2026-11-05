/** Deterministic local-only large catalog fixture. Synthetic entries borrow original demo images and config links. */
import type { MethodConfiguration, MethodProduct } from './method-configuration.mts';

const catalogSize = 60;
const printingCount = 36;
const embroideryCount = 20;
const printingMethodId = 'demo-method-printing';
const embroideryMethodId = 'demo-method-embroidery';
const embroideryTag = 'Embroidery';
const ranges = ['Staff', 'Teamwear', 'Workwear', 'Club', 'Hospitality', 'Event', 'Volunteer', 'Corporate'];
const styles = ['Classic', 'Essential', 'Relaxed', 'Premium', 'Lightweight', 'Heavyweight'];

export const methodCatalogDemoCollections = {
  tShirts: { id: 'demo-collection-t-shirts', title: 'T-shirts' },
  hoodies: { id: 'demo-collection-hoodies', title: 'Hoodies' },
  polos: { id: 'demo-collection-polos', title: 'Polos' },
  teamwear: { id: 'demo-collection-teamwear', title: 'Teamwear' },
  workwear: { id: 'demo-collection-workwear', title: 'Workwear' },
};

export type MethodCatalogDemoProduct = MethodProduct & { configurationProductId?: string };

function sampleCollectionsFor(garment: string, range: string): { id: string; title: string }[] {
  const garmentCollection = /hoodie/i.test(garment)
    ? methodCatalogDemoCollections.hoodies
    : /polo/i.test(garment)
      ? methodCatalogDemoCollections.polos
      : methodCatalogDemoCollections.tShirts;
  const rangeCollection = ['Teamwear', 'Club', 'Event', 'Volunteer', 'Corporate'].includes(range)
    ? methodCatalogDemoCollections.teamwear
    : methodCatalogDemoCollections.workwear;
  return [{ ...garmentCollection }, { ...rangeCollection }];
}

export function createMethodCatalogDemo(base: { methods: MethodConfiguration[]; products: MethodProduct[] }): {
  methods: MethodConfiguration[];
  products: MethodCatalogDemoProduct[];
} {
  if (base.products.length < 3) throw new Error('The Methods catalog demo needs three original garment templates.');
  const templates = base.products.slice(0, 3);
  if (templates.some((product) => !product.image))
    throw new Error('The Methods catalog demo needs all three garment images.');

  const products: MethodCatalogDemoProduct[] = base.products.map((product) => ({
    ...product,
    tags: [...product.tags],
    ...(product.collections ? { collections: product.collections.map((collection) => ({ ...collection })) } : {}),
    setup: product.setup.map((setup) => ({ ...setup })),
  }));
  const ids = new Set(products.map((product) => product.id));
  const titles = new Set(products.map((product) => product.title.toLocaleLowerCase()));
  const templateUse = [0, 0, 0];
  let nextClone = 1;
  while (products.length < catalogSize) {
    const templateIndex = (nextClone - 1) % templates.length;
    const template = templates[templateIndex];
    if (!template) throw new Error('The Methods catalog demo could not select a garment template.');
    const variantIndex = templateUse[templateIndex] ?? 0;
    templateUse[templateIndex] = variantIndex + 1;
    let id = `demo-catalog-${products.length + 1}`;
    while (ids.has(id)) id = `demo-catalog-${products.length + nextClone++}`;
    ids.add(id);
    const garment = template.title.match(/\b(t-?shirt|hoodie|polo)\b/i)?.[0] ?? template.title;
    const normalizedGarment =
      garment.toLocaleLowerCase() === 'tshirt' ? 'T-shirt' : `${garment[0]?.toLocaleUpperCase()}${garment.slice(1)}`;
    const style = styles[Math.floor(variantIndex / ranges.length) % styles.length];
    const range = ranges[variantIndex % ranges.length];
    if (!range) throw new Error('The Methods catalog demo could not select a product range.');
    const baseTitle = `${style} ${normalizedGarment} — ${range}`;
    let title = baseTitle;
    let suffix = 2;
    while (titles.has(title.toLocaleLowerCase())) title = `${baseTitle} ${suffix++}`;
    titles.add(title.toLocaleLowerCase());
    products.push({
      id,
      title,
      image: template.image,
      tags: [...template.tags],
      collections: sampleCollectionsFor(normalizedGarment, range),
      setup: template.setup.map((setup) => ({ ...setup })),
      configurationProductId: template.id,
    });
    nextClone++;
  }

  const methods: MethodConfiguration[] = [
    {
      id: printingMethodId,
      name: 'Screen printing',
      explanation: 'Full-colour print on selected products.',
      pricing: 'fixed',
      amount: '4.50',
      assignment: 'manual',
      productIds: products.slice(0, printingCount).map((product) => product.id),
      tags: [],
      tagMatch: 'any',
    },
    {
      id: embroideryMethodId,
      name: 'Embroidery',
      explanation: 'Stitched decoration for products tagged Embroidery.',
      pricing: 'product',
      amount: '',
      assignment: 'tags',
      productIds: [],
      tags: [embroideryTag],
      tagMatch: 'any',
    },
  ];

  return {
    methods,
    products: products.map((product, index) => {
      const tags = product.tags.filter((tag) => tag.toLocaleLowerCase() !== embroideryTag.toLocaleLowerCase());
      if (index < embroideryCount) tags.push(embroideryTag);

      const setup = product.setup.filter(
        (entry) => entry.methodId !== printingMethodId && entry.methodId !== embroideryMethodId,
      );
      if (index < printingCount) {
        const missingLocations = index % 7 === 0;
        const locations = missingLocations ? 0 : 1 + (index % 3);
        setup.push({ methodId: printingMethodId, locations, pricedLocations: locations });
      }
      if (index < embroideryCount) {
        const missingLocations = index % 6 === 0;
        const locations = missingLocations ? 0 : 1 + (index % 2);
        const missingPrices = !missingLocations && index % 5 === 1;
        setup.push({
          methodId: embroideryMethodId,
          locations,
          pricedLocations: missingPrices ? locations - 1 : locations,
        });
      }
      return { ...product, tags, setup };
    }),
  };
}
