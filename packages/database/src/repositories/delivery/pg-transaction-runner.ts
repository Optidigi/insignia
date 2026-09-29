import type { TransactionRunner } from '@insignia/application';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../client/database.js';

export class PgTransactionRunner implements TransactionRunner<Transaction<Database>> {
  constructor(private readonly database: Kysely<Database>) {}

  run<T>(work: (transaction: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction().execute(work);
  }
}
