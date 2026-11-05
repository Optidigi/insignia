import type { AdminCredentialSource } from '../contextual-pricing.js';

type Credential = Awaited<ReturnType<AdminCredentialSource['acquire']>>;
type RecipientCredential =
  | Exclude<Credential, { kind: 'usable' }>
  | (Extract<Credential, { kind: 'usable' }> & { authorizationBinding: string });
export type CustomerArtworkOrderTarget = { shopId: string; installationGeneration: string; orderId: string };
const query = 'query InsigniaCustomerArtworkRecipient($id:ID!){order(id:$id){id email cancelledAt}}';
/** Purpose-specific protected order-email read. Safe order-presentation DTOs remain unchanged. */
export function createCustomerArtworkRecipientReader(input: {
  credentials: { acquire(scope: { shopId: string; installationGeneration: string }): Promise<RecipientCredential> };
  fetchImpl?: typeof fetch;
  clock?: () => Date;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const clock = input.clock ?? (() => new Date());
  return {
    async read(target: CustomerArtworkOrderTarget): Promise<string | null> {
      if (
        !target.shopId ||
        !/^[1-9][0-9]*$/.test(target.installationGeneration) ||
        !/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(target.orderId)
      )
        return null;
      const credential = await input.credentials.acquire(target);
      if (
        credential.kind !== 'usable' ||
        typeof credential.authorizationBinding !== 'string' ||
        !credential.authorizationBinding ||
        !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/.test(credential.shopDomain) ||
        credential.accessExpiresAt <= clock()
      )
        return null;
      try {
        const response = await fetchImpl(`https://${credential.shopDomain}/admin/api/2026-07/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': credential.accessToken },
          body: JSON.stringify({ query, variables: { id: target.orderId } }),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok || !response.body) return null;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 32768) {
            void reader.cancel().catch(() => {});
            return null;
          }
          chunks.push(part.value);
        }
        const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (!raw || typeof raw !== 'object' || ('errors' in raw && Array.isArray(raw.errors) && raw.errors.length))
          return null;
        if (
          !('data' in raw) ||
          !raw.data ||
          typeof raw.data !== 'object' ||
          !('order' in raw.data) ||
          !raw.data.order ||
          typeof raw.data.order !== 'object'
        )
          return null;
        const order = raw.data.order;
        if (
          !('id' in order) ||
          order.id !== target.orderId ||
          !('cancelledAt' in order) ||
          order.cancelledAt !== null ||
          !('email' in order) ||
          typeof order.email !== 'string' ||
          order.email.length > 254 ||
          /[\r\n\0]/.test(order.email) ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.email)
        )
          return null;
        const current = await input.credentials.acquire(target);
        if (
          current.kind !== 'usable' ||
          current.shopDomain !== credential.shopDomain ||
          current.authorizationBinding !== credential.authorizationBinding ||
          current.accessExpiresAt <= clock()
        )
          return null;
        return order.email;
      } catch {
        return null;
      }
    },
  };
}
