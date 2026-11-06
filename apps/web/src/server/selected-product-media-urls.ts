import { MerchantDraftSchema } from '@insignia/contracts';

/** Only stable owned identities enter authoring storage; signed delivery capabilities stay transient. */
export function selectedMediaUrlsValid(value: unknown, appOrigin: string, productId: string): boolean {
  const parsed = MerchantDraftSchema.safeParse(value);
  if (!parsed.success || !parsed.data.selectedSetup) return true; // The command's full schema validator owns malformed drafts.
  const number = /^gid:\/\/shopify\/Product\/([1-9][0-9]*)$/.exec(productId)?.[1];
  if (!number) return false;
  const origin = new URL(appOrigin).origin;
  function sourceUrl(raw: string, uploadedId?: string) {
    try {
      const url = new URL(raw);
      if (url.username || url.password || url.hash) return false;
      if (uploadedId)
        return (
          url.origin === origin && !url.search && url.pathname === `/api/admin/products/${number}/media/${uploadedId}`
        );
      return (
        (url.protocol === 'https:' && url.hostname === 'cdn.shopify.com' && !url.port) ||
        (url.origin === origin &&
          !url.search &&
          new RegExp(`^/api/admin/products/${number}/media/upload_[a-f0-9-]{36}$`).test(url.pathname))
      );
    } catch {
      return false;
    }
  }
  const product = parsed.data.selectedSetup.product;
  return (
    product.images.every((image) => sourceUrl(image.url, image.id.startsWith('upload_') ? image.id : undefined)) &&
    product.views.every(
      (view) =>
        (!view.imageUrl || sourceUrl(view.imageUrl)) && (!view.calibration || sourceUrl(view.calibration.imageUrl)),
    )
  );
}
