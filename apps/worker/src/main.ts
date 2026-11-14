import { createAdminReadCredentialSource } from '@insignia/application';
import { currencyExponent } from '@insignia/cart-authorization';
import {
  createReleaseVerificationClient,
  createShopifyOfflineRefreshTransport,
  readShopifyOrder,
  readShopifyOrderChanges,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';
import { loadCredentialKeys } from './config.js';
import { createWorkerDatabase } from './database.js';
import { runLocalDiagnostic } from './diagnostic.js';
import { createDurableWorkerHandlers, credentialLifecycle } from './handlers.js';
import { startWorkerProcess } from './process.js';
import { createWorkerPublicationAbandonment } from './publication-abandonment.js';
import { createProductionPurchaseAdmission, resolveNativePurchaseQualification } from './purchase-admission.js';
import { createPurchaseReleasePreparation } from './purchase-release.js';
import { createPurchaseRunner } from './purchase-runner.js';
import { createWorkerReconciliation } from './reconciliation.js';
import { createAutomaticUninstallEnrollment, createUninstallEnrollmentReconciliation } from './uninstall-enrollment.js';
import { createWorkerUsageRuntime } from './usage-runtime.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv.includes('--diagnostic')) {
  console.log(JSON.stringify(await runLocalDiagnostic()));
} else {
  if (process.env.INSIGNIA_ARTWORK_HOST_RUNNER === '1')
    throw new Error('Use the dedicated artwork inspection entrypoint');
  const connectionString = required('DATABASE_URL');
  const keys = loadCredentialKeys(process.env);
  const clientId = required('SHOPIFY_CLIENT_ID');
  const clientSecret = required('SHOPIFY_CLIENT_SECRET');
  const portArgument = process.argv.find((value) => value.startsWith('--port='));
  const port = portArgument ? Number(portArgument.slice('--port='.length)) : 4301;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid worker port');
  const { core, queue } = createWorkerDatabase(connectionString, keys);
  const usage = createWorkerUsageRuntime({ env: process.env, core });
  const transport = createShopifyOfflineRefreshTransport({ clientId, clientSecret });
  // The shop's offline token (the app's granted scopes) through M3's fenced refresh lifecycle.
  // Purchase and lifecycle reads use it; so does #466's abandoned-hold restore, for exactly one
  // status-only product write (spec §6.1 offline-token exception).
  const offlineCredentials = createAdminReadCredentialSource({
    tenants: core.tenants,
    credentials: credentialLifecycle(core),
    refresh: transport,
  });
  // #466 B. Validated before the worker starts: a bound outside its range is a startup error.
  const publicationAbandonment = createWorkerPublicationAbandonment({
    core,
    env: process.env,
    appClientId: clientId,
    credentials: offlineCredentials,
    observability: queue.observability,
  });
  const releaseProfile =
    process.env.INSIGNIA_M8_PURCHASE_ENABLED === '1'
      ? resolveRuntimeReleaseProfile(process.env.INSIGNIA_RELEASE_PROFILE)
      : undefined;
  const qualification = releaseProfile
    ? resolveNativePurchaseQualification({
        appId: required('INSIGNIA_SHOPIFY_APP_ID'),
        appClientId: clientId,
        releaseProfile: releaseProfile.name,
      })
    : null;
  const checkout = releaseProfile
    ? createProductionPurchaseAdmission({
        core,
        credentials: offlineCredentials,
        qualification,
        releaseProfile: releaseProfile.name,
      })
    : undefined;
  const prepareRelease =
    checkout && releaseProfile
      ? createPurchaseReleasePreparation({
          core,
          collector: createReleaseVerificationClient(undefined, releaseProfile.activeVersionRef),
          qualification,
          releaseProfile: releaseProfile.name,
        })
      : undefined;
  const purchaseRunner =
    process.env.INSIGNIA_M8_PURCHASE_ENABLED === '1'
      ? createPurchaseRunner({
          core,
          checkout,
          prepareRelease,
          orders: {
            read: (target) =>
              readShopifyOrder(target, {
                credentials: offlineCredentials,
                currency: { exponent: (code) => currencyExponent(code) ?? null },
              }),
            changes: (target) => readShopifyOrderChanges(target, { credentials: offlineCredentials }),
          },
          onError: (errorClass) => queue.observability.logger.error('queue_job_rejected', { errorClass }),
        })
      : undefined;
  const running = await startWorkerProcess({
    queue,
    handlers: createDurableWorkerHandlers(core, transport, purchaseRunner),
    port,
  });
  console.log(JSON.stringify({ url: running.url, durableReady: running.durableReady }));
  const lifecycle = createUninstallEnrollmentReconciliation({
    core,
    credentials: offlineCredentials,
    enroll: createAutomaticUninstallEnrollment({
      core,
      appOrigin: required('APP_URL'),
      appClientId: clientId,
      appSecret: clientSecret,
    }),
    logger: queue.observability.logger,
  });
  const reconciliation = createWorkerReconciliation({
    core,
    queue,
    purchases: purchaseRunner,
    usage,
    lifecycle,
    publicationAbandonment,
  });
  const recoveryTimer = setInterval(() => {
    void reconciliation.runOnce();
  }, 30_000);
  recoveryTimer.unref();
  void reconciliation.runOnce();
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      clearInterval(recoveryTimer);
      void (async () => {
        await reconciliation.stop();
        await running.stop();
        await core.close();
      })();
    });
  }
}
