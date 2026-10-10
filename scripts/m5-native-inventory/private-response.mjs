// Check all lexical strings, including values discarded by duplicate JSON keys.
// This bounds literal/JSON-escaped reflection, not arbitrary covert encoding.
export function privateResponseCategory(bytes, secrets) {
  if (secrets.some((secret) => bytes.includes(Buffer.from(secret)))) return 'SECRET_REFLECTION';
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    JSON.parse(text);
  } catch {
    return 'INVALID_JSON';
  }
  for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/gs)) {
    let value;
    try {
      value = JSON.parse(match[0]);
    } catch {
      return 'INVALID_JSON';
    }
    if (secrets.some((secret) => value.includes(secret))) return 'SECRET_REFLECTION';
  }
  return undefined;
}
