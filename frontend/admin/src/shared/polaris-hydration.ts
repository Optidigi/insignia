import type { ClientDirective } from 'astro';

declare module 'astro' {
  interface AstroClientDirectives {
    'client:polaris'?: boolean;
  }
}

/** Bind custom events only after Polaris defines their public element properties. */
const hydratePolaris: ClientDirective = async (load) => {
  const [hydrate] = await Promise.all([load(), customElements.whenDefined('s-page')]);
  await hydrate();
};

export default hydratePolaris;
