import { AsyncLocalStorage } from 'node:async_hooks';
import type { Kysely } from 'kysely';
import type { Database } from './database.js';

type Fence = { database: Kysely<Database>; transaction: Kysely<Database> };
const fence = new AsyncLocalStorage<Fence>();

/**
 * Runs the acceptance (or renewal) fence's signing callback so that stored-fact reads made inside it (active
 * authorization scope and signing keys) use the fence transaction's own connection (#381). The fence
 * holder then never waits for a second pool connection, which lock waiters may all be holding.
 */
export function runInsideFence<T>(database: Kysely<Database>, transaction: Kysely<Database>, run: () => Promise<T>) {
  return fence.run({ database, transaction }, run);
}

/** Executor for an unlocked SELECT: the fence transaction when called inside one opened on `database`. */
export function fenceReader(database: Kysely<Database>): Kysely<Database> {
  const current = fence.getStore();
  return current?.database === database ? current.transaction : database;
}
