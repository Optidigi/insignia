import { Kysely, PostgresDialect, type ColumnType, type Generated, type Transaction } from 'kysely';
import type { Pool } from 'pg';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Bigint = ColumnType<string, string, string>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface ShopsTable {
  shop_id: string;
  shop_domain: string;
  current_generation: Generated<Bigint>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface InstallationGenerationsTable {
  shop_id: string;
  generation: Bigint;
  external_installation_id: string | null;
  created_at: Generated<Timestamp>;
  activated_at: Generated<Timestamp>;
  deactivated_at: Timestamp | null;
}

export interface ProductConfigsTable {
  shop_id: string;
  config_id: string;
  external_product_id: string;
  draft_schema_version: string;
  draft_value: Json;
  draft_version: Generated<Bigint>;
  publication_sequence: Generated<Bigint>;
  effective_revision_id: string | null;
  effective_operation_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ConfigRevisionsTable {
  shop_id: string;
  config_id: string;
  revision_id: string;
  schema_version: string;
  published_value: Json;
  content_hash: string;
  created_at: Generated<Timestamp>;
  created_by_ref: string | null;
}

export type PublicationStatus = 'requested' | 'acknowledged' | 'observed' | 'activated' | 'failed' | 'superseded';

export interface PublicationOperationsTable {
  shop_id: string;
  config_id: string;
  operation_id: string;
  revision_id: string;
  installation_generation: Bigint;
  operation_sequence: Bigint;
  expected_projection: Json;
  expected_projection_digest: string;
  status: Generated<PublicationStatus>;
  requested_at: Generated<Timestamp>;
  acknowledged_at: Timestamp | null;
  observed_at: Timestamp | null;
  observed_projection: Json | null;
  observed_projection_digest: string | null;
  activated_at: Timestamp | null;
  failed_at: Timestamp | null;
  failure_class: string | null;
  superseded_at: Timestamp | null;
}

export interface IdempotencyRecordsTable {
  shop_id: string;
  namespace: string;
  idempotency_key: string;
  request_digest: string;
  status: 'pending' | 'completed' | 'failed';
  result_ref: Generated<string | null>;
  failure_class: Generated<string | null>;
  created_at: Generated<Timestamp>;
  completed_at: Generated<Timestamp | null>;
}

export interface InboxMessagesTable {
  id: string;
  source: string;
  external_delivery_id: Generated<string | null>;
  shop_id: Generated<string | null>;
  installation_generation: Generated<Bigint | null>;
  payload: Buffer;
  payload_sha256: string;
  received_at: Timestamp;
  collected_at: Timestamp;
  state: Generated<'pending' | 'leased' | 'processed' | 'failed'>;
  attempts: Generated<number>;
  last_error_class: Generated<string | null>;
  lease_owner: Generated<string | null>;
  lease_until: Generated<Timestamp | null>;
  retention_class: string;
  purge_after: Generated<Timestamp | null>;
  erasure_state: Generated<'retained' | 'pending' | 'erased'>;
}

export interface OutboxEventsTable {
  id: string;
  shop_id: string;
  event_type: string;
  schema_version: number;
  aggregate_ref: string;
  payload: Json;
  business_key: Generated<string | null>;
  occurred_at: Timestamp;
  collected_at: Timestamp;
  available_at: Timestamp;
  state: Generated<'pending' | 'leased' | 'delivered' | 'failed'>;
  attempts: Generated<number>;
  last_error_class: Generated<string | null>;
  lease_owner: Generated<string | null>;
  lease_until: Generated<Timestamp | null>;
  retention_class: string;
  purge_after: Generated<Timestamp | null>;
  erasure_state: Generated<'retained' | 'pending' | 'erased'>;
  created_at: Generated<Timestamp>;
}

export interface Database {
  shops: ShopsTable;
  installation_generations: InstallationGenerationsTable;
  product_configs: ProductConfigsTable;
  config_revisions: ConfigRevisionsTable;
  publication_operations: PublicationOperationsTable;
  idempotency_records: IdempotencyRecordsTable;
  inbox_messages: InboxMessagesTable;
  outbox_events: OutboxEventsTable;
}

export type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

export function createDatabase(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export function withTransaction<T>(database: Kysely<Database>, callback: (transaction: Transaction<Database>) => Promise<T>): Promise<T> {
  return database.transaction().execute(callback);
}
