import { createHash, randomUUID } from 'node:crypto';
import {
  type AcceptedQuoteResult,
  type ArtworkScope,
  acceptQuote,
  BuyerAcceptanceDeclinedError,
  localDay,
  materialHash,
  proposeQuote,
  type QuoteAuthorityPorts,
  type QuoteReadinessObservation,
  type QuoteRequest,
  quoteRequestDigest,
  renewQuote,
} from '@insignia/application';
import { decodeLineCarrierV3, LINE_ATTRIBUTE, PREFIX_V3_CHARS } from '@insignia/cart-authorization';
import {
  type BuyerDesired,
  type BuyerDesiredGroup,
  BuyerDesiredGroupSchema,
  BuyerDesiredSchema,
  PublishedConfigSchema,
} from '@insignia/contracts';
import { type BuyerScope, BuyerStateError, type DurableCore, sha256CanonicalJson } from '@insignia/database';
import {
  canonicalDesignIdentity,
  normalizeCustomizationGroups,
  parseMinor,
  validateLeanConfig,
} from '@insignia/domain';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import type { createArtworkGuestAuthority } from '../artwork/guest.ts';
import { buyerGeometry } from '../merchant-preview/geometry.ts';
import type { FrozenPreviewReader } from '../merchant-preview/read.ts';
import { publicSelectedSetup } from '../merchant-preview/selected-public.ts';
import { createConfigCache } from './config-cache.ts';
import { noteCache, proposalStage } from './diagnostics.ts';
import { validateBuyerProductionPositions } from './production-position.ts';
import { createRevisionReads } from './revision-cache.ts';

class BuyerPrecommitReviewError extends Error {
  constructor() {
    super('REVIEW_REQUIRED');
  }
}

type GuestAuthority = ReturnType<typeof createArtworkGuestAuthority>;
/** Proposal lifetime; acceptance after it requires a new proposal. */
const PROPOSAL_TTL_MS = 300000;
/** Buyers count as active (release evidence kept warm) for two minutes after a proposal. */
const RELEASE_ACTIVITY_MS = 120000;
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
/** One cart bucket per economics line, in quote-global line order, carrying only its v3 line carrier.
 * A replayed pre-cutover (v2) acceptance has no v3 carriers: the buyer reviews again instead. */
function buckets(result: AcceptedQuoteResult): Bucket[] {
  if (result.authorization.envelopeCarrier.length !== PREFIX_V3_CHARS) return review();
  return result.quote.economics.lines.map((line, i) => {
    const member = result.authorization.members[i];
    if (!member || member.lineIndex !== i || !member.carrier.startsWith(result.authorization.envelopeCarrier))
      return review();
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      properties: { [LINE_ATTRIBUTE]: member.carrier },
    };
  });
}
/** Quantity is not signed in v3, so the confirmation fingerprint covers only variants and carriers. */
function vectorHash(vector: readonly Bucket[]): string {
  if (vector.some((v) => typeof v.properties[LINE_ATTRIBUTE] !== 'string')) return review();
  return sha256CanonicalJson(vector.map((v) => `${v.variantId}\0${String(v.properties[LINE_ATTRIBUTE])}`).sort());
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
    context?: { country: string },
  ): Promise<{
    title?: string;
    currency?: string;
    variants: {
      id: string;
      label: string;
      available: boolean;
      selectedOptions?: { name: string; value: string; swatch?: { color: string } }[];
      baseUnitMinor?: string;
    }[];
    imageUrls: Record<string, string>;
  }>;
  /** Late readiness only; full catalog remains the presentation/restore contract. */
  availability?(
    scope: { shopId: string; installationGeneration: string },
    productId: string,
    variantIds: readonly string[],
    phase?: 'final',
  ): Promise<{ variants: readonly { id: string; available: boolean }[] }>;
  previewImages?: FrozenPreviewReader;
  /** Background release-evidence refresh hint; never awaited and never issuance authority. */
  releaseRefresh?(scope: { shopId: string; installationGeneration: string }, activeUntil: Date): void;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date()),
    store = input.core.buyers;
  type CatalogView = Awaited<ReturnType<typeof input.catalog>>;
  type Wording = Awaited<ReturnType<DurableCore['preferences']['readWording']>>;
  const revisions = createRevisionReads(input.core.configs, () => +clock());
  const configCache = createConfigCache<{ catalog: CatalogView; wording: Wording | undefined }>(() => +clock());
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
  function validatePositions(scope: BuyerScope, groups: BuyerDesiredGroup[]) {
    return validateBuyerProductionPositions(groups, {
      presentation: (revisionId) => revisions.getRevisionPresentation(scope.shopId, revisionId),
      geometry: (revisionId) => revisions.getRevisionGeometry(scope.shopId, revisionId),
      artwork: (assetId) => input.core.artwork.get({ ...scope, kind: 'guest' }, assetId),
      now: clock,
    });
  }
  async function assertAvailable(scope: BuyerScope, groups: BuyerDesiredGroup[]) {
    for (const productId of new Set(groups.map((group) => group.productId))) {
      const selectedIds = [
        ...new Set(
          groups
            .filter((group) => group.productId === productId)
            .flatMap((group) => group.variants.map((variant) => variant.variantId)),
        ),
      ];
      const current = input.availability
        ? await input.availability(scope, productId, selectedIds)
        : await input.catalog(scope, productId);
      const available = new Map(current.variants.map((variant) => [variant.id, variant.available]));
      if (
        current.variants.length === available.size &&
        groups
          .filter((group) => group.productId === productId)
          .some((group) => group.variants.some((variant) => available.get(variant.variantId) === false))
      )
        throw new BuyerPrecommitReviewError();
      if (
        current.variants.length !== available.size ||
        groups
          .filter((group) => group.productId === productId)
          .some((group) => group.variants.some((variant) => available.get(variant.variantId) !== true))
      )
        return review();
    }
  }
  /** Settle both started branches; stock denial retains precedence over readiness failure. */
  async function stockFirst<T>(stock: Promise<void>, other: Promise<T>): Promise<T> {
    const [stocked, result] = await Promise.allSettled([stock, other]);
    if (stocked.status === 'rejected') throw stocked.reason;
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  }
  function checkedPorts(scope: BuyerScope, groups: BuyerDesiredGroup[]): QuoteAuthorityPorts {
    const ports = input.ports({ ...scope, kind: 'guest' });
    const observe = async (target: {
      quote: Parameters<QuoteAuthorityPorts['readiness']['assertReady']>[0]['quote'];
    }) => {
      const observation: QuoteReadinessObservation = ports.readiness.observe
        ? await ports.readiness.observe(target)
        : { assertCurrent: () => ports.readiness.assertReady(target) };
      return { assertCurrent: () => proposalStage('current-readiness', () => observation.assertCurrent()) };
    };
    return {
      ...ports,
      readiness: {
        // Renewal: one complete check, serial after stock.
        async assertReady(target) {
          await proposalStage('positions', () => validatePositions(scope, groups));
          await proposalStage('availability', () => assertAvailable(scope, groups));
          await proposalStage('current-readiness', () => ports.readiness.assertReady(target));
        },
        // Acceptance: stock and provider readiness are observed before the signing fence. Positions
        // were validated by the proposal for this design and immutable revision; acceptance's artwork
        // usability read still re-checks artwork state and lifetime.
        observe: (target) =>
          stockFirst(
            proposalStage('availability', () => assertAvailable(scope, groups)),
            proposalStage('readiness-observe', () => observe(target)),
          ),
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
    async eligibility(request: Request) {
      // resolve admits only a signed, active installation and its effective
      // published revision. Presentation hints never grant purchase authority.
      const scope = await input.guest.resolve(request);
      if (!scope) return notFound();
      const revision = await input.core.acceptedQuotes.getEffective(scope.shopId, scope.productId);
      if (!revision) return notFound();
      const geometry = await revisions.getRevisionGeometry(scope.shopId, revision.config.revisionId);
      if (!geometry || geometry.mode !== 'required') return notFound();
      return { productId: scope.productId, configured: true as const };
    },
    async config(request: Request) {
      const scope = await proposalStage('tenant', () => input.guest.resolve(request));
      if (!scope) return notFound();
      const revision = await proposalStage('revision', () =>
        input.core.acceptedQuotes.getEffective(scope.shopId, scope.productId),
      );
      if (!revision) return notFound();
      const [geometryRecord, presentation] = await proposalStage('revision', () =>
        Promise.all([
          revisions.getRevisionGeometry(scope.shopId, revision.config.revisionId),
          revisions.getRevisionPresentation(scope.shopId, revision.config.revisionId),
        ]),
      );
      if (!geometryRecord || !presentation) throw new Error('Published presentation missing');
      const geometry = buyerGeometry(geometryRecord.value as GeometryV1),
        config = revision.config;
      const country = new URL(request.url).searchParams.get('country');
      const contextual = !!country && /^[A-Z]{2}$/.test(country);
      if (presentation.selectedSetup && (!country || !/^[A-Z]{2}$/.test(country)))
        throw new Error('Country context required');
      // Selection reads complete published/contextual facts. Purchase authority is
      // checked by proposal/acceptance, not by opening the editor. Provider reads are reused for
      // 30 s per exact revision and country; proposal and acceptance re-check and re-price.
      const loaded = await configCache.read(
        scope.shopId,
        [scope.installationGeneration, scope.productId, config.revisionId, config.revisionContentHash, country ?? ''],
        async () => {
          const catalog = await proposalStage('variant', () =>
            input.catalog(scope, scope.productId, undefined, country ? { country } : undefined),
          );
          const wording = contextual
            ? await proposalStage('presentation', () =>
                input.core.transactions.run((tx) => input.core.preferences.readWording(tx, scope)),
              )
            : undefined;
          // Only a result whose installation and publication stayed current is reused.
          const current = await proposalStage('tenant', () => input.guest.resolve(request));
          if (
            !current ||
            current.shopId !== scope.shopId ||
            current.installationGeneration !== scope.installationGeneration ||
            current.productId !== scope.productId
          )
            return notFound();
          return { catalog, wording };
        },
      );
      if (!loaded) throw new BuyerStateError('RATE_LIMITED');
      noteCache(loaded.cache);
      const { catalog, wording } = loaded.value;
      if (catalog.variants.length > 250 || catalog.variants.some((v) => !/^[1-9][0-9]{0,19}$/.test(v.id)))
        throw new Error('Catalog boundary unavailable');
      const label = (kind: keyof typeof presentation.labels, id: string) => {
        const value = presentation.labels[kind]?.[id];
        return typeof value === 'string' ? value : id;
      };
      // Presigned preview URLs live 60 s, so they are issued per request, never cached.
      const imageUrls = input.previewImages
        ? await proposalStage('presentation', () =>
            input.previewImages!(scope, { productId: scope.productId, revisionId: config.revisionId, geometry }),
          )
        : contextual
          ? {}
          : catalog.imageUrls;
      const selected = presentation.selectedSetup;
      // Older readers can omit country and still receive the retained canonical DTO.
      // Editable financial metadata requires actual contextual catalogue facts, independently of authoring sidecars.
      let editable:
        | {
            shopCurrency: 'USD' | 'EUR';
            decorationPrices: { placementId: string; methodId: string; stepId: string; minor: string }[];
          }
        | undefined;
      const currency = config.shopCurrency;
      const optionNames = catalog.variants[0]?.selectedOptions?.map((option) => option.name) ?? [];
      if (
        contextual &&
        (currency === 'USD' || currency === 'EUR') &&
        catalog.currency === currency &&
        optionNames.length > 0 &&
        optionNames.length <= 3 &&
        new Set(optionNames).size === optionNames.length &&
        catalog.variants.every(
          (variant) =>
            Array.isArray(variant.selectedOptions) &&
            variant.selectedOptions.length === optionNames.length &&
            new Set(variant.selectedOptions.map((option) => option.name)).size === optionNames.length &&
            optionNames.every((name) =>
              variant.selectedOptions?.some((option) => option.name === name && !!option.value.trim()),
            ) &&
            typeof variant.baseUnitMinor === 'string' &&
            /^(0|[1-9][0-9]{0,19})$/.test(variant.baseUnitMinor),
        )
      ) {
        try {
          const cells = new Set<string>();
          const decorationPrices = validateLeanConfig(config).pricingRules.map((rule) => {
            if (rule.scope.kind !== 'step' || !rule.scope.methodId || rule.rate.kind !== 'fixed')
              throw new Error('Unsupported published price');
            const identity = JSON.stringify([rule.scope.placementId, rule.scope.methodId, rule.scope.stepId]);
            if (cells.has(identity)) throw new Error('Ambiguous published price cell');
            cells.add(identity);
            return {
              placementId: rule.scope.placementId,
              methodId: rule.scope.methodId,
              stepId: rule.scope.stepId,
              minor: parseMinor(rule.rate.amount.shopDecimal, 2).toString(),
            };
          });
          editable = { shopCurrency: currency, decorationPrices };
        } catch {
          // Historical setup/tier/override/multiplicity or ambiguous rules remain readable; new UI repairs them.
        }
      }
      const title = catalog.title ?? selected?.product.title;
      if (contextual && !wording) throw new Error('Customer wording unavailable');
      return {
        ...(selected ? { selectedSetup: publicSelectedSetup(selected, geometry, imageUrls) } : {}),
        ...(contextual
          ? { wording, ...(typeof title === 'string' && title.trim() && title.length <= 256 ? { title } : {}) }
          : {}),
        ...editable,
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
        imageUrls,
        // Retained revisions remain readable, but the selected Designer must never
        // present a publication without actual dimensions as a usable selection.
        ready:
          config.placements.every((placement) =>
            placement.allowedStepIds.every((id) => !!geometry.steps.find((step) => step.id === id)?.physicalMm),
          ) &&
          (!contextual ||
            (!!editable &&
              typeof title === 'string' &&
              !!title.trim() &&
              title.length <= 256 &&
              catalog.variants.length > 0)),
      };
    },
    async session(request: Request) {
      const grant = await input.guest.issue(new Request(request.url, { method: 'GET' }));
      if (!grant) return notFound();
      // The grant's scope is derived from the token it just minted; no second verification.
      const scope = grant.scope;
      if (!scope || scope.kind !== 'guest' || !scope.ownerHash) return notFound();
      const session = await store.issueSession({
        scope: scope as BuyerScope,
        sessionId: randomUUID(),
        expiresAt: new Date(grant.expiresAt),
        now: clock(),
      });
      return { capability: grant.token, sessionId: session.sessionId, expiresAt: session.expiresAt.toISOString() };
    },
    async restoreDesign(scope: BuyerScope, id: string) {
      const saved = await store.getDesign(scope, id, clock());
      if (!saved) return notFound();
      const group = BuyerDesiredGroupSchema.parse(saved.value);
      const original = await revisions.getValidatedPublishedRevision(scope.shopId, group.configRevisionId);
      if (!original || original.contentHash !== group.revisionContentHash) return notFound();
      const originalConfig = PublishedConfigSchema.parse(original.publishedValue);
      if (originalConfig.productId !== group.productId) return notFound();
      const presentation = await revisions.getRevisionPresentation(scope.shopId, group.configRevisionId);
      const geometryRecord = await revisions.getRevisionGeometry(scope.shopId, group.configRevisionId);
      let compatibility:
        | 'current'
        | 'publication-changed'
        | 'choice-unavailable'
        | 'configuration-unavailable'
        | 'legacy' = 'configuration-unavailable';
      const current = await input.core.acceptedQuotes.getEffective(scope.shopId, group.productId);
      if (current) {
        try {
          normalizeCustomizationGroups(
            [
              {
                ...group,
                shopId: scope.shopId,
                version: 'm2-customization-group-v1',
                configRevisionId: current.config.revisionId,
                revisionContentHash: current.config.revisionContentHash,
              },
            ],
            [current.config],
          );
          compatibility = current.config.revisionId === group.configRevisionId ? 'current' : 'publication-changed';
        } catch {
          compatibility = 'choice-unavailable';
        }
      }
      let retained = null;
      if (presentation?.selectedSetup && geometryRecord && input.previewImages) {
        const geometry = buyerGeometry(geometryRecord.value as GeometryV1);
        const imageUrls = await input.previewImages(scope, {
          productId: group.productId,
          revisionId: group.configRevisionId,
          geometry,
          retainUntil: saved.expiresAt,
        });
        retained = {
          revisionId: group.configRevisionId,
          contentHash: group.revisionContentHash,
          selectedSetup: publicSelectedSetup(presentation.selectedSetup, geometry, imageUrls),
          geometry,
          imageUrls,
        };
      } else if (!presentation?.selectedSetup) compatibility = 'legacy';
      // Recheck the exact owned retained design after asynchronous image reads.
      const currentSaved = await store.getDesign(scope, id, clock());
      if (!currentSaved || currentSaved.version !== saved.version || +currentSaved.expiresAt !== +saved.expiresAt)
        return notFound();
      return {
        id: saved.id,
        version: saved.version,
        value: group,
        expiresAt: saved.expiresAt.toISOString(),
        compatibility,
        retained,
      };
    },
    async design(scope: BuyerScope, id: string, body: { expectedVersion: number; group: BuyerDesiredGroup }) {
      const revision = await input.core.acceptedQuotes.getEffective(scope.shopId, body.group.productId);
      if (!revision) return review();
      normalizeCustomizationGroups(
        [{ ...body.group, shopId: scope.shopId, version: 'm2-customization-group-v1' }],
        [revision.config],
      );
      await validatePositions(scope, [body.group]);
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
      // Buyer activity keeps release evidence warm for a later acceptance, off this request's path.
      try {
        input.releaseRefresh?.(scope, new Date(+clock() + RELEASE_ACTIVITY_MS));
      } catch {
        /* A refresh hint cannot change the proposal. */
      }
      // A proposal is display-only: no release or Function verification (owner decision 10 Nov 2026).
      // Acceptance verifies both before signing.
      // Request-shape and capacity bounds reject before any provider read, including stock.
      quoteRequestDigest(request, ports);
      await proposalStage('positions', () => validatePositions(scope, body.groups));
      const [prepared, stock] = await Promise.allSettled([
        proposalStage('prepare', () => proposeQuote(request, ports)),
        proposalStage('availability', () => assertAvailable(scope, body.groups)),
      ]);
      if (prepared.status === 'rejected') throw prepared.reason;
      if (stock.status === 'rejected') throw stock.reason;
      const candidate = prepared.value,
        hash = materialHash(candidate.quote);
      const retainPrivateUntil = await proposalStage('private-retention', () => privateUntil(scope, body.groups));
      const expiresAt = new Date(Math.min(+clock() + PROPOSAL_TTL_MS, +retainPrivateUntil));
      await proposalStage('persistence', () =>
        store.putProposal(scope, {
          id,
          requestDigest: candidate.requestDigest,
          materialHash: hash,
          request,
          candidate: candidate.quote,
          expiresAt,
          retainPrivateUntil,
          now: clock(),
        }),
      );
      const quote = candidate.quote;
      const previous = await proposalStage('owned-history', () =>
        store.getLatestOwnedQuote(scope, binding(scope, ports), clock()),
      );
      return proposalStage('response-projection', () => {
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
            ({
              productId,
              canonicalIdentitySha256,
              quantity,
              setupMinor,
              customizationUnitMinor,
              baseTotalMinor,
              totalMinor,
            }) => {
              const original = request.groups.find(
                ({ group }) => inputIdentityHash(canonicalDesignIdentity(group)) === canonicalIdentitySha256,
              )?.group;
              const physical = quote.physicalGroups.find(
                (group) => group.canonicalIdentitySha256 === canonicalIdentitySha256,
              );
              if (!original || !physical) throw new Error('Quote group identity unavailable');
              const { shopId: _shop, version: _version, ...selection } = original;
              return {
                productId,
                canonicalIdentitySha256,
                selection: { ...selection, variants: physical.variants.map((variant) => ({ ...variant })) },
                quantity,
                setupMinor,
                customizationUnitMinor,
                baseTotalMinor,
                totalMinor,
              };
            },
          ),
          changedGroups,
        };
      });
    },
    async accept(scope: BuyerScope, id: string, body: { hash: string; idempotencyKey: string }) {
      const key = `m7:${id}:${body.idempotencyKey}`;
      const command = {
        kind: 'accept' as const,
        key,
        requestDigest: sha256CanonicalJson({ proposalId: id, hash: body.hash, key }),
      };
      if (await store.commandDeclined(scope, { ...command, now: clock() })) throw new BuyerAcceptanceDeclinedError();
      const proposal = await store.getProposal(scope, id, clock(), true);
      if (!proposal || proposal.materialHash !== body.hash) return review();
      const request = { ...(proposal.request as QuoteRequest), idempotencyKey: key },
        ports = checkedPorts(scope, desired(request));
      await store.reserveCommand(scope, { ...command, now: clock() });
      const unchanged = (quote: Parameters<QuoteAuthorityPorts['authorization']['issue']>[0]['quote']) => {
        if (+clock() >= +proposal.expiresAt || materialHash(quote) !== proposal.materialHash)
          throw new BuyerPrecommitReviewError();
      };
      const guarded: QuoteAuthorityPorts = {
        ...ports,
        readiness: {
          ...ports.readiness,
          // The proposal hash binds the fresh pass; a changed price or context stops before readiness IO.
          observe: async (target) => {
            unchanged(target.quote);
            const observe = ports.readiness.observe;
            if (!observe) throw new Error('Buyer acceptance readiness unavailable');
            return observe(target);
          },
        },
        store: {
          ...ports.store,
          accept: (target, commit) =>
            ports.store.accept(
              {
                ...target,
                buyerCommand: {
                  ownerHash: scope.ownerHash,
                  requestDigest: command.requestDigest,
                  now: clock(),
                },
              },
              commit,
            ),
        },
        authorization: {
          ...ports.authorization,
          async issue(value) {
            unchanged(value.quote);
            return ports.authorization.issue(value);
          },
        },
      };
      const result = await acceptQuote(request, guarded).catch(async (error: unknown) => {
        if (error instanceof BuyerPrecommitReviewError) {
          const resolve = ports.store.resolveBuyerAcceptance;
          if (!resolve) throw error;
          const tenant = await ports.tenant.getActive(scope.shopId, scope.installationGeneration);
          if (!tenant) throw error;
          const resolution = await resolve({
            shopId: scope.shopId,
            installationGeneration: scope.installationGeneration,
            authorizationGeneration: tenant.authorizationGeneration,
            authorizationEpoch: tenant.authorizationEpoch,
            idempotencyKey: request.idempotencyKey,
            requestDigest: quoteRequestDigest(request, ports),
            buyerCommand: { ownerHash: scope.ownerHash, requestDigest: command.requestDigest, now: clock() },
          });
          if (resolution.outcome === 'accepted') return resolution.result;
          throw new BuyerAcceptanceDeclinedError();
        }
        throw error;
      });
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
    /**
     * Renewal re-prices the stored accepted request (the reviewed offer), not the client's groups: a cart
     * whose quantities changed natively still renews, and the storefront applies the new line carriers to
     * the cart's current quantities. Only country, Market, capacity and the idempotency key come from the client.
     */
    async renew(scope: BuyerScope, id: string, body: BuyerDesired & { idempotencyKey: string }) {
      const owned = await store.getOwnedRequest(scope, { quoteId: id, ownerBinding: binding(scope), now: clock() });
      if (!owned) return review();
      const parsed = BuyerDesiredSchema.shape.groups.safeParse(desired(owned.request as QuoteRequest));
      if (!parsed.success) return review();
      const groups = parsed.data;
      const ports = checkedPorts(scope, groups),
        request = requestFor(
          scope,
          { country: body.country, marketId: body.marketId, capacity: body.capacity, groups },
          body.idempotencyKey,
        );
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
        indexes = new Set<number>(),
        sets = new Set<string>(),
        quoteIds = new Set<string>();
      let expired = false;
      for (const line of lines) {
        if (line.sellingPlan) return review();
        // Historical v2 leftovers (or any other carrier) cannot be priced by the Functions: Designer repair.
        const carrier = line.properties[LINE_ATTRIBUTE];
        let decoded: ReturnType<typeof decodeLineCarrierV3>;
        try {
          decoded = decodeLineCarrierV3(carrier);
        } catch {
          return review();
        }
        const { header, record } = decoded;
        const uuid = (hex: string) =>
          `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        const id = uuid(header.quoteHex),
          setId = uuid(header.setHex);
        sets.add(setId);
        quoteIds.add(id);
        // One acceptance per cart: the Functions verify a single signed set.
        if (sets.size > 1) return review();
        const owned = await store.getOwnedSet(scope, {
          quoteId: id,
          setId,
          ownerBinding: binding(scope),
          now: clock(),
        });
        if (
          !owned ||
          owned.authorization.envelopeCarrier !== decoded.prefix ||
          owned.authorization.members[record.index]?.carrier !== carrier ||
          record.variantId !== line.variantId
        )
          return review();
        if (indexes.has(record.index)) return review();
        indexes.add(record.index);
        if (localDay(clock(), owned.quote.shopTimezone).ordinal > header.validThroughDay) expired = true;
        const economicLine = owned.quote.economics.lines[record.index];
        if (!economicLine) return review();
        const request = owned.request as QuoteRequest;
        const candidates = request.groups
          .filter((v) => v.group.productId === economicLine.productId)
          .map((v) => v.group);
        const published = await revisions.getValidatedPublishedRevision(scope.shopId, economicLine.configRevisionId);
        if (!published) return review();
        // Match exact canonical design; observed cart quantities are the buyer's current choice.
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
      }
      const result = BuyerDesiredSchema.shape.groups.parse([...groups.values()]);
      const labels: Record<string, string> = {};
      for (const group of result) {
        const presentation = await revisions.getRevisionPresentation(scope.shopId, group.configRevisionId);
        const title = presentation?.selectedSetup?.product.title;
        if (title?.trim()) labels[group.productId] = title;
      }
      // A subset of the set or changed quantities is valid under v3: only expiry needs a buyer action here.
      return {
        groups: result,
        ...(Object.keys(labels).length ? { labels } : {}),
        quoteId: [...quoteIds][0],
        repairRequired: expired,
        // Only the validity window lapsed; economics/context still need renewal's own full comparison.
        renewable: expired,
      };
    },
  };
}
function inputIdentityHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export type BuyerServices = ReturnType<typeof createBuyerServices>;
