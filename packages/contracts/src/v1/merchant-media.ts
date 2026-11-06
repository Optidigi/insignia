import { z } from 'zod';
import { editorProductImageSchema } from './selected-product.js';

export const MerchantMediaDescriptorSchema = z.strictObject({
  image: editorProductImageSchema.extend({
    id: z.string().regex(/^upload_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
  }),
  previewUrl: z.url().refine((value) => value.startsWith('https://')),
  expiresAt: z.iso.datetime(),
});
export const MerchantMediaViewSchema = z.strictObject({ media: z.array(MerchantMediaDescriptorSchema).max(100) });
export type MerchantMediaDescriptor = z.infer<typeof MerchantMediaDescriptorSchema>;
