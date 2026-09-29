import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { createDatabase, type Database, withTransaction } from '../../src/client/database.js';
import { createTenantRepository } from '../../src/repositories/tenant.js';

export async function openTestDatabase(): Promise<Kysely<Database>> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
  const database = createDatabase(new Pool({ connectionString, max: 8 }));
  const version = await sql<{ server_version_num: string }>`show server_version_num`.execute(database);
  const number = Number(version.rows[0]?.server_version_num);
  if (Math.floor(number / 10000) !== 18) {
    await database.destroy();
    throw new Error(`PostgreSQL 18 required; server_version_num=${number}`);
  }
  return database;
}

export async function createTestShop(database: Kysely<Database>): Promise<{ shopId: string; generation: string }> {
  const shopId = randomUUID();
  await withTransaction(database, async (transaction) => {
    await createTenantRepository(transaction).createShop(transaction, {
      shopId,
      shopDomain: `${shopId}.test.example`,
    });
  });
  return { shopId, generation: '1' };
}
