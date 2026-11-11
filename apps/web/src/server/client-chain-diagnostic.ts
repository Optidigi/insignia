import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * TEMPORARY (owner decision B, 11 November 2026): verifies what the Cloudflare
 * `X-Insignia-Client-Chain` header carries before a per-visitor limit trusts it.
 * Enabled only by INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC=1. Logs no address: per entry,
 * only its family and a 24-bit prefix of a salted hash. Remove with the limit.
 */
const prefix = (value: string) =>
  createHash('sha256').update(`insignia-chain-diag-v1|${value}`).digest('hex').slice(0, 6);
const entries = (header: string | null) =>
  header === null
    ? null
    : header.split(',').map((raw) => {
        const value = raw.trim();
        const family = isIP(value);
        return { family: family === 4 ? 'v4' : family === 6 ? 'v6' : 'invalid', hash: family ? prefix(value) : null };
      });

export function logClientChainDiagnostic(request: Request, env = process.env) {
  if (env.INSIGNIA_CLIENT_CHAIN_DIAGNOSTIC !== '1') return;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/artwork/')) return;
  const host = request.headers.get('host') ?? '';
  console.log(
    JSON.stringify({
      event: 'client_chain_diagnostic',
      host:
        host === 'app.insigniacustomizer.com' ? 'canonical' : host === 'insignia-app.optidigi.nl' ? 'legacy' : 'other',
      chain: entries(request.headers.get('x-insignia-client-chain')),
      forwardedFor: entries(request.headers.get('x-forwarded-for')),
      connectingIp: entries(request.headers.get('cf-connecting-ip')),
    }),
  );
}
