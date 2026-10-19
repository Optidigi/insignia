import { createAdminReadCredentialSource } from '@insignia/application';
import { currencyExponent } from '@insignia/cart-authorization';
import { createDurableCore } from '@insignia/database';
import {
  createReleaseVerificationClient,
  createShopifyOfflineRefreshTransport,
  readShopifyOrder,
  readShopifyOrderChanges,
  resolveRuntimeReleaseProfile,
} from '@insignia/shopify';
import { Pool } from 'pg';
import { loadCredentialKeys } from './config.js';
import { runLocalDiagnostic } from './diagnostic.js';
import { createDurableWorkerHandlers, credentialLifecycle } from './handlers.js';
import { startWorkerProcess } from './process.js';
import { createProductionPurchaseAdmission, resolveNativePurchaseQualification } from './purchase-admission.js';
import { createPurchaseReleasePreparation } from './purchase-release.js';
import { createPurchaseRunner } from './purchase-runner.js';
import { createWorkerReconciliation } from './reconciliation.js';
import { createPgBossRuntime } from './runtime.js';
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
  const core = createDurableCore(
    new Pool({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000 }),
    { credentialKeys: keys },
  );
  const usage = createWorkerUsageRuntime({ env: process.env, core });
  const queue = createPgBossRuntime({ connectionString, credentialKeysReady: true, webhookHandoff: core.webhooks });
  const transport = createShopifyOfflineRefreshTransport({ clientId, clientSecret });
  const purchaseCredentials = createAdminReadCredentialSource({
    tenants: core.tenants,
    credentials: credentialLifecycle(core),
    refresh: transport,
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
        credentials: purchaseCredentials,
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
                credentials: purchaseCredentials,
                currency: { exponent: (code) => currencyExponent(code) ?? null },
              }),
            changes: (target) => readShopifyOrderChanges(target, { credentials: purchaseCredentials }),
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
    credentials: purchaseCredentials,
    enroll: createAutomaticUninstallEnrollment({
      core,
      appOrigin: required('APP_URL'),
      appClientId: clientId,
      appSecret: clientSecret,
    }),
  });
  const reconciliation = createWorkerReconciliation({ core, queue, purchases: purchaseRunner, usage, lifecycle });
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
