import {
  type MethodConfiguration,
  MethodConfigurationSchema,
  type VersionedMethodConfiguration,
  VersionedMethodConfigurationSchema,
} from '@insignia/contracts';
import { sql } from 'kysely';
import type { DatabaseExecutor } from '../client/database.js';

export type MethodTemplate = { id: string; name: string; version: string };
/** Shop-scoped mutable templates; callers copy values into independent drafts. */
export function createMethodCatalogRepository(db: DatabaseExecutor) {
  return {
    async list(shopId: string): Promise<MethodTemplate[]> {
      return (
        await sql<MethodTemplate>`SELECT method_id::text AS id,name,version::text FROM method_catalog WHERE shop_id=${shopId} AND deleted_at IS NULL ORDER BY name,method_id LIMIT 100`.execute(
          db,
        )
      ).rows;
    },
    async create(shopId: string, id: string, name: string): Promise<MethodTemplate | null> {
      return (
        (
          await sql<MethodTemplate>`INSERT INTO method_catalog(shop_id,method_id,name) SELECT ${shopId},${id}::uuid,${name} WHERE (SELECT count(*) FROM method_catalog WHERE shop_id=${shopId} AND deleted_at IS NULL)<100 ON CONFLICT (shop_id,method_id) DO NOTHING RETURNING method_id::text AS id,name,version::text`.execute(
            db,
          )
        ).rows[0] ?? null
      );
    },
    async rename(shopId: string, id: string, version: string, name: string): Promise<MethodTemplate | null> {
      return (
        (
          await sql<MethodTemplate>`UPDATE method_catalog SET name=${name},configuration=CASE WHEN configuration IS NULL THEN NULL ELSE jsonb_set(configuration,'{name}',to_jsonb(${name}::text)) END,version=version+1,updated_at=clock_timestamp() WHERE shop_id=${shopId} AND method_id=${id}::uuid AND version=${version}::bigint AND deleted_at IS NULL RETURNING method_id::text AS id,name,version::text`.execute(
            db,
          )
        ).rows[0] ?? null
      );
    },
    async listConfigurations(shopId: string): Promise<VersionedMethodConfiguration[]> {
      const rows = (
        await sql<{
          id: string;
          name: string;
          version: string;
          configuration: unknown;
          amount_currency: string | null;
        }>`SELECT method_id::text AS id,name,version::text,configuration,amount_currency FROM method_catalog WHERE shop_id=${shopId} AND deleted_at IS NULL ORDER BY name,method_id LIMIT 100`.execute(
          db,
        )
      ).rows;
      return rows.map((row) =>
        VersionedMethodConfigurationSchema.parse({
          version: row.version,
          ...(row.amount_currency === null ? {} : { currency: row.amount_currency }),
          configuration: MethodConfigurationSchema.parse(
            row.configuration ?? {
              id: row.id,
              name: row.name,
              explanation: '',
              pricing: 'product',
              amount: '',
              assignment: 'manual',
              productIds: [],
              tags: [],
              tagMatch: 'any',
            },
          ),
        }),
      );
    },
    async saveConfiguration(
      shopId: string,
      configuration: MethodConfiguration,
      expectedVersion: string | null,
      currency?: string,
    ): Promise<VersionedMethodConfiguration | null> {
      const value = MethodConfigurationSchema.parse(configuration);
      if (value.pricing === 'fixed' && currency !== 'USD' && currency !== 'EUR')
        throw new Error('Method price currency required');
      if (currency !== undefined && currency !== 'USD' && currency !== 'EUR')
        throw new Error('Unsupported Method currency');
      const encoded = JSON.stringify(value);
      const result =
        expectedVersion === null
          ? await sql<{
              version: string;
            }>`INSERT INTO method_catalog(shop_id,method_id,name,configuration,amount_currency) SELECT ${shopId},${value.id}::uuid,${value.name},${encoded}::jsonb,${currency ?? null} WHERE (SELECT count(*) FROM method_catalog WHERE shop_id=${shopId} AND deleted_at IS NULL)<100 ON CONFLICT (shop_id,method_id) DO NOTHING RETURNING version::text`.execute(
              db,
            )
          : await sql<{
              version: string;
            }>`UPDATE method_catalog SET name=${value.name},configuration=${encoded}::jsonb,amount_currency=${currency ?? null},version=version+1,updated_at=clock_timestamp() WHERE shop_id=${shopId} AND method_id=${value.id}::uuid AND version=${expectedVersion}::bigint AND deleted_at IS NULL RETURNING version::text`.execute(
              db,
            );
      const row = result.rows[0];
      return row
        ? VersionedMethodConfigurationSchema.parse({
            configuration: value,
            version: row.version,
            ...(currency ? { currency } : {}),
          })
        : null;
    },
    async delete(shopId: string, id: string, version: string): Promise<boolean> {
      return (
        (
          await sql`UPDATE method_catalog SET deleted_at=clock_timestamp(),name='Deleted method',configuration=NULL,amount_currency=NULL,version=version+1,updated_at=clock_timestamp() WHERE shop_id=${shopId} AND method_id=${id}::uuid AND version=${version}::bigint AND deleted_at IS NULL RETURNING method_id`.execute(
            db,
          )
        ).rows.length === 1
      );
    },
  };
}
