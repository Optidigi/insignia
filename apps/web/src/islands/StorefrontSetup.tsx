import { useEffect, useState } from 'preact/hooks';
import { useAdminPageReady } from '../shared/admin-page-ready';

export default function StorefrontSetup() {
  const [links, setLinks] = useState<{ button: string; editor: string; repair: string } | null>(null);
  const [initialized, setInitialized] = useState(false);
  useAdminPageReady(initialized);
  useEffect(() => {
    setInitialized(true);
    const shop = (window as unknown as { shopify?: { config?: { shop?: string } } }).shopify?.config?.shop;
    const apiKey = document.querySelector<HTMLMetaElement>('meta[name="shopify-api-key"]')?.content;
    if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !apiKey || !/^[a-f0-9]{32}$/.test(apiKey))
      return;
    const editor = `https://${shop}/admin/themes/current/editor`;
    setLinks({
      editor,
      button: `${editor}?${new URLSearchParams({ template: 'product', addAppBlockId: `${apiKey}/customize`, target: 'mainSection' })}`,
      repair: `${editor}?${new URLSearchParams({ context: 'apps', template: 'product', activateAppId: `${apiKey}/cart-repair` })}`,
    });
  }, []);
  return (
    <s-page inlineSize="small" heading="Storefront setup">
      <s-link slot="breadcrumb-actions" href="/admin/settings">
        Settings
      </s-link>
      <s-section heading="1. Configure and publish a product">
        <s-stack gap="base">
          <s-paragraph>
            Choose the decoration methods, product images, print areas, sizes and prices. Save the draft, review the
            preview, then publish. A product’s Shopify status and its customization publication are separate.
          </s-paragraph>
          <s-link href="/admin/products">Choose a product</s-link>
        </s-stack>
      </s-section>
      <s-section heading="2. Add the customization button">
        <s-stack gap="base">
          <s-paragraph>
            In your product template, add the Insignia customization app block near the product’s purchase controls. Set
            its Button label, choose its position and save the template in Shopify. Only products with an available
            published configuration can offer customization.
          </s-paragraph>
          {links ? (
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" href={links.button} target="_top">
                Add customization button
              </s-button>
              <s-button href={links.editor} target="_top">
                Open theme editor
              </s-button>
            </s-stack>
          ) : (
            <s-paragraph>
              Open this page from Shopify Admin to use theme-editor links. You can also open Online Store → Themes →
              Customize and add the block manually.
            </s-paragraph>
          )}
          <s-paragraph>
            If the block is already present, use Open theme editor to edit it instead of adding another copy. Opening
            the editor is not confirmation that the block is saved or enabled.
          </s-paragraph>
        </s-stack>
      </s-section>
      <s-section heading="3. Enable cart repair and test">
        <s-stack gap="base">
          <s-paragraph>
            Enable the Insignia cart repair app embed in the theme editor and save. Preview a configured product: check
            the button, a complete customization and the cart review flow before making changes available to customers.
          </s-paragraph>
          {links && (
            <s-button href={links.repair} target="_top">
              Set up cart repair embed
            </s-button>
          )}
          <s-banner tone="info">
            Theme placement and button text are managed in Shopify. This page does not claim that your theme is enabled
            or modify it automatically.
          </s-banner>
        </s-stack>
      </s-section>
    </s-page>
  );
}
