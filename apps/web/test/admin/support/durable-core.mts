import type { DurableCore } from '@insignia/database';

const unexpected = (): never => {
  throw new Error('Unexpected durable core fixture boundary');
};
type Overrides = {
  uninstallLifecycle?: Partial<DurableCore['uninstallLifecycle']>;
  uninstallPrivacy?: Partial<DurableCore['uninstallPrivacy']>;
  methodCatalog?: Partial<DurableCore['methodCatalog']>;
  customerPrivacy?: Partial<DurableCore['customerPrivacy']>;
  usageLedger?: Partial<DurableCore['usageLedger']>;
  usageDeliveryIntents?: Partial<DurableCore['usageDeliveryIntents']>;
  purchases?: Partial<DurableCore['purchases']>;
  buyers?: Partial<DurableCore['buyers']>;
  renewalQuotes?: Partial<DurableCore['renewalQuotes']>;
  trustedReleaseRecords?: Partial<DurableCore['trustedReleaseRecords']>;
  signingKeys?: Partial<DurableCore['signingKeys']>;
  productionPublications?: Partial<DurableCore['productionPublications']>;
  productionActivations?: Partial<DurableCore['productionActivations']>;
  acceptedQuotes?: Partial<DurableCore['acceptedQuotes']>;
  transactions?: Partial<DurableCore['transactions']>;
  commands?: Partial<DurableCore['commands']>;
  inbox?: Partial<DurableCore['inbox']>;
  outbox?: Partial<DurableCore['outbox']>;
  configs?: Partial<DurableCore['configs']>;
  artwork?: Partial<DurableCore['artwork']>;
  merchantPreviews?: Partial<DurableCore['merchantPreviews']>;
  tenants?: Partial<DurableCore['tenants']>;
  webhooks?: Partial<DurableCore['webhooks']>;
  credentials?: Partial<DurableCore['credentials']>;
  close?: DurableCore['close'];
};
export function fixtureCore(overrides: Overrides = {}): DurableCore {
  return {
    uninstallLifecycle: {
      coverGenericCleanup: unexpected,
      repairVersion: unexpected,
      retire: unexpected,
      listActive: unexpected,
      reserve: unexpected,
      dispatch: unexpected,
      settle: unexpected,
      ...overrides.uninstallLifecycle,
    },
    uninstallPrivacy: {
      recover: unexpected,
      recoverPending: unexpected,
      status: unexpected,
      ...overrides.uninstallPrivacy,
    },
    methodCatalog: {
      list: unexpected,
      create: unexpected,
      rename: unexpected,
      delete: unexpected,
      ...overrides.methodCatalog,
    },
    customerPrivacy: {
      blockedShopErasureCount: unexpected,
      cleanupInboxes: unexpected,
      listDataRequests: unexpected,
      readDataRequest: unexpected,
      exportOrder: unexpected,
      processInbox: unexpected,
      ...overrides.customerPrivacy,
    },
    usageLedger: {
      selectPending: unexpected,
      get: unexpected,
      record: unexpected,
      ...overrides.usageLedger,
    },
    usageDeliveryIntents: {
      get: unexpected,
      prepare: unexpected,
      ...overrides.usageDeliveryIntents,
    },
    purchases: {
      requestReconciliation: unexpected,
      reconcile: unexpected,
      getPurchaseReconciliationHint: unexpected,
      selectPurchaseRecoveryHints: unexpected,
      claimPurchaseReconciliationHint: unexpected,
      failPurchaseReconciliation: unexpected,
      get: unexpected,
      list: unexpected,
      getOffer: unexpected,
      appendArtwork: unexpected,
      lockArtwork: unexpected,
      getAuthorizedArtwork: unexpected,
      cleanupDue: unexpected,
      claimPurchaseDiscovery: unexpected,
      completePurchaseDiscovery: unexpected,
      failPurchaseDiscovery: unexpected,
      ...overrides.purchases,
    },
    buyers: {
      admitRequest: unexpected,
      reserveCommand: unexpected,
      completeCommand: unexpected,
      finishApplication: unexpected,
      issueSession: unexpected,
      getSession: unexpected,
      saveDesign: unexpected,
      getDesign: unexpected,
      putProposal: unexpected,
      getProposal: unexpected,
      linkQuote: unexpected,
      getOwnedQuote: unexpected,
      getQuoteDesign: unexpected,
      getLatestOwnedQuote: unexpected,
      getOwnedSet: unexpected,
      getApplication: unexpected,
      createApplication: unexpected,
      confirmApplication: unexpected,
      cleanupDue: unexpected,
      cleanupExpired: unexpected,
      ...overrides.buyers,
    },
    renewalQuotes: {
      getOwned: unexpected,
      findCompleted: unexpected,
      renew: unexpected,
      ...overrides.renewalQuotes,
    },
    trustedReleaseRecords: {
      read: unexpected,
      ...overrides.trustedReleaseRecords,
    },
    signingKeys: {
      getActiveScope: unexpected,
      list: unexpected,
      createPending: unexpected,
      activate: unexpected,
      revoke: unexpected,
      destroy: unexpected,
      destroyInactiveInstallationKeys: unexpected,
      incrementEpoch: unexpected,
      ...overrides.signingKeys,
    },
    productionPublications: {
      create: unexpected,
      ...overrides.productionPublications,
    },
    productionActivations: {
      create: unexpected,
      ...overrides.productionActivations,
    },
    acceptedQuotes: {
      findCompleted: unexpected,
      accept: unexpected,
      getEffective: unexpected,
      ...overrides.acceptedQuotes,
    },
    transactions: {
      run: unexpected,
      ...overrides.transactions,
    },
    commands: {
      reserve: unexpected,
      complete: unexpected,
      lookup: unexpected,
      ...overrides.commands,
    },
    inbox: {
      receive: unexpected,
      lockForProcessing: unexpected,
      markProcessed: unexpected,
      recordFailure: unexpected,
      ...overrides.inbox,
    },
    outbox: {
      add: unexpected,
      claim: unexpected,
      acknowledge: unexpected,
      ...overrides.outbox,
    },
    configs: {
      createConfig: unexpected,
      getConfig: unexpected,
      getConfigInTransaction: unexpected,
      getConfigForUpdate: unexpected,
      getByProduct: unexpected,
      getByProductForUpdate: unexpected,
      updateDraft: unexpected,
      getRevision: unexpected,
      getValidatedPublishedRevision: unexpected,
      createValidatedRevision: unexpected,
      getRevisionGeometry: unexpected,
      getRevisionPresentation: unexpected,
      getRevisionSourceScope: unexpected,
      getCurrentPublication: unexpected,
      getAvailabilityRecovery: unexpected,
      getAvailabilityRecoveryInTransaction: unexpected,
      getCurrentPublicationInTransaction: unexpected,
      setCurrentPublicationPointer: unexpected,
      ...overrides.configs,
    },
    artwork: {
      create: unexpected,
      get: unexpected,
      complete: unexpected,
      claim: unexpected,
      prepare: unexpected,
      settle: unexpected,
      reject: unexpected,
      release: unexpected,
      selectPending: unexpected,
      selectExpired: unexpected,
      markDeleting: unexpected,
      finishDeleting: unexpected,
      selectQuarantineCleanup: unexpected,
      markQuarantineCleanupAttempt: unexpected,
      markQuarantineCleaned: unexpected,
      readUsability: unexpected,
      ...overrides.artwork,
    },
    merchantPreviews: {
      getForRevision: unexpected,
      get: unexpected,
      prepare: unexpected,
      beginCapture: unexpected,
      finishCapture: unexpected,
      selectCleanup: unexpected,
      markDeleting: unexpected,
      readDeleting: unexpected,
      finishDeleting: unexpected,
      ...overrides.merchantPreviews,
    },
    tenants: {
      getManagedInstallationState: unexpected,
      ensureManagedInstallation: unexpected,
      getShop: unexpected,
      getShopByDomain: unexpected,
      getUsageInstallationWindow: unexpected,
      getCurrentAdminInstallation: unexpected,
      getActiveAuthorizationScope: unexpected,
      lockActiveAuthorizationScope: unexpected,
      getActiveProviderScope: unexpected,
      createShop: unexpected,
      startInstallation: unexpected,
      deactivateCurrent: unexpected,
      ...overrides.tenants,
    },
    webhooks: {
      withQueueHandoff: unexpected,
      cleanupExpiredQueueJobs: unexpected,
      eraseExpiredPayloads: unexpected,
      unresolvedBacklogCount: unexpected,
      pendingUninstallIds: unexpected,
      selectUninstallRecoveryIds: unexpected,
      receive: unexpected,
      getById: unexpected,
      processUninstall: unexpected,
      ...overrides.webhooks,
    },
    credentials: {
      readUsable: unexpected,
      reserveAcquisition: unexpected,
      dispatchAcquisition: unexpected,
      completeAcquisition: unexpected,
      rejectAcquisition: unexpected,
      install: unexpected,
      acquire: unexpected,
      replaceClaim: unexpected,
      releaseClaim: unexpected,
      markReauthRequired: unexpected,
      metadata: unexpected,
      ...overrides.credentials,
    },
    close: overrides.close ?? unexpected,
  };
}
