import { createHash, randomUUID } from 'node:crypto';
import {
  type AcceptedQuoteResult,
  type ArtworkScope,
  acceptQuote,
  localDay,
  materialHash,
  prepareQuote,
  type QuoteAuthorityPorts,
  type QuoteRequest,
  quoteRequestDigest,
  renewQuote,
} from '@insignia/application';
import {
  decodeEnvelope,
  decodeMemberCarrier,
  ENVELOPE_ATTRIBUTE,
  MEMBER_ATTRIBUTE,
} from '@insignia/cart-authorization';
import { type BuyerDesired, type BuyerDesiredGroup, BuyerDesiredSchema } from '@insignia/contracts';
import { type BuyerScope, BuyerStateError, type DurableCore, sha256CanonicalJson } from '@insignia/database';
import { normalizeCustomizationGroups } from '@insignia/domain';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import type { createArtworkGuestAuthority } from '../artwork/guest.ts';

type GuestAuthority = ReturnType<typeof createArtworkGuestAuthority>;
type Bucket = { variantId: string; quantity: number; properties: Record<string, string> };
const notFound = (): never => {
  throw new BuyerStateError('NOT_FOUND');
};
const review = (): never => {
  throw new Error('REVIEW_REQUIRED');
};
const desired = (request: QuoteRequest): BuyerDesiredGroup[] =>
  request.groups.map(({ group }) => {
    const { shopId: _shop, version: _version, ...value } = group;
    return value;
  });
function buckets(result: AcceptedQuoteResult): Bucket[] {
  return result.quote.economics.lines.map((line, i) => {
    const member = result.authorization.members[i];
    if (!member || member.lineIndex !== i) return review();
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      properties: {
        [ENVELOPE_ATTRIBUTE]: result.authorization.envelopeCarrier,
        [MEMBER_ATTRIBUTE]: member.carrier,
      },
    };
  });
}
function vectorHash(vector: readonly Bucket[]): string {
  if (
    vector.some(
      (v) => typeof v.properties[MEMBER_ATTRIBUTE] !== 'string' || typeof v.properties[ENVELOPE_ATTRIBUTE] !== 'string',
    )
  )
    return review();
  return sha256CanonicalJson(
    [...vector].sort((a, b) =>
      String(a.properties[MEMBER_ATTRIBUTE]).localeCompare(String(b.properties[MEMBER_ATTRIBUTE])),
    ),
  );
}
/** Server authority is injected once; client amounts, shop IDs and resource keys are never accepted. */
export function createBuyerServices(input: {
  core: DurableCore;
  guest: GuestAuthority;
  ports(scope: ArtworkScope): QuoteAuthorityPorts;
  catalog(
    scope: { shopId: string; installationGeneration: string },
    productId: string,
    phase?: 'final',
  ): Promise<{
    variants: { id: string; label: string; available: boolean }[];
    imageUrls: Record<string, string>;
  }>;
  configurationReady(scope: { shopId: string; installationGeneration: string }, productId: string): Promise<void>;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date()),
    store = input.core.buyers;
  const binding = (scope: BuyerScope, ports = input.ports({ ...scope, kind: 'guest' })) => {
    const value = ports.artwork.replayBinding?.(scope);
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Resource authority missing');
    return value;
  };
  const requestFor = (scope: BuyerScope, body: BuyerDesired, key: string): QuoteRequest => ({
    shopId: scope.shopId,
    installationGeneration: scope.installationGeneration,
    idempotencyKey: key,
    country: body.country,
    marketId: body.marketId,
    capacity: body.capacity,
    groups: body.groups.map((group) => ({
      group: { ...group, version: 'm2-customization-group-v1', shopId: scope.shopId },
    })),
  });
  function checkedPorts(scope: BuyerScope, groups: BuyerDesiredGroup[]): QuoteAuthorityPorts {
    const ports = input.ports({ ...scope, kind: 'guest' });
    let finalCheck = false;
    return {
      ...ports,
      store: {
        ...ports.store,
        findCompleted: (target) => ports.store.findCompleted(target),
        accept: (target, commit) =>
          ports.store.accept(target, async () => {
            finalCheck = true;
            try {
              return await commit();
            } finally {
              finalCheck = false;
            }
          }),
      },
      readiness: {
        async assertReady(target) {
          for (const productId of new Set(groups.map((group) => group.productId))) {
            const current = await input.catalog(scope, productId, finalCheck ? 'final' : undefined);
            const available = new Map(current.variants.map((variant) => [variant.id, variant.available]));
            if (
              current.variants.length !== available.size ||
              groups
                .filter((group) => group.productId === productId)
                .some((group) => group.variants.some((variant) => available.get(variant.variantId) !== true))
            )
              return review();
          }
          await ports.readiness.assertReady(target);
        },
      },
    };
  }
  async function privateUntil(scope: BuyerScope, groups: BuyerDesiredGroup[]) {
    const session = await store.getSession(scope, clock());
    if (!session) return notFound();
    let until = +session.expiresAt;
    for (const group of groups)
      for (const placement of group.design.placements) {
        if (placement.artwork.kind !== 'revision') continue;
        const asset = await input.core.artwork.get({ ...scope, kind: 'guest' }, placement.artwork.revisionId);
        if (!asset || asset.state !== 'USABLE' || +asset.expiresAt <= +clock()) return review();
        until = Math.min(until, +asset.expiresAt);
      }
    return new Date(until);
  }
  async function accepted(
    scope: BuyerScope,
    result: AcceptedQuoteResult,
    request: QuoteRequest,
    command: { kind: 'accept' | 'renew'; key: string; requestDigest: string },
  ) {
    const vector = buckets(result);
    const { applicationId } = await store.finishApplication(scope, {
      ...command,
      id: randomUUID(),
      quoteId: result.quote.quoteId,
      ownerBinding: binding(scope),
      expectedFingerprint: vectorHash(vector),
      now: clock(),
    });
    return {
      quoteId: result.quote.quoteId,
      setId: result.authorization.setId,
      validThroughDay: result.authorization.validThroughDay,
      applicationId,
      buckets: vector,
      desired: desired(request),
    };
  }
  return {
    guest: input.guest,
    store,
    clock,
    async config(request: Request) {
      const scope = await input.guest.resolve(request);
      if (!scope) return notFound();
      const revision = await input.core.acceptedQuotes.getEffective(scope.shopId, scope.productId);
      if (!revision) return notFound();
      const geometryRecord = await input.core.configs.getRevisionGeometry(scope.shopId, revision.config.revisionId);
      const presentation = await input.core.configs.getRevisionPresentation(scope.shopId, revision.config.revisionId);
      if (!geometryRecord || !presentation) throw new Error('Published presentation missing');
      const geometry = validateGeometry(geometryRecord.value as GeometryV1),
        config = revision.config;
      const catalog = await input.catalog(scope, scope.productId);
      if (catalog.variants.length > 250 || catalog.variants.some((v) => !/^[1-9][0-9]{0,19}$/.test(v.id)))
        throw new Error('Catalog boundary unavailable');
      await input.configurationReady(scope, scope.productId);
      const label = (kind: keyof typeof presentation.labels, id: string) => {
        const value = presentation.labels[kind]?.[id];
        return typeof value === 'string' ? value : id;
      };
      return {
        version: 'm7-config-v1',
        productId: scope.productId,
        revisionId: config.revisionId,
        contentHash: config.revisionContentHash,
        methods: config.methods.map((v) => ({ id: v.id, label: label('methods', v.id) })),
        placements: config.placements.map((v) => ({ ...v, label: label('placements', v.id) })),
        steps: geometry.steps.map((v) => ({ id: v.id, label: label('steps', v.id) })),
        options: config.productionOptions.map((v) => ({
          id: v.id,
          label: label('options', v.id),
          values: v.allowedValueIds.map((id) => ({ id, label: presentation.labels.values?.[v.id]?.[id] ?? id })),
        })),
        variants: catalog.variants,
        geometry,
        imageUrls: catalog.imageUrls,
        ready: true,
      };
    },
    async session(request: Request) {
      const grant = await input.guest.issue(new Request(request.url, { method: 'GET' }));
      if (!grant) return notFound();
      const scope = await input.guest.verify(
        new Request(request.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capability: grant.token }),
        }),
      );
      if (!scope || scope.kind !== 'guest' || !scope.ownerHash) return notFound();
      const session = await store.issueSession({
        scope: scope as BuyerScope,
        sessionId: randomUUID(),
        expiresAt: new Date(grant.expiresAt),
        now: clock(),
      });
      return { capability: grant.token, sessionId: session.sessionId, expiresAt: session.expiresAt.toISOString() };
    },
    async design(scope: BuyerScope, id: string, body: { expectedVersion: number; group: BuyerDesiredGroup }) {
      const revision = await input.core.acceptedQuotes.getEffective(scope.shopId, body.group.productId);
      if (!revision) return review();
      normalizeCustomizationGroups(
        [{ ...body.group, shopId: scope.shopId, version: 'm2-customization-group-v1' }],
        [revision.config],
      );
      const expiresAt = await privateUntil(scope, [body.group]);
      return store.saveDesign(scope, {
        id,
        expectedVersion: body.expectedVersion,
        value: body.group,
        expiresAt,
        now: clock(),
      });
    },
    async propose(scope: BuyerScope, body: BuyerDesired) {
      const id = randomUUID(),
        ports = checkedPorts(scope, body.groups),
        request = requestFor(scope, body, id);
      const candidate = await prepareQuote(request, ports),
        hash = materialHash(candidate.quote);
      const retainPrivateUntil = await privateUntil(scope, body.groups);
      const expiresAt = new Date(Math.min(+clock() + 300000, +retainPrivateUntil));
      await store.putProposal(scope, {
        id,
        requestDigest: candidate.requestDigest,
        materialHash: hash,
        request,
        candidate: candidate.quote,
        expiresAt,
        retainPrivateUntil,
        now: clock(),
      });
      const quote = candidate.quote;
      const previous = await store.getLatestOwnedQuote(scope, binding(scope, ports), clock());
      const changedGroups = previous
        ? quote.economics.groups
            .filter((group) => {
              const old = previous.quote.economics.groups.find(
                (v) => v.canonicalIdentitySha256 === group.canonicalIdentitySha256,
              );
              return (
                old &&
                (old.totalMinor !== group.totalMinor ||
                  old.setupMinor !== group.setupMinor ||
                  old.customizationUnitMinor !== group.customizationUnitMinor)
              );
            })
            .map((v) => v.canonicalIdentitySha256)
        : [];
      return {
        proposalId: id,
        hash,
        expiresAt: expiresAt.toISOString(),
        currency: quote.presentmentCurrency,
        exponent: quote.presentmentExponent,
        customizedQuantity: quote.economics.customizedQuantity,
        totalMinor: quote.economics.totalMinor,
        groups: quote.economics.groups.map(
          ({ productId, quantity, setupMinor, customizationUnitMinor, baseTotalMinor, totalMinor }) => ({
            productId,
            quantity,
            setupMinor,
            customizationUnitMinor,
            baseTotalMinor,
            totalMinor,
          }),
        ),
        changedGroups,
      };
    },
    async accept(scope: BuyerScope, id: string, body: { hash: string; idempotencyKey: string }) {
      const proposal = await store.getProposal(scope, id, clock(), true);
      if (!proposal || proposal.materialHash !== body.hash) return review();
      const request = { ...(proposal.request as QuoteRequest), idempotencyKey: `m7:${id}:${body.idempotencyKey}` },
        ports = checkedPorts(scope, desired(request));
      const command = {
        kind: 'accept' as const,
        key: request.idempotencyKey,
        requestDigest: sha256CanonicalJson({ proposalId: id, hash: body.hash, key: request.idempotencyKey }),
      };
      await store.reserveCommand(scope, { ...command, now: clock() });
      const guarded: QuoteAuthorityPorts = {
        ...ports,
        authorization: {
          ...ports.authorization,
          async issue(value) {
            if (+clock() >= +proposal.expiresAt || materialHash(value.quote) !== proposal.materialHash) return review();
            const final = await prepareQuote(request, ports);
            if (materialHash(final.quote) !== proposal.materialHash) return review();
            return ports.authorization.issue(value);
          },
        },
      };
      const result = await acceptQuote(request, guarded);
      // Material hash binds replay as well as new signing; a different original acceptance cannot be linked.
      if (materialHash(result.quote) !== proposal.materialHash) return review();
      await store.linkQuote(scope, {
        quoteId: result.quote.quoteId,
        proposalId: id,
        ownerBinding: binding(scope, ports),
        requestDigest: quoteRequestDigest(request, ports),
        now: clock(),
      });
      return accepted(scope, result, request, command);
    },
    async renew(scope: BuyerScope, id: string, body: BuyerDesired & { idempotencyKey: string }) {
      const ports = checkedPorts(scope, body.groups),
        request = requestFor(scope, body, body.idempotencyKey);
      const command = {
        kind: 'renew' as const,
        key: body.idempotencyKey,
        requestDigest: sha256CanonicalJson({ quoteId: id, request }),
      };
      await store.reserveCommand(scope, { ...command, now: clock() });
      const result = await renewQuote(
        { quoteId: id, desired: request },
        { ...ports, renewalStore: input.core.renewalQuotes },
      );
      return accepted(scope, result, request, command);
    },
    async confirm(scope: BuyerScope, id: string, body: { fingerprint: string; vector: Bucket[] }) {
      if (!(await store.getApplication(scope, id, clock()))) return notFound();
      return store.confirmApplication(scope, { id, observedFingerprint: vectorHash(body.vector), now: clock() });
    },
    async cartState(
      scope: BuyerScope,
      lines: {
        key: string;
        variantId: string;
        quantity: number;
        properties: Record<string, unknown>;
        sellingPlan: string | null;
      }[],
    ) {
      if (!lines.length) return { groups: [], repairRequired: false };
      const groups = new Map<string, BuyerDesiredGroup>(),
        sets = new Map<string, { count: number; indexes: Set<number> }>();
      const quoteIds = new Set<string>();
      let repairRequired = false;
      for (const line of lines) {
        if (line.sellingPlan) return review();
        const envelope = line.properties[ENVELOPE_ATTRIBUTE],
          memberCarrier = line.properties[MEMBER_ATTRIBUTE];
        if (typeof envelope !== 'string' || typeof memberCarrier !== 'string') return review();
        let parsed: ReturnType<typeof decodeEnvelope>, member: ReturnType<typeof decodeMemberCarrier>;
        try {
          parsed = decodeEnvelope(envelope);
          member = decodeMemberCarrier(memberCarrier);
        } catch {
          return review();
        }
        const { header } = parsed;
        const uuid = (hex: string) =>
          `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        const id = uuid(header.quoteHex),
          setId = uuid(header.setHex);
        const owned = await store.getOwnedSet(scope, {
          quoteId: id,
          setId,
          ownerBinding: binding(scope),
          now: clock(),
        });
        if (
          !owned ||
          owned.authorization.envelopeCarrier !== envelope ||
          owned.authorization.members[member.index]?.carrier !== memberCarrier ||
          member.variantId !== line.variantId
        )
          return review();
        if (
          line.quantity !== member.quantity ||
          localDay(clock(), owned.quote.shopTimezone).ordinal > header.validThroughDay
        )
          repairRequired = true;
        const seen = sets.get(setId) ?? { count: header.count, indexes: new Set<number>() };
        if (seen.indexes.has(member.index)) return review();
        seen.indexes.add(member.index);
        sets.set(setId, seen);
        const economicLine = owned.quote.economics.lines[member.index];
        if (!economicLine) return review();
        const request = owned.request as QuoteRequest;
        const candidates = request.groups
          .filter((v) => v.group.productId === economicLine.productId)
          .map((v) => v.group);
        const published = await input.core.configs.getValidatedPublishedRevision(
          scope.shopId,
          economicLine.configRevisionId,
        );
        if (!published) return review();
        // Match exact canonical design, allowing quantities to be repaired independently.
        const normalized = normalizeCustomizationGroups(candidates, [
          published.publishedValue as Parameters<typeof normalizeCustomizationGroups>[1][number],
        ]);
        const fallback = normalized.find(
          (v) => inputIdentityHash(v.canonicalIdentity) === economicLine.canonicalIdentitySha256,
        );
        if (!fallback) return review();
        const key = economicLine.canonicalIdentitySha256;
        let group = groups.get(key);
        if (!group) {
          const { canonicalIdentity: _identity, shopId: _shop, version: _version, ...raw } = fallback;
          group = { ...raw, variants: [] };
          groups.set(key, group);
        }
        const variant = group.variants.find((v) => v.variantId === line.variantId);
        if (variant) variant.quantity += line.quantity;
        else group.variants.push({ variantId: line.variantId, quantity: line.quantity });
        quoteIds.add(id);
      }
      const result = BuyerDesiredSchema.shape.groups.parse([...groups.values()]);
      return {
        groups: result,
        ...(quoteIds.size === 1 ? { quoteId: [...quoteIds][0] } : {}),
        repairRequired: repairRequired || sets.size !== 1 || [...sets.values()].some((v) => v.indexes.size !== v.count),
      };
    },
  };
}
function inputIdentityHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export type BuyerServices = ReturnType<typeof createBuyerServices>;
