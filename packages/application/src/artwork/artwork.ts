import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { localDay, type QuoteArtworkPort } from '../quote/accept-quote.js';

export const ARTWORK_POLICY = {
  maxBytes: 5 * 1024 * 1024,
  uploadMs: 300_000,
  incompleteMs: 86_400_000,
  retainedMs: 7 * 86_400_000,
  leaseMs: 360_000,
  previewMaxBytes: 2 * 1024 * 1024,
} as const;
export type ArtworkMime = 'image/svg+xml' | 'image/png' | 'image/jpeg';
export type ArtworkState =
  | 'UPLOADING'
  | 'QUEUED'
  | 'INSPECTING'
  | 'PROMOTING'
  | 'USABLE'
  | 'REJECTED'
  | 'DELETING'
  | 'DELETED';
export type ArtworkScope = {
  shopId: string;
  installationGeneration: string;
  kind: 'merchant' | 'guest';
  ownerHash?: string;
};
export type ArtworkManifest = {
  version: 'm6-inspection-v1';
  mimeType: ArtworkMime;
  byteLength: number;
  sha256: string;
  width: number;
  height: number;
  previewSha256: string;
  previewByteLength: number;
};
export type ArtworkRecord = {
  assetId: string;
  shopId: string;
  installationGeneration: string;
  ownerHash: string;
  declaredMime: ArtworkMime;
  declaredBytes: number;
  state: ArtworkState;
  quarantineKey: string;
  originalKey: string;
  previewKey: string;
  collectedAt: Date;
  uploadUntil: Date;
  expiresAt: Date;
  claimId: string | null;
  manifest: ArtworkManifest | null;
  rejection: string | null;
};
export interface ArtworkStore {
  create(input: ArtworkRecord): Promise<ArtworkRecord>;
  get(scope: ArtworkScope, assetId: string): Promise<ArtworkRecord | null>;
  complete(scope: ArtworkScope, assetId: string, now: Date): Promise<ArtworkRecord>;
  claim(assetId: string, claimId: string, now: Date, until: Date): Promise<ArtworkRecord | null>;
  prepare(assetId: string, claimId: string, manifest: ArtworkManifest, now: Date): Promise<ArtworkRecord>;
  settle(assetId: string, claimId: string, now: Date): Promise<boolean>;
  reject(assetId: string, claimId: string, reason: string, now: Date): Promise<void>;
  release(assetId: string, claimId: string): Promise<void>;
  selectPending(limit: number, now: Date): Promise<string[]>;
  selectExpired(limit: number, now: Date): Promise<ArtworkRecord[]>;
  markDeleting(assetId: string, now: Date): Promise<ArtworkRecord | null>;
  finishDeleting(assetId: string, now: Date): Promise<void>;
  selectQuarantineCleanup(limit: number, now: Date): Promise<ArtworkRecord[]>;
  markQuarantineCleaned(assetId: string, now: Date): Promise<void>;
  readUsability(shopId: string, generation: string, assetIds: readonly string[], now: Date): Promise<ArtworkRecord[]>;
}
export interface ArtworkStorage {
  presignUpload(input: {
    key: string;
    contentType: string;
    expiresAt: Date;
  }): Promise<{ url: string; headers: Record<string, string> }>;
  read(input: { key: string; maxBytes: number; signal?: AbortSignal }): Promise<Uint8Array>;
  putImmutable(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<void>;
  remove(input: { key: string }): Promise<void>;
  presignRead(input: { key: string; expiresAt: Date; downloadFilename?: string }): Promise<string>;
}
export type ArtworkInspection = {
  version: 'm6-inspection-v1';
  mimeType: ArtworkMime;
  width: number;
  height: number;
  originalSha256: string;
  preview: Uint8Array;
  previewMimeType: 'image/png';
};
export class ArtworkError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'EXPIRED' | 'NOT_USABLE' | 'UNAVAILABLE' | 'CONFLICT') {
    super(`Artwork: ${code}`);
  }
}
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const datePlus = (now: Date, ms: number) => new Date(now.getTime() + ms);
const missing = (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND';
function usable(row: ArtworkRecord, now: Date): boolean {
  return row.state === 'USABLE' && row.manifest !== null && row.expiresAt > now;
}
function view(row: ArtworkRecord) {
  return {
    assetId: row.assetId,
    state: row.state,
    mimeType: row.manifest?.mimeType ?? row.declaredMime,
    width: row.manifest?.width ?? null,
    height: row.manifest?.height ?? null,
    expiresAt: row.expiresAt.toISOString(),
    rejection: row.rejection,
  };
}

/** Trusted scope comes from HTTP authentication/capability verification, never upload body tenant fields. */
export function createArtworkService(input: {
  store: ArtworkStore;
  storage: ArtworkStorage;
  inspect: (bytes: Uint8Array, options?: { signal?: AbortSignal }) => Promise<ArtworkInspection>;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  async function readOwned(scope: ArtworkScope, id: string) {
    const row = await input.store.get(scope, id);
    if (!row) throw new ArtworkError('NOT_FOUND');
    if (row.expiresAt <= clock() || row.state === 'DELETED' || row.state === 'DELETING')
      throw new ArtworkError('EXPIRED');
    return row;
  }
  return {
    async begin(scope: ArtworkScope, declaration: { contentType: string; byteLength: number }) {
      if (
        !['image/png', 'image/jpeg', 'image/svg+xml'].includes(declaration.contentType) ||
        !Number.isSafeInteger(declaration.byteLength) ||
        declaration.byteLength < 1 ||
        declaration.byteLength > ARTWORK_POLICY.maxBytes
      )
        throw new ArtworkError('INVALID_INPUT');
      if (
        !/^[1-9][0-9]*$/.test(scope.installationGeneration) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(scope.shopId) ||
        (scope.kind === 'guest' && !/^[a-f0-9]{64}$/.test(scope.ownerHash ?? ''))
      )
        throw new ArtworkError('INVALID_INPUT');
      const now = clock(),
        assetId = randomUUID(),
        capability = randomBytes(32).toString('base64url');
      const ownerHash = scope.kind === 'guest' ? scope.ownerHash! : hash(capability);
      const namespace = `${scope.shopId}/${scope.installationGeneration}/${assetId}`;
      const record: ArtworkRecord = {
        assetId,
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        ownerHash,
        declaredMime: declaration.contentType as ArtworkMime,
        declaredBytes: declaration.byteLength,
        state: 'UPLOADING',
        quarantineKey: `quarantine/${namespace}`,
        originalKey: `originals/${namespace}/v1`,
        previewKey: `previews/${namespace}/v1.png`,
        collectedAt: now,
        uploadUntil: datePlus(now, ARTWORK_POLICY.uploadMs),
        expiresAt: datePlus(now, ARTWORK_POLICY.retainedMs),
        claimId: null,
        manifest: null,
        rejection: null,
      };
      const admitted = await input.store.create(record);
      const upload = await input.storage.presignUpload({
        key: admitted.quarantineKey,
        contentType: admitted.declaredMime,
        expiresAt: admitted.uploadUntil,
      });
      return { ...view(admitted), upload, uploadUntil: admitted.uploadUntil.toISOString() };
    },
    async complete(scope: ArtworkScope, id: string) {
      return view(await input.store.complete(scope, id, clock()));
    },
    async status(scope: ArtworkScope, id: string) {
      return view(await readOwned(scope, id));
    },
    async preview(scope: ArtworkScope, id: string) {
      const row = await readOwned(scope, id);
      if (!usable(row, clock())) throw new ArtworkError('NOT_USABLE');
      const expiresAt = new Date(Math.min(row.expiresAt.getTime(), clock().getTime() + ARTWORK_POLICY.uploadMs));
      return {
        url: await input.storage.presignRead({ key: row.previewKey, expiresAt }),
        expiresAt: expiresAt.toISOString(),
        width: row.manifest!.width,
        height: row.manifest!.height,
      };
    },
    async download(scope: ArtworkScope, id: string) {
      if (scope.kind !== 'merchant') throw new ArtworkError('NOT_FOUND');
      const row = await readOwned(scope, id);
      if (!usable(row, clock())) throw new ArtworkError('NOT_USABLE');
      const ext =
        row.manifest!.mimeType === 'image/svg+xml' ? 'svg' : row.manifest!.mimeType === 'image/png' ? 'png' : 'jpg';
      const expiresAt = new Date(Math.min(row.expiresAt.getTime(), clock().getTime() + ARTWORK_POLICY.uploadMs));
      return {
        url: await input.storage.presignRead({
          key: row.originalKey,
          expiresAt,
          downloadFilename: `artwork-${row.assetId}.${ext}`,
        }),
        expiresAt: expiresAt.toISOString(),
        sha256: row.manifest!.sha256,
        byteLength: row.manifest!.byteLength,
      };
    },
    async process(assetId: string, signal?: AbortSignal) {
      signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000);
      const claimId = randomUUID();
      const row = await input.store.claim(assetId, claimId, clock(), datePlus(clock(), ARTWORK_POLICY.leaseMs));
      if (!row) return 'not_claimed' as const;
      try {
        let bytes: Uint8Array;
        if (row.manifest) {
          try {
            bytes = await input.storage.read({ key: row.originalKey, maxBytes: ARTWORK_POLICY.maxBytes, signal });
          } catch (error) {
            if (!missing(error)) throw error;
            bytes = await input.storage.read({ key: row.quarantineKey, maxBytes: ARTWORK_POLICY.maxBytes, signal });
          }
          if (hash(bytes) !== row.manifest.sha256) throw new ArtworkError('CONFLICT');
        } else bytes = await input.storage.read({ key: row.quarantineKey, maxBytes: ARTWORK_POLICY.maxBytes, signal });
        // Make a private snapshot before crossing the inspection and storage boundaries.
        const original = new Uint8Array(bytes);
        if (original.byteLength !== row.declaredBytes) throw new ArtworkError('INVALID_INPUT');
        const inspected = await input.inspect(new Uint8Array(original), { signal });
        const originalHash = hash(original);
        if (
          inspected.originalSha256 !== originalHash ||
          inspected.mimeType !== row.declaredMime ||
          inspected.previewMimeType !== 'image/png' ||
          inspected.preview.byteLength < 1 ||
          inspected.preview.byteLength > ARTWORK_POLICY.previewMaxBytes
        )
          throw new ArtworkError('INVALID_INPUT');
        const manifest: ArtworkManifest = {
          version: inspected.version,
          mimeType: inspected.mimeType,
          byteLength: original.byteLength,
          sha256: originalHash,
          width: inspected.width,
          height: inspected.height,
          previewSha256: hash(inspected.preview),
          previewByteLength: inspected.preview.byteLength,
        };
        const prepared = await input.store.prepare(assetId, claimId, manifest, clock());
        if (signal?.aborted) throw new ArtworkError('UNAVAILABLE');
        await input.storage.putImmutable({
          key: prepared.originalKey,
          bytes: original,
          contentType: 'application/octet-stream',
        });
        if (signal.aborted) throw new ArtworkError('UNAVAILABLE');
        await input.storage.putImmutable({
          key: prepared.previewKey,
          bytes: new Uint8Array(inspected.preview),
          contentType: 'image/png',
        });
        // Verify both stored byte identities before exposing usability.
        const readOriginal = await input.storage.read({
          key: prepared.originalKey,
          maxBytes: ARTWORK_POLICY.maxBytes,
          signal,
        });
        const readPreview = await input.storage.read({
          key: prepared.previewKey,
          maxBytes: ARTWORK_POLICY.previewMaxBytes,
          signal,
        });
        if (hash(readOriginal) !== manifest.sha256 || hash(readPreview) !== manifest.previewSha256)
          throw new ArtworkError('CONFLICT');
        if (signal.aborted) throw new ArtworkError('UNAVAILABLE');
        if (!(await input.store.settle(assetId, claimId, clock()))) throw new ArtworkError('CONFLICT');
        // Durable reconciliation retries cleanup without undoing verified usability.
        await input.storage.remove({ key: prepared.quarantineKey }).catch(() => {});
        return 'usable' as const;
      } catch (error) {
        const terminal =
          (error instanceof ArtworkError && error.code !== 'UNAVAILABLE') ||
          (!!error &&
            typeof error === 'object' &&
            'code' in error &&
            ['REJECTED', 'TOO_LARGE', 'INVALID_INPUT', 'CONFLICT'].includes(String(error.code)));
        if (terminal) {
          await input.store.reject(assetId, claimId, 'INSPECTION_REJECTED', clock());
          await input.storage.remove({ key: row.quarantineKey }).catch(() => {});
          return 'rejected' as const;
        }
        await input.store.release(assetId, claimId);
        throw new ArtworkError('UNAVAILABLE');
      }
    },
    async cleanup(limit = 100) {
      for (const row of await input.store.selectQuarantineCleanup(Math.min(Math.max(limit, 1), 100), clock())) {
        await input.storage.remove({ key: row.quarantineKey });
        await input.store.markQuarantineCleaned(row.assetId, clock());
      }
      const rows = await input.store.selectExpired(Math.min(Math.max(limit, 1), 100), clock());
      let completed = 0;
      for (const selected of rows) {
        const row = await input.store.markDeleting(selected.assetId, clock());
        if (!row) continue;
        for (const key of [row.quarantineKey, row.originalKey, row.previewKey]) await input.storage.remove({ key });
        await input.store.finishDeleting(row.assetId, clock());
        completed++;
      }
      return completed;
    },
    quoteArtwork: createArtworkUsabilityPort(input.store, clock),
  };
}

export function createArtworkUsabilityPort(
  store: Pick<ArtworkStore, 'readUsability'>,
  clock: () => Date = () => new Date(),
): QuoteArtworkPort {
  return {
    async readUsability(request) {
      const now = clock();
      const rows = await store.readUsability(
        request.shopId,
        request.installationGeneration,
        request.choices.filter((x) => x.kind === 'revision').map((x) => x.id),
        now,
      );
      return request.choices.map((choice) => {
        const row = rows.find((x) => x.assetId === choice.id);
        const accepted = choice.kind === 'revision' && row !== undefined && usable(row, now);
        return {
          ...choice,
          shopId: request.shopId,
          installationGeneration: request.installationGeneration,
          status: accepted ? 'usable' : 'unavailable',
          lastFullyUsableLocalDay: accepted ? localDay(row!.expiresAt, request.shopTimezone).ordinal - 1 : -1,
          observedAt: now.toISOString(),
        };
      });
    },
  };
}
