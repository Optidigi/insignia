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
  assert.deepEqual(status, { button: 'active', cart: 'active' });
});

test('automatic setup opens the existing embed activation without a theme write or duplicate manual block', () => {
  const links = storefrontLinks('example.myshopify.com', '1'.repeat(32));
  assert(links);
  assert.deepEqual(Object.fromEntries(new URL(links.button).searchParams), {
    context: 'apps', template: 'product', activateAppId: `${'1'.repeat(32)}/cart-repair`,
  });
});

test('a missing or contradictory embed observation never claims activation', () => {
  for (const value of [[], [{type:'theme_app_extension',activations:[]}], [{
    type:'theme_app_extension',activations:[{handle:'cart-repair',target:'body',status:'active',activations:[]}],
  }]]) assert.deepEqual(themeSetupStatus(value), {button:'unknown',cart:'unknown'});
});
