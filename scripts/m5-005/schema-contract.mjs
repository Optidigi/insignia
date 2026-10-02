import { readFileSync } from 'node:fs';
export const IDENTITY = `query M5005Identity {
  shop { id myshopifyDomain plan { partnerDevelopment displayName } }
  currentAppInstallation { id app { id apiKey } accessScopes { handle } }
}`;
export const DECLARED = `query M5005DeclaredScopes {
  currentAppInstallation {
    id
    app { id apiKey requestedAccessScopes { handle } optionalAccessScopes { handle } }
  }
}`;
export const contract = JSON.parse(readFileSync(new URL('./schema-contract.json', import.meta.url)));
// These two no-argument documents use only names/braces. This deliberately is
// a bounded documented-field validator, not a general GraphQL/SDL validator.
export function validateDocument(document) {
  if (contract.apiVersion !== '2026-07') throw new Error('schema_version');
  const tokens = document.match(/[A-Za-z_][A-Za-z0-9_]*|[{}]|\S/g) ?? [];
  let at = 0;
  if (tokens[at++] !== 'query' || !/^M5005(Identity|DeclaredScopes)$/.test(tokens[at++] ?? ''))
    throw new Error('query_only');
  function selection(type) {
    if (tokens[at++] !== '{') throw new Error('selection');
    const seen = new Set();
    while (tokens[at] !== '}') {
      const name = tokens[at++],
        fieldType = contract.fields[type]?.[name];
      if (!fieldType || seen.has(name)) throw new Error('undocumented_field');
      seen.add(name);
      const child = fieldType.replace(/[[\]!]/g, '');
      if (contract.fields[child]) selection(child);
      else if (!['ID', 'String', 'Boolean'].includes(child) || tokens[at] === '{') throw new Error('field_type');
    }
    if (!seen.size) throw new Error('empty_selection');
    at++;
  }
  selection('Query');
  if (at !== tokens.length) throw new Error('trailing_document');
  return true;
}
export function validatedDocuments() {
  return Object.fromEntries(
    [
      ['identity', IDENTITY],
      ['declared', DECLARED],
    ].map(([kind, query]) => {
      try {
        return [kind, validateDocument(query)];
      } catch {
        return [kind, false];
      }
    }),
  );
}
