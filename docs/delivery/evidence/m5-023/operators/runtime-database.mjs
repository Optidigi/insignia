// Read-only actual pg session qualification. No provider transport or raw error output.
import { createRequire } from 'node:module';

export async function qualifyRuntimeDatabase({ entry, serverAddresses, database = 'insignia_rewrite' }) {
  let client;
  let qualified = false;
  try {
    const { Client } = createRequire(entry)('pg');
    client = new Client({ connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000, query_timeout: 5000 });
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`SELECT current_database() AS database,
      current_user AS role, current_schema() AS schema, host(inet_server_addr()) AS address,
      current_setting('server_version_num')::integer / 10000 AS major,
      NOT EXISTS(SELECT 1 FROM unnest(ARRAY['shops','installation_generations','shop_credentials',
        'product_configs','publication_operations','inbox_messages','shopify_webhook_deliveries']) AS required(name)
        WHERE to_regclass(required.name) IS DISTINCT FROM to_regclass('public.'||required.name)
          OR to_regclass('public.'||required.name) IS NULL) AS relations_exact`);
    const row = result.rows[0];
    qualified = result.rows.length === 1 && row.database === database
      && row.role === 'insignia_runtime' && row.schema === 'public' && row.major === 18
      && serverAddresses.includes(row.address) && row.relations_exact === true;
    await client.query('ROLLBACK');
  } catch {
    qualified = false;
  } finally {
    if (client) {
      try { await client.end(); } catch { qualified = false; }
    }
  }
  return { qualified };
}
