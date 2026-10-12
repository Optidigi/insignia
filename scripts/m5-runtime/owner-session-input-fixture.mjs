import { createHmac } from 'node:crypto';
export const origin = 'https://insignia-app.optidigi.nl';
const shop = 'insignia-rewrite-dev.myshopify.com';
const key = '1443cf6d03d39edae7c101a943c5c684';
const secret = 'SYNTHETIC_OWNER_INPUT_SECRET';
export const nonce = 'a'.repeat(64);
export function token(overrides = {}, signingSecret = secret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    aud: key,
    sub: '23',
    sid: 'synthetic-owner-session',
    dest: `https://${shop}`,
    iss: `https://${shop}/admin`,
    iat: now,
    nbf: now - 1,
    exp: now + 60,
    ...overrides,
  })}`;
  return `${signed}.${createHmac('sha256', signingSecret).update(signed).digest('base64url')}`;
}
