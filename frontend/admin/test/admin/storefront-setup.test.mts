import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storefrontLinks, themeSetupStatus } from '../../src/shared/storefront-setup.ts';

test('one active storefront embed qualifies automatic button placement without a per-template manual block', () => {
  const status = themeSetupStatus([{
    type: 'theme_app_extension', activations: [{
      handle: 'cart-repair', target: 'body', status: 'active',
      activations: [{ target: 'theme/123', themeId: 'gid://shopify/OnlineStoreTheme/123' }],
    }],
  }]);
  assert.equal(status, 'active');
});

test('automatic setup opens the one storefront embed activation without a theme write or duplicate manual block', () => {
  const links = storefrontLinks('example.myshopify.com', '1'.repeat(32));
  assert(links);
  assert.deepEqual(Object.fromEntries(new URL(links.activate).searchParams), {
    context: 'apps', template: 'product', activateAppId: `${'1'.repeat(32)}/cart-repair`,
  });
  assert.deepEqual(Object.fromEntries(new URL(links.embeds).searchParams), { context: 'apps', template: 'product' });
  // One embed owns the Customize button and cart review: there is exactly one activation link.
  assert.deepEqual(
    Object.values(links).filter((href) => new URL(href).searchParams.has('activateAppId')),
    [links.activate],
  );
});

test('the optional product block link adds the customization block to the product main section', () => {
  const links = storefrontLinks('example.myshopify.com', '1'.repeat(32));
  assert(links);
  const url = new URL(links.productBlock);
  assert.equal(url.origin + url.pathname, 'https://example.myshopify.com/admin/themes/current/editor');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    template: 'product', addAppBlockId: `${'1'.repeat(32)}/customize`, target: 'mainSection',
  });
  // Plain editor links never propose a theme change.
  assert.equal(new URL(links.editor).searchParams.has('addAppBlockId'), false);
});

test('a missing or contradictory embed observation never claims activation', () => {
  for (const value of [[], [{type:'theme_app_extension',activations:[]}], [{
    type:'theme_app_extension',activations:[{handle:'cart-repair',target:'body',status:'active',activations:[]}],
  }]]) assert.equal(themeSetupStatus(value), 'unknown');
});
