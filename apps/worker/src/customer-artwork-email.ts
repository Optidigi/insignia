import type { CustomerArtworkDeliveryOutcome } from '@insignia/application';

export type CustomerArtworkEmailProfile = {
  version: 'cloudflare-customer-artwork-email-v1';
  accountId: string;
  apiToken: string;
  from: 'noreply@optidigi.nl';
  appOrigin: string;
  mode: 'development' | 'customer';
};
export type CustomerArtworkEmailMessage = {
  tenantScope?: { shopId: string; installationGeneration: string };
  idempotencyKey: string;
  recipient: string;
  artworkUrl: string;
  expiresAt: string;
};
/** Cloudflare REST API: https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
 * X-Insignia-Notification is trace metadata, not a promise of provider-side idempotency.
 * Durable one-use claim/uncertain handling belongs to CustomerArtworkNotificationDelivery.
 */
export function createCloudflareCustomerArtworkSender(input: {
  profile: CustomerArtworkEmailProfile;
  fetchImpl?: typeof fetch;
  assertCustomerSending?: (scope: { shopId: string; installationGeneration: string }) => Promise<void>;
  clock?: () => Date;
}) {
  const { profile } = input;
  if (
    profile.version !== 'cloudflare-customer-artwork-email-v1' ||
    !/^(?:[a-f0-9]{32})$/.test(profile.accountId) ||
    !profile.apiToken ||
    /[\r\n\0]/.test(profile.apiToken) ||
    profile.from !== 'noreply@optidigi.nl' ||
    !['development', 'customer'].includes(profile.mode)
  )
    throw new Error('CUSTOMER_EMAIL_CONFIGURATION');
  const origin = new URL(profile.appOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('CUSTOMER_EMAIL_CONFIGURATION');
  if (profile.mode === 'customer' && !input.assertCustomerSending)
    throw new Error('CUSTOMER_EMAIL_QUALIFICATION_REQUIRED');
  const fetchImpl = input.fetchImpl ?? fetch;
  const clock = input.clock ?? (() => new Date());
  return {
    async send(message: CustomerArtworkEmailMessage): Promise<CustomerArtworkDeliveryOutcome> {
      if (
        !/^[a-f0-9-]{36}$/i.test(message.idempotencyKey) ||
        !message.recipient ||
        message.recipient.length > 254 ||
        /[\r\n\0]/.test(message.recipient) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.recipient)
      )
        return { kind: 'no-effect' };
      if (profile.mode === 'development' && message.recipient !== 'admin@optidigi.nl') return { kind: 'no-effect' };
      let link: URL;
      try {
        link = new URL(message.artworkUrl);
      } catch {
        return { kind: 'no-effect' };
      }
      if (
        link.origin !== origin.origin ||
        link.pathname !== '/artwork-upload' ||
        link.search ||
        !/^#capability=[a-f0-9]{64}$/.test(link.hash) ||
        !Number.isFinite(Date.parse(message.expiresAt)) ||
        Date.parse(message.expiresAt) <= +clock()
      )
        return { kind: 'no-effect' };
      if (profile.mode === 'customer') {
        try {
          if (!message.tenantScope?.shopId || !/^[1-9][0-9]*$/.test(message.tenantScope.installationGeneration))
            return { kind: 'no-effect' };
          await input.assertCustomerSending?.(message.tenantScope);
        } catch {
          return { kind: 'no-effect' };
        }
      }
      const body = {
        from: profile.from,
        to: message.recipient,
        subject:
          profile.mode === 'development' ? 'Insignia development artwork-email test' : 'Upload artwork for your order',
        text:
          profile.mode === 'development'
            ? `Insignia development email test. No order or payment is created by this message.\n\nPreview upload link:\n${message.artworkUrl}\n\nLink expiry: ${message.expiresAt}`
            : `Your order is missing artwork.\n\nUpload missing artwork:\n${message.artworkUrl}\n\nThis link expires at ${message.expiresAt}.\n\nOnly missing artwork can be submitted. Contact the store to change artwork already submitted.`,
        headers: { 'X-Insignia-Notification': message.idempotencyKey },
      };
      let response: Response;
      try {
        response = await fetchImpl(
          `https://api.cloudflare.com/client/v4/accounts/${profile.accountId}/email/sending/send`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${profile.apiToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          },
        );
      } catch {
        return { kind: 'uncertain' };
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        return { kind: 'uncertain' };
      }
      if (!value || typeof value !== 'object') return { kind: 'uncertain' };
      const envelope = value as Record<string, unknown>;
      if (response.ok && envelope.success === true && envelope.result && typeof envelope.result === 'object') {
        const result = envelope.result as Record<string, unknown>;
        const addresses = (key: string) => (Array.isArray(result[key]) ? (result[key] as unknown[]) : []);
        if (
          (addresses('delivered').includes(message.recipient) || addresses('queued').includes(message.recipient)) &&
          typeof result.message_id === 'string' &&
          result.message_id.length > 0 &&
          result.message_id.length <= 512 &&
          !/[\r\n\0]/.test(result.message_id)
        )
          return { kind: 'sent', receipt: result.message_id };
        if (
          addresses('permanent_bounces').includes(message.recipient) ||
          addresses('suppressed_recipients').includes(message.recipient)
        )
          return { kind: 'no-effect' };
        return { kind: 'uncertain' };
      }
      // Only a documented structured provider denial proves no effect; status alone does not.
      const noEffect = new Set([
        'email.sending.error.invalid_request_schema',
        'email.sending.error.email.too_big',
        'email.sending.error.email.no_content_length',
        'email.sending.error.email.invalid',
        'email.sending.error.email.recipient_suppressed',
        'email.sending.error.email.sending_disabled',
        'email.sending.error.email.sender_not_configured',
        'email.sending.error.email.account_suspended',
        'email.sending.error.email.sending_not_ready',
        'email.sending.error.throttled',
        'email.sending.error.authentication.unauthorized',
        'email.sending.error.authentication.bad_token_type',
        'email.sending.error.authentication.forbidden',
        'email.sending.error.authentication.not_entitled',
      ]);
      if (
        envelope.success === false &&
        envelope.result === null &&
        Array.isArray(envelope.errors) &&
        envelope.errors.length > 0 &&
        envelope.errors.every(
          (error) =>
            error &&
            typeof error === 'object' &&
            'message' in error &&
            typeof error.message === 'string' &&
            noEffect.has(error.message),
        )
      )
        return { kind: 'no-effect' };
      return { kind: 'uncertain' };
    },
  };
}
