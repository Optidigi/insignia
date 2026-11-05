import { createHash } from 'node:crypto';
import {
  type ArtworkInspection,
  type ArtworkStorage,
  createMerchantPreviewCapture,
  MerchantPreviewError,
  type MerchantPreviewRecord,
  type MerchantPreviewStore,
} from '@insignia/application';
import type { MerchantMediaDescriptor } from '@insignia/contracts';
import type { AdminActor } from './contracts.js';

export class MerchantMediaError extends Error {
  constructor(code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'AUTHORITY_CHANGED') {
    super(code);
    this.code = code;
  }
  readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE' | 'AUTHORITY_CHANGED';
}
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const imageId = /^upload_([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const png = [137, 80, 78, 71, 13, 10, 26, 10];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function createMerchantMediaService(input: {
  appOrigin: string;
  store: MerchantPreviewStore;
  storage(): Promise<ArtworkStorage>;
  inspect(bytes: Uint8Array): Promise<ArtworkInspection>;
  current(actor: AdminActor, expectedAuthority?: string): Promise<void>;
  product(actor: AdminActor, productId: string): Promise<{ id: string } | null>;
  draftImages(actor: AdminActor, productId: string): Promise<readonly string[]>;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const configured = new URL(input.appOrigin);
  if (configured.protocol !== 'https:' || configured.username || configured.password)
    throw new MerchantMediaError('UNAVAILABLE');
  const origin = configured.origin;
  async function current(actor: AdminActor, expectedAuthority?: string) {
    if (!Number.isFinite(actor.expiresAtMs) || actor.expiresAtMs <= +now()) throw new MerchantMediaError('NOT_FOUND');
    await input.current(actor, expectedAuthority);
    if (actor.expiresAtMs <= +now()) throw new MerchantMediaError('NOT_FOUND');
  }
  async function authorize(
    actor: AdminActor,
    productId: string,
    edit = false,
    verifyProduct = false,
    expectedAuthority?: string,
  ) {
    if (
      !actor.canRead ||
      (edit && !actor.canEdit) ||
      !Number.isFinite(actor.expiresAtMs) ||
      actor.expiresAtMs <= +now() ||
      !/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/.test(productId)
    )
      throw new MerchantMediaError('NOT_FOUND');
    await current(actor, expectedAuthority);
    if (verifyProduct) {
      const product = await input.product(actor, productId);
      if (!product || product.id !== productId) throw new MerchantMediaError('NOT_FOUND');
    }
    await current(actor, expectedAuthority);
  }
  const scope = (actor: AdminActor) => ({
    shopId: actor.tenantShopId,
    installationGeneration: actor.installationGeneration,
    kind: 'merchant' as const,
  });
  async function owned(
    actor: AdminActor,
    productId: string,
    id: string,
    referenced: ReadonlySet<string>,
    cached?: MerchantPreviewRecord | null,
  ): Promise<MerchantPreviewRecord> {
    const parsed = imageId.exec(id);
    if (!parsed?.[1]) throw new MerchantMediaError('INVALID_INPUT');
    const row = cached === undefined ? await input.store.get(scope(actor), parsed[1]) : cached;
    if (
      !row ||
      row.shopId !== actor.tenantShopId ||
      row.installationGeneration !== actor.installationGeneration ||
      row.productId !== productId.split('/').at(-1) ||
      row.imageRevisionId !== id ||
      row.assetId !== parsed[1] ||
      row.state !== 'USABLE' ||
      !row.manifest ||
      (+row.abandonAt <= +now() && !referenced.has(id))
    )
      throw new MerchantMediaError('NOT_FOUND');
    return row;
  }
  async function descriptor(
    actor: AdminActor,
    productId: string,
    row: MerchantPreviewRecord,
    referenced: ReadonlySet<string>,
    storage: ArtworkStorage,
    expectedAuthority?: string,
  ): Promise<MerchantMediaDescriptor> {
    if (!row.manifest) throw new MerchantMediaError('NOT_FOUND');
    const expiresAt = new Date(
      Math.min(+now() + 180_000, actor.expiresAtMs, referenced.has(row.imageRevisionId) ? Infinity : +row.abandonAt),
    );
    if (+expiresAt <= +now()) throw new MerchantMediaError('NOT_FOUND');
    await current(actor, expectedAuthority);
    const previewUrl = await storage.presignRead({ key: row.previewKey, expiresAt });
    const url = new URL(previewUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new MerchantMediaError('UNAVAILABLE');
    await current(actor, expectedAuthority);
    return {
      image: {
        id: row.imageRevisionId,
        url: `${origin}/api/admin/products/${productId.split('/').at(-1)}/media/${row.imageRevisionId}`,
        width: row.manifest.width,
        height: row.manifest.height,
        alt: '',
      },
      previewUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }
  return {
    async upload(
      actor: AdminActor,
      productId: string,
      assetId: string,
      source: Uint8Array,
      expectedAuthority?: string,
    ): Promise<MerchantMediaDescriptor> {
      const bytes = Uint8Array.from(source);
      await authorize(actor, productId, true, true, expectedAuthority);
      if (
        !uuid.test(assetId) ||
        bytes.byteLength < png.length ||
        bytes.byteLength > 5 * 1024 * 1024 ||
        !png.every((byte, index) => bytes[index] === byte)
      )
        throw new MerchantMediaError('INVALID_INPUT');
      const sha = digest(bytes);
      const id = `upload_${assetId}`;
      const prior = await input.store.get(scope(actor), assetId);
      if (
        prior &&
        (prior.productId !== productId.split('/').at(-1) ||
          prior.imageRevisionId !== id ||
          prior.manifest?.sha256 !== sha)
      )
        throw new MerchantMediaError('CONFLICT');
      const storage = await input.storage();
      const capture = createMerchantPreviewCapture({
        store: input.store,
        storage: {
          ...storage,
          putImmutable: async (object) => {
            await current(actor, expectedAuthority);
            await storage.putImmutable(object);
            await current(actor, expectedAuthority);
          },
        },
        clock: now,
        readImage: async (owned, numericProduct, reference) => {
          if (
            owned.shopId !== actor.tenantShopId ||
            owned.installationGeneration !== actor.installationGeneration ||
            numericProduct !== productId.split('/').at(-1) ||
            reference !== id
          )
            throw new MerchantMediaError('CONFLICT');
          await current(actor, expectedAuthority);
          return bytes;
        },
        inspect: async (data) => {
          const inspected = await input.inspect(data);
          await current(actor, expectedAuthority);
          if (inspected.mimeType !== 'image/png' || inspected.originalSha256 !== sha)
            throw new MerchantMediaError('INVALID_INPUT');
          return inspected;
        },
      });
      try {
        const row = await capture.capture(scope(actor), {
          assetId,
          productId: productId.split('/').at(-1) ?? '',
          imageRevisionId: id,
        });
        if (!row) throw new MerchantMediaError('UNAVAILABLE');
        await current(actor, expectedAuthority);
        const referenced = new Set(await input.draftImages(actor, productId));
        return descriptor(
          actor,
          productId,
          await owned(actor, productId, id, referenced),
          referenced,
          storage,
          expectedAuthority,
        );
      } catch (error) {
        if (error instanceof MerchantPreviewError && error.code === 'CONFLICT')
          throw new MerchantMediaError('CONFLICT');
        throw error;
      }
    },
    async read(actor: AdminActor, productId: string, ids: readonly string[]) {
      await authorize(actor, productId);
      if (ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => !imageId.test(id)))
        throw new MerchantMediaError('INVALID_INPUT');
      const referenced = new Set(await input.draftImages(actor, productId));
      const storage = await input.storage();
      const media: MerchantMediaDescriptor[] = [];
      const uploaded = input.store.getUploads
        ? new Map(
            (
              await input.store.getUploads(
                scope(actor),
                productId.split('/').at(-1) ?? '',
                ids.map((id) => id.slice('upload_'.length)),
              )
            ).map((row) => [row.imageRevisionId, row]),
          )
        : null;
      for (const id of ids)
        media.push(
          await descriptor(
            actor,
            productId,
            await owned(actor, productId, id, referenced, uploaded ? (uploaded.get(id) ?? null) : undefined),
            referenced,
            storage,
          ),
        );
      await current(actor);
      return { media };
    },
    async readOriginal(actor: AdminActor, productId: string, id: string): Promise<Uint8Array> {
      await authorize(actor, productId, true);
      const referenced = new Set(await input.draftImages(actor, productId));
      const row = await owned(actor, productId, id, referenced);
      if (!row.manifest) throw new MerchantMediaError('NOT_FOUND');
      const storage = await input.storage();
      await current(actor);
      const bytes = await storage.read({ key: row.originalKey, maxBytes: row.manifest.byteLength });
      if (bytes.byteLength !== row.manifest.byteLength || digest(bytes) !== row.manifest.sha256)
        throw new MerchantMediaError('CONFLICT');
      await current(actor);
      return bytes;
    },
  };
}
export type MerchantMediaService = ReturnType<typeof createMerchantMediaService>;
