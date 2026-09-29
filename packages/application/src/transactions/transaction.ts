/** A transaction-scoped callback is the only path for a business write. */
export interface TransactionRunner<Tx> {
  run<T>(work: (transaction: Tx) => Promise<T>): Promise<T>;
}
