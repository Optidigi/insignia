import { createCustomerArtworkLinks, createCustomerArtworkNotificationDelivery } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { createCustomerArtworkRecipientReader } from '@insignia/shopify';
import { Pool } from 'pg';
import { loadCredentialKeys } from '../../../../worker/src/config.ts';
import { createCloudflareCustomerArtworkSender } from '../../../../worker/src/customer-artwork-email.ts';
import { loadCustomerArtworkEmailProfile } from '../../../../worker/src/customer-artwork-email-profile.ts';
import { webObservability } from '../observability.ts';
import { loadCustomerEmailQualification } from './notification-qualification.ts';
import { createCustomerArtworkNotificationRunner } from './notification-runner.ts';
import { createCustomerArtworkRuntimeView } from './view.ts';

type Runtime =
  | { state: 'disabled' | 'unavailable'; reason?: string }
  | { state: 'configured'; runner: ReturnType<typeof createCustomerArtworkNotificationRunner> };
let pending: Promise<Runtime> | undefined;
/** Private profile is explicit deployment configuration. No profile means no timer, credential read or DB allocation. */
export function ensureCustomerArtworkNotificationRuntime(env: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
  if (env.INSIGNIA_CUSTOMER_EMAIL_ENABLED !== '1' || !env.CUSTOMER_ARTWORK_EMAIL_PROFILE)
    return Promise.resolve({ state: 'disabled' });
  const profilePath = env.CUSTOMER_ARTWORK_EMAIL_PROFILE;
  pending ??= (async (): Promise<Runtime> => {
    let core: ReturnType<typeof createDurableCore> | undefined;
    try {
      if (!env.APP_URL || !env.DATABASE_URL || !env.SHOPIFY_CLIENT_SECRET || !env.SHOPIFY_CLIENT_ID)
        throw new Error('CUSTOMER_EMAIL_CONFIGURATION');
      const profile = await loadCustomerArtworkEmailProfile(profilePath, {
        appOrigin: env.APP_URL,
        artifactRoot: process.cwd(),
      });
      const expected = {
        accountId: profile.accountId,
        appOrigin: profile.appOrigin,
        appClientId: env.SHOPIFY_CLIENT_ID,
        artifactRoot: process.cwd(),
      };
      const qualification = async () => {
        if (!env.CUSTOMER_ARTWORK_EMAIL_QUALIFICATION_PROFILE)
          throw new Error('CUSTOMER_EMAIL_QUALIFICATION_UNAVAILABLE');
        return loadCustomerEmailQualification(env.CUSTOMER_ARTWORK_EMAIL_QUALIFICATION_PROFILE, expected);
      };
      if (profile.mode === 'customer') await qualification();
      const rawIds: unknown = env.INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES
        ? JSON.parse(env.INSIGNIA_CUSTOMER_EMAIL_DEVELOPMENT_NOTICES)
        : [];
      if (
        !Array.isArray(rawIds) ||
        rawIds.length > 10 ||
        rawIds.some(
          (id) => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),
        )
      )
        throw new Error('CUSTOMER_EMAIL_DEVELOPMENT_ALLOCATION_INVALID');
      const allowed = new Set<string>(rawIds);
      core = createDurableCore(
        new Pool({
          connectionString: env.DATABASE_URL,
          max: 2,
          allowExitOnIdle: true,
          connectionTimeoutMillis: 5000,
          query_timeout: 10000,
          statement_timeout: 10000,
        }),
        profile.mode === 'customer' ? { credentialKeys: loadCredentialKeys(env) } : {},
      );
      const owned = core;
      let activeSignal: AbortSignal | undefined;
      const fetchImpl: typeof fetch = (url, init) =>
        fetch(url, {
          ...init,
          signal: activeSignal ? AbortSignal.any([activeSignal, ...(init?.signal ? [init.signal] : [])]) : init?.signal,
        });
      const recipient = createCustomerArtworkRecipientReader({
        fetchImpl,
        credentials: {
          async acquire(target) {
            const scope = await owned.tenants.getActiveAuthorizationScope(target);
            if (!scope) return { kind: 'inactive' };
            const credential = await owned.credentials.readUsable({ ...scope, minimumRemainingMs: 30000 });
            const metadata = await owned.credentials.metadata(target);
            if (!credential || !metadata?.scopes || !new Set(metadata.scopes.split(/[ ,]+/)).has('read_orders'))
              return { kind: 'temporarily_unavailable' };
            const current = await owned.tenants.getActiveAuthorizationScope(target);
            if (
              !current ||
              current.authorizationGeneration !== scope.authorizationGeneration ||
              current.authorizationEpoch !== scope.authorizationEpoch
            )
              return { kind: 'inactive' };
            return {
              kind: 'usable',
              shopDomain: scope.shopDomain,
              accessToken: credential.accessToken,
              authorizationBinding: JSON.stringify([scope.authorizationGeneration, scope.authorizationEpoch]),
              accessExpiresAt: credential.accessExpiresAt,
            };
          },
        },
      });
      const sender = createCloudflareCustomerArtworkSender({
        profile,
        fetchImpl,
        ...(profile.mode === 'customer'
          ? {
              assertCustomerSending: async (scope) => {
                const approved = await qualification();
                if (
                  !approved.tenantScopes.some(
                    (target) =>
                      target.shopId === scope.shopId && target.installationGeneration === scope.installationGeneration,
                  )
                )
                  throw new Error('CUSTOMER_EMAIL_RECIPIENT_UNAVAILABLE');
              },
            }
          : {}),
      });
      const links = createCustomerArtworkLinks({
        store: owned.customerArtwork,
        secret: env.SHOPIFY_CLIENT_SECRET,
        appOrigin: profile.appOrigin,
      });
      const customerView = await createCustomerArtworkRuntimeView({ core: owned, links, env });
      if (!customerView) throw new Error('CUSTOMER_EMAIL_PORTAL_UNAVAILABLE');
      const readyLinks = {
        ...links,
        async issue(...args: Parameters<typeof links.issue>) {
          const link = await links.issue(...args);
          const capability = new URLSearchParams(new URL(link.url).hash.slice(1)).get('capability');
          if (!capability) throw new Error('CUSTOMER_EMAIL_PORTAL_UNAVAILABLE');
          await customerView(capability);
          return link;
        },
      };
      const store = {
        ...owned.customerArtwork,
        async pendingNotifications(limit: number) {
          if (profile.mode === 'development' && !allowed.size) return [];
          const selected = await owned.customerArtwork.pendingNotifications(
            profile.mode === 'development' ? 100 : limit,
          );
          if (profile.mode === 'development')
            return selected.filter((notice) => allowed.has(notice.notificationId)).slice(0, limit);
          const approved = await qualification();
          return selected
            .filter((notice) =>
              approved.tenantScopes.some(
                (scope) =>
                  scope.shopId === notice.shopId && scope.installationGeneration === notice.installationGeneration,
              ),
            )
            .slice(0, limit);
        },
      };
      const delivery = createCustomerArtworkNotificationDelivery({
        store,
        links: readyLinks,
        sender,
        recipients: {
          async read(scope, orderId) {
            if (profile.mode === 'development') return 'admin@optidigi.nl';
            const approved = await qualification();
            if (
              !approved.tenantScopes.some(
                (target) =>
                  target.shopId === scope.shopId && target.installationGeneration === scope.installationGeneration,
              )
            )
              throw new Error('CUSTOMER_EMAIL_RECIPIENT_UNAVAILABLE');
            const email = await recipient.read({ ...scope, orderId });
            if (!email) throw new Error('CUSTOMER_EMAIL_RECIPIENT_UNAVAILABLE');
            return email;
          },
        },
      });
      const runner = createCustomerArtworkNotificationRunner({
        async deliver(signal) {
          activeSignal = signal;
          try {
            const result = await delivery.deliverPending(1);
            if (result.sent) webObservability.logger.info('customer_artwork_notification', { count: result.sent });
            return { ...result, ...(result.deferred || result.uncertain ? { unavailable: true } : {}) };
          } finally {
            activeSignal = undefined;
          }
        },
        close: () => owned.close(),
        onUnavailable: () =>
          webObservability.logger.error('customer_artwork_notification', {
            errorClass: 'CUSTOMER_EMAIL_RUNTIME_UNAVAILABLE',
          }),
      });
      runner.start();
      process.once('beforeExit', () => {
        void runner.stop().catch(() =>
          webObservability.logger.error('customer_artwork_notification', {
            errorClass: 'CUSTOMER_EMAIL_RUNTIME_UNAVAILABLE',
          }),
        );
      });
      return { state: 'configured', runner };
    } catch {
      await core?.close();
      webObservability.logger.error('customer_artwork_notification', {
        errorClass: 'CUSTOMER_EMAIL_RUNTIME_UNAVAILABLE',
      });
      return { state: 'unavailable', reason: 'CUSTOMER_EMAIL_RUNTIME_UNAVAILABLE' };
    }
  })();
  return pending;
}
