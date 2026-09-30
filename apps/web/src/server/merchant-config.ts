import { randomUUID } from 'node:crypto';
import { executeCommand } from '@insignia/application';
import { type MerchantDraft, MerchantDraftSchema, PublishedConfigSchema } from '@insignia/contracts';
import type { DurableTransaction } from '@insignia/database';
import { CONFIG_DRAFT_STORAGE_VERSION, type DurableCore, sha256CanonicalJson } from '@insignia/database';
import { validatePublishedConfig } from '@insignia/domain';
import { GEOMETRY_VERSION, type GeometryV1, validateGeometryBridge } from '@insignia/visualizer/geometry';
import type { AdminActor as Actor, CatalogProduct } from './admin/contracts.js';

type Outcome =
  | { kind: 'created'; configId: string }
  | { kind: 'saved'; draftVersion: string }
  | { kind: 'accepted'; state: ReturnType<typeof state>; revisionId: string }
  | { kind: 'conflict' | 'invalid' | 'forbidden'; message: string };
type Publication = Pick<ReturnType<DurableCore['productionPublications']['create']>, 'prepare' | 'advance'>;

function productNumber(gid: string): string {
  const match = /^gid:\/\/shopify\/Product\/([1-9][0-9]*)$/.exec(gid);
  if (!match?.[1]) throw new Error('Invalid Shopify product ID');
  return match[1];
}
function draftPublished(draft: MerchantDraft, actor: Actor, productId: string, revisionId: string) {
  return {
    version: 'm2-published-config-v1' as const,
    shopId: actor.tenantShopId,
    productId: productNumber(productId),
    revisionId,
    revisionContentHash: '0'.repeat(64),
    shopCurrency: draft.shopCurrency,
    methods: draft.methods,
    placements: draft.placements,
    productionOptions: draft.productionOptions,
    pricingRules: draft.pricingRules,
  };
}
function validatedDraft(value: unknown, actor: Actor, productId: string): MerchantDraft {
  const draft = MerchantDraftSchema.parse(value);
  const geometry = draft.geometry as GeometryV1;
  const published = validatePublishedConfig(
    PublishedConfigSchema.parse(draftPublished(draft, actor, productId, 'draft')),
  );
  validateGeometryBridge(geometry, published);
  const references = [
    ['methods', draft.methods.map((item) => item.id)],
    ['placements', draft.placements.map((item) => item.id)],
    ['steps', geometry.steps.map((item) => item.id)],
    ['views', geometry.views.map((item) => item.id)],
    ['options', draft.productionOptions.map((item) => item.id)],
    ['values', draft.productionOptions.flatMap((item) => item.allowedValueIds)],
    ['prices', draft.pricingRules.map((item) => item.id)],
  ] as const;
  for (const [kind, ids] of references)
    if (Object.keys(draft.labels?.[kind] ?? {}).some((id) => !ids.includes(id)))
      throw new Error('Draft label references an unknown configuration choice');
  return { ...draft, geometry };
}
function cloneForProduct(source: MerchantDraft, targetConfigId: string): MerchantDraft {
  const suffix = targetConfigId.replaceAll('-', '').slice(0, 12);
  let ordinal = 0;
  const fresh = (prefix: string) => `${prefix}_${suffix}_${++ordinal}`;
  const methods = new Map(source.methods.map((item) => [item.id, fresh('method')]));
  const placements = new Map(source.placements.map((item) => [item.id, fresh('place')]));
  const steps = new Map((source.geometry as GeometryV1).steps.map((item) => [item.id, fresh('step')]));
  const options = new Map(source.productionOptions.map((item) => [item.id, fresh('option')]));
  const values = new Map(
    source.productionOptions.flatMap((item) => item.allowedValueIds).map((id) => [id, fresh('value')]),
  );
  const prices = new Map(source.pricingRules.map((item) => [item.id, fresh('price')]));
  const views = new Map((source.geometry as GeometryV1).views.map((item) => [item.id, fresh('view')]));
  const labels = Object.fromEntries(
    (
      [
        ['methods', methods],
        ['placements', placements],
        ['steps', steps],
        ['views', views],
        ['options', options],
        ['values', values],
        ['prices', prices],
      ] as const
    ).map(([kind, ids]) => [
      kind,
      Object.fromEntries(
        [...ids.entries()].flatMap(([oldId, newId]) => {
          const label = source.labels?.[kind]?.[oldId];
          return label ? [[newId, label]] : [];
        }),
      ),
    ]),
  );
  const renamed = {
    ...source,
    labels,
    methods: source.methods.map((item) => ({ id: methods.get(item.id)! })),
    placements: source.placements.map((item) => ({
      ...item,
      id: placements.get(item.id)!,
      allowedMethodIds: item.allowedMethodIds.map((id) => methods.get(id)!),
      allowedStepIds: item.allowedStepIds.map((id) => steps.get(id)!),
    })),
    productionOptions: source.productionOptions.map((item) => ({
      id: options.get(item.id)!,
      allowedValueIds: item.allowedValueIds.map((id) => values.get(id)!),
    })),
    pricingRules: source.pricingRules.map((rule) => ({
      ...rule,
      id: prices.get(rule.id)!,
      scope:
        rule.scope.kind === 'general'
          ? rule.scope
          : rule.scope.kind === 'method'
            ? { ...rule.scope, methodId: methods.get(rule.scope.methodId)! }
            : rule.scope.kind === 'placement'
              ? {
                  ...rule.scope,
                  placementId: placements.get(rule.scope.placementId)!,
                  ...(rule.scope.methodId ? { methodId: methods.get(rule.scope.methodId)! } : {}),
                }
              : {
                  ...rule.scope,
                  placementId: placements.get(rule.scope.placementId)!,
                  stepId: steps.get(rule.scope.stepId)!,
                  ...(rule.scope.methodId ? { methodId: methods.get(rule.scope.methodId)! } : {}),
                },
    })),
    geometry: {
      ...(source.geometry as GeometryV1),
      views: (source.geometry as GeometryV1).views.map((view) => {
        const { image: _sourceProductImage, ...independentView } = view;
        return {
          ...independentView,
          id: views.get(view.id)!,
          variantImages: [],
          placements: view.placements.map((item) => ({ ...item, id: placements.get(item.id)!, variantOverrides: [] })),
        };
      }),
      steps: (source.geometry as GeometryV1).steps.map((item) => ({ ...item, id: steps.get(item.id)! })),
    },
  };
  return MerchantDraftSchema.parse(renamed);
}

function state(
  phase: string | null,
  activeOperation: string | null,
  latestOperation: string | null,
):
  | 'DRAFT'
  | 'PUBLISH_REQUESTED'
  | 'REMOTE_PENDING'
  | 'REMOTE_READY_ACTIVATION_PENDING'
  | 'ACTIVE'
  | 'CONFLICT'
  | 'OPERATOR_HOLD' {
  if (phase === null) return activeOperation ? 'ACTIVE' : 'DRAFT';
  if (phase === 'active' && activeOperation === latestOperation) return 'ACTIVE';
  if (phase === 'activation-pending') return 'REMOTE_READY_ACTIVATION_PENDING';
  if (phase === 'conflict') return 'CONFLICT';
  if (phase === 'operator-hold') return 'OPERATOR_HOLD';
  if (phase === 'prepared') return 'PUBLISH_REQUESTED';
  return 'REMOTE_PENDING';
}

/** Commands bind every product read and mutation to the verified current M3 tenant. */
export function createMerchantConfigService(input: {
  core: DurableCore;
  catalog: {
    get(actor: Actor, productId: string): Promise<CatalogProduct | null>;
    shopCurrency(actor: Actor): Promise<string>;
  };
  eligibility(actor: Actor, draft: MerchantDraft): Promise<{ allowed: boolean; reason: string | null }>;
  publication(actor: Actor): Publication;
}) {
  const { core } = input;
  async function current(actor: Actor): Promise<void> {
    const scope = await core.tenants.getActiveAuthorizationScope({
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
    });
    if (!scope || scope.shopDomain !== actor.shop || `gid://shopify/Shop/${scope.shopifyShopId}` !== actor.shopId)
      throw new Error('Current tenant installation required');
  }
  async function currentLocked(actor: Actor, tx: DurableTransaction): Promise<void> {
    const scope = await core.tenants.lockActiveAuthorizationScope(tx, {
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
    });
    if (!scope || scope.shopDomain !== actor.shop || `gid://shopify/Shop/${scope.shopifyShopId}` !== actor.shopId)
      throw new Error('Current tenant installation required');
  }
  async function product(actor: Actor, gid: string): Promise<CatalogProduct> {
    await current(actor);
    const found = await input.catalog.get(actor, gid);
    if (!found || found.id !== gid) throw new Error('Product does not belong to current shop');
    return found;
  }
  function command(actor: Actor, namespace: string, key: string, request: unknown) {
    return { shopId: actor.tenantShopId, namespace, key, requestDigest: sha256CanonicalJson(request) };
  }
  return {
    async read(actor: Actor, productId: string) {
      const item = await product(actor, productId);
      const config = await core.configs.getByProduct(actor.tenantShopId, productNumber(productId));
      if (!config) return { product: item, config: null };
      const progress = await core.configs.getCurrentPublication(actor.tenantShopId, config.configId);
      let eligibility: { allowed: boolean; reason: string | null };
      try {
        const draft = validatedDraft(config.draftValue, actor, productId);
        eligibility = await input.eligibility(actor, draft);
      } catch {
        eligibility = { allowed: false, reason: 'Draft or entitlement unavailable' };
      }
      const publicationState = state(
        progress?.phase ?? null,
        config.effectiveOperationId,
        progress?.operationId ?? null,
      );
      return {
        product: item,
        config: {
          configId: config.configId,
          draftVersion: config.draftVersion,
          draft: config.draftValue,
          publication: {
            state: publicationState,
            revisionId: progress?.revisionId ?? config.effectiveRevisionId,
            activeRevisionId: config.effectiveRevisionId,
            reason:
              publicationState === 'REMOTE_READY_ACTIVATION_PENDING'
                ? 'Remote fields read back. Function identity and activation admission remain pending.'
                : publicationState === 'CONFLICT' || publicationState === 'OPERATOR_HOLD'
                  ? 'Publication requires operator review.'
                  : null,
            requiresAllChannelHold: progress
              ? progress.priorMode === null || progress.priorMode !== progress.mode
              : null,
            functionReadiness: progress ? 'UNVERIFIABLE_DEPLOYED_WASM_IDENTITY' : null,
          },
          publishEligibility: eligibility,
        },
      };
    },
    async create(actor: Actor, productId: string, key: string): Promise<Outcome> {
      await product(actor, productId);
      const currency = await input.catalog.shopCurrency(actor);
      const result = await executeCommand(
        core.transactions,
        core.commands,
        command(actor, 'm5-create-config', key, { productId }),
        async (tx) => {
          await currentLocked(actor, tx);
          const id = randomUUID();
          const draft: MerchantDraft = {
            version: 'm5-merchant-draft-v1',
            mode: 'optional',
            shopCurrency: currency,
            methods: [],
            placements: [],
            productionOptions: [],
            pricingRules: [],
            geometry: {
              version: GEOMETRY_VERSION,
              views: [{ id: 'front', variantImages: [], placements: [] }],
              steps: [],
            },
          };
          await core.configs.createConfig(tx, {
            shopId: actor.tenantShopId,
            configId: id,
            externalProductId: productNumber(productId),
            draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: draft,
          });
          return id;
        },
      );
      return { kind: 'created', configId: result.resultRef };
    },
    async save(
      actor: Actor,
      productId: string,
      data: {
        configId: string;
        draftVersion: string;
        draft: unknown;
        idempotencyKey: string;
      },
    ): Promise<Outcome> {
      await product(actor, productId);
      let draft: MerchantDraft;
      try {
        draft = validatedDraft(data.draft, actor, productId);
      } catch {
        return { kind: 'invalid', message: 'Draft does not satisfy M2 configuration and geometry contracts' };
      }
      const result = await executeCommand(
        core.transactions,
        core.commands,
        command(actor, 'm5-save-draft', data.idempotencyKey, {
          productId,
          configId: data.configId,
          draftVersion: data.draftVersion,
          draft,
        }),
        async (tx) => {
          await currentLocked(actor, tx);
          const config = await core.configs.getConfigForUpdate(tx, actor.tenantShopId, data.configId);
          if (!config || config.externalProductId !== productNumber(productId)) return 'conflict';
          const updated = await core.configs.updateDraft(tx, {
            shopId: actor.tenantShopId,
            configId: data.configId,
            expectedVersion: data.draftVersion,
            schemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: draft,
          });
          return updated.kind === 'updated' ? `saved:${updated.config.draftVersion}` : 'conflict';
        },
      );
      return result.resultRef === 'conflict'
        ? { kind: 'conflict', message: 'Draft changed. Reload and review the current version.' }
        : { kind: 'saved', draftVersion: result.resultRef.slice('saved:'.length) };
    },
    async copy(actor: Actor, sourceProductId: string, targetProductId: string, key: string): Promise<Outcome> {
      await product(actor, sourceProductId);
      await product(actor, targetProductId);
      if (sourceProductId === targetProductId) return { kind: 'invalid', message: 'Copy target must differ' };
      const result = await executeCommand(
        core.transactions,
        core.commands,
        command(actor, 'm5-copy-config', key, { sourceProductId, targetProductId }),
        async (tx) => {
          await currentLocked(actor, tx);
          const source = await core.configs.getByProductForUpdate(
            tx,
            actor.tenantShopId,
            productNumber(sourceProductId),
          );
          if (!source) return 'missing';
          let draft: MerchantDraft;
          try {
            draft = validatedDraft(source.draftValue, actor, sourceProductId);
          } catch {
            return 'invalid';
          }
          const id = randomUUID();
          const targetDraft = cloneForProduct(draft, id);
          validatedDraft(targetDraft, actor, targetProductId);
          await core.configs.createConfig(tx, {
            shopId: actor.tenantShopId,
            configId: id,
            externalProductId: productNumber(targetProductId),
            draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
            draftValue: targetDraft,
          });
          return id;
        },
      );
      if (result.resultRef === 'missing') return { kind: 'invalid', message: 'Source configuration does not exist' };
      if (result.resultRef === 'invalid')
        return { kind: 'invalid', message: 'Source draft needs review before copying' };
      return { kind: 'created', configId: result.resultRef };
    },
    async publish(
      actor: Actor,
      productId: string,
      data: {
        configId: string;
        draftVersion: string;
        idempotencyKey: string;
      },
    ): Promise<Outcome> {
      await product(actor, productId);
      const identity = command(actor, 'm5-publish-config', data.idempotencyKey, {
        productId,
        configId: data.configId,
        draftVersion: data.draftVersion,
      });
      const prior = await core.commands.lookup(identity);
      if (prior && prior.requestDigest !== identity.requestDigest)
        return { kind: 'conflict', message: 'Idempotency key was used for another request' };
      let resultRef = prior?.status === 'completed' ? prior.resultRef : null;
      if (!resultRef) {
        const before = await core.configs.getConfig(actor.tenantShopId, data.configId);
        if (
          !before ||
          before.externalProductId !== productNumber(productId) ||
          before.draftVersion !== data.draftVersion
        )
          return { kind: 'conflict', message: 'Draft changed. Reload before publication.' };
        let snapshot: MerchantDraft;
        try {
          snapshot = validatedDraft(before.draftValue, actor, productId);
        } catch {
          return { kind: 'invalid', message: 'Draft does not satisfy M2 configuration and geometry contracts' };
        }
        const eligibility = await input
          .eligibility(actor, snapshot)
          .catch(() => ({ allowed: false, reason: 'Entitlement unavailable' }));
        if (!eligibility.allowed)
          return { kind: 'forbidden', message: eligibility.reason ?? 'Publication feature unavailable' };
        const result = await executeCommand(core.transactions, core.commands, identity, async (tx) => {
          await currentLocked(actor, tx);
          const config = await core.configs.getConfigForUpdate(tx, actor.tenantShopId, data.configId);
          if (
            !config ||
            config.externalProductId !== productNumber(productId) ||
            config.draftVersion !== data.draftVersion
          )
            return 'conflict';
          const draft = validatedDraft(config.draftValue, actor, productId);
          const geometry = draft.geometry as GeometryV1;
          if (geometry.views.length === 0 || draft.placements.length === 0 || draft.methods.length === 0)
            return 'invalid';
          const revisionId = randomUUID();
          const published = draftPublished(draft, actor, productId, revisionId);
          const { revisionContentHash: _discard, ...content } = published;
          await core.configs.createValidatedRevision(tx, {
            shopId: actor.tenantShopId,
            configId: data.configId,
            revisionId,
            publishedValue: content,
            geometry: { version: GEOMETRY_VERSION, value: geometry },
            mode: draft.mode,
            createdByRef: actor.staffId,
          });
          return `${revisionId}:${draft.mode}`;
        });
        resultRef = result.resultRef;
      }
      if (resultRef === 'conflict') return { kind: 'conflict', message: 'Draft changed. Reload before publication.' };
      if (resultRef === 'invalid')
        return { kind: 'invalid', message: 'At least one view, placement and method is required' };
      const [revisionId, mode] = resultRef.split(':');
      if (!revisionId || (mode !== 'required' && mode !== 'optional'))
        throw new Error('Invalid durable publish result');
      const existing = await core.configs.getCurrentPublication(actor.tenantShopId, data.configId);
      if (existing && existing.operationId !== revisionId)
        return { kind: 'conflict', message: 'A newer publication request exists' };
      if (existing && ['active', 'activation-pending', 'conflict', 'operator-hold'].includes(existing.phase)) {
        const recorded = await core.configs.getConfig(actor.tenantShopId, data.configId);
        return {
          kind: 'accepted',
          revisionId,
          state: state(existing.phase, recorded?.effectiveOperationId ?? null, revisionId),
        };
      }
      // A command can commit its immutable revision before prepare or advance reaches Shopify.
      // Recovery must authorize that exact revision again; the editable draft may have changed.
      const revision = await core.configs.getValidatedPublishedRevision(actor.tenantShopId, revisionId);
      const geometry = await core.configs.getRevisionGeometry(actor.tenantShopId, revisionId);
      if (!revision || revision.configId !== data.configId || !geometry || geometry.mode !== mode)
        throw new Error('Immutable publication revision unavailable');
      const published = PublishedConfigSchema.parse(revision.publishedValue);
      const immutableDraft = MerchantDraftSchema.parse({
        version: 'm5-merchant-draft-v1',
        mode,
        shopCurrency: published.shopCurrency,
        methods: published.methods,
        placements: published.placements,
        productionOptions: published.productionOptions,
        pricingRules: published.pricingRules,
        geometry: geometry.value,
      });
      const currentEligibility = await input
        .eligibility(actor, immutableDraft)
        .catch(() => ({ allowed: false, reason: 'Entitlement unavailable' }));
      if (!currentEligibility.allowed)
        return { kind: 'forbidden', message: currentEligibility.reason ?? 'Publication feature unavailable' };
      await current(actor);
      const publication = input.publication(actor);
      const prepared = await publication.prepare({
        shopId: actor.tenantShopId,
        configId: data.configId,
        revisionId,
        operationId: revisionId,
        mode,
      });
      let phase: string = prepared.phase;
      for (let attempt = 0; attempt < 6; attempt++) {
        const advanced = await publication.advance(actor.tenantShopId, data.configId, prepared.operationId);
        phase = advanced.phase;
        if (advanced.kind !== 'PENDING') break;
      }
      return { kind: 'accepted', revisionId, state: state(phase, null, revisionId) };
    },
  };
}
