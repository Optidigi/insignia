import { type ColumnType, type Generated, Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Pool } from 'pg';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Bigint = ColumnType<string, string, string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type NullableBigint = ColumnType<string | null, string | null | undefined, string | null>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type GeneratedBigint = ColumnType<string, string | undefined, string>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface ShopsTable {
  shop_id: string;
  shop_domain: string;
  shopify_shop_id: string | null;
  current_generation: GeneratedBigint;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface InstallationGenerationsTable {
  shop_id: string;
  generation: Bigint;
  authorization_generation: Generated<string>;
  authorization_epoch: GeneratedBigint;
  external_installation_id: string | null;
  created_at: GeneratedTimestamp;
  activated_at: GeneratedTimestamp;
  deactivated_at: NullableTimestamp;
}

export interface ProductConfigsTable {
  shop_id: string;
  config_id: string;
  external_product_id: string;
  draft_schema_version: string;
  draft_value: Json;
  draft_version: GeneratedBigint;
  publication_sequence: GeneratedBigint;
  effective_revision_id: string | null;
  effective_operation_id: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ConfigRevisionsTable {
  shop_id: string;
  config_id: string;
  revision_id: string;
  schema_version: string;
  published_value: Json;
  content_hash: string;
  created_at: GeneratedTimestamp;
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
  requested_at: GeneratedTimestamp;
  acknowledged_at: NullableTimestamp;
  observed_at: NullableTimestamp;
  observed_projection: Json | null;
  observed_projection_digest: string | null;
  activated_at: NullableTimestamp;
  failed_at: NullableTimestamp;
  failure_class: string | null;
  superseded_at: NullableTimestamp;
  availability_resolved_at: NullableTimestamp;
}

export interface IdempotencyRecordsTable {
  shop_id: string;
  namespace: string;
  idempotency_key: string;
  request_digest: string;
  status: 'pending' | 'completed' | 'failed';
  result_ref: Generated<string | null>;
  failure_class: Generated<string | null>;
  created_at: GeneratedTimestamp;
  completed_at: NullableTimestamp;
}

export interface InboxMessagesTable {
  id: string;
  source: string;
  external_delivery_id: Generated<string | null>;
  shop_id: Generated<string | null>;
  installation_generation: NullableBigint;
  payload: Buffer;
  payload_sha256: string;
  received_at: Timestamp;
  collected_at: GeneratedTimestamp;
  state: Generated<'pending' | 'leased' | 'processed' | 'failed'>;
  attempts: Generated<number>;
  last_error_class: Generated<string | null>;
  lease_owner: Generated<string | null>;
  lease_until: NullableTimestamp;
  retention_class: string;
  purge_after: NullableTimestamp;
  erasure_state: Generated<'retained' | 'pending' | 'erased'>;
}

export interface ShopifyWebhookDeliveriesTable {
  inbox_id: string;
  shop_domain: string;
  delivery_id: string;
  topic: string;
  api_version: string;
  triggered_at: Timestamp;
  event_id: string | null;
  webhook_name: string | null;
  queue_handoff_state: Generated<'unknown' | 'unconfirmed' | 'confirmed' | 'exhausted'>;
  queue_cleanup_pending: Generated<boolean>;
}

export type CredentialState = 'active' | 'refresh-in-progress' | 'reauth-required' | 'revoked';

export interface ShopCredentialsTable {
  shop_id: string;
  installation_generation: Bigint;
  schema_version: Generated<number>;
  credential_version: GeneratedBigint;
  state: CredentialState;
  access_expires_at: Timestamp;
  refresh_expires_at: Timestamp;
  scopes: string | null;
  wrapping_key_id: string;
  access_envelope: Json | null;
  refresh_envelope: Json | null;
  refresh_claim_id: string | null;
  refresh_claim_until: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface OutboxEventsTable {
  id: string;
  shop_id: string;
  installation_generation: NullableBigint;
  event_type: string;
  schema_version: number;
  aggregate_ref: string;
  payload: Json;
  business_key: Generated<string | null>;
  occurred_at: Timestamp;
  collected_at: GeneratedTimestamp;
  available_at: Timestamp;
  state: Generated<'pending' | 'leased' | 'delivered' | 'failed'>;
  attempts: Generated<number>;
  last_error_class: Generated<string | null>;
  lease_owner: Generated<string | null>;
  lease_until: NullableTimestamp;
  retention_class: string;
  purge_after: NullableTimestamp;
  erasure_state: Generated<'retained' | 'pending' | 'erased'>;
  created_at: GeneratedTimestamp;
}

export interface Database {
  shops: ShopsTable;
  installation_generations: InstallationGenerationsTable;
  product_configs: ProductConfigsTable;
  config_revisions: ConfigRevisionsTable;
  publication_operations: PublicationOperationsTable;
  idempotency_records: IdempotencyRecordsTable;
  inbox_messages: InboxMessagesTable;
  shopify_webhook_deliveries: ShopifyWebhookDeliveriesTable;
  shop_credentials: ShopCredentialsTable;
  outbox_events: OutboxEventsTable;
}

export type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

export function createDatabase(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

export function withTransaction<T>(
  database: Kysely<Database>,
  callback: (transaction: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return database.transaction().execute(callback);
}
