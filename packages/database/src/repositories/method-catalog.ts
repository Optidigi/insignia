import { sql } from 'kysely';
import type { DatabaseExecutor } from '../client/database.js';

export type MethodTemplate = { id: string; name: string; version: string };
/** Shop-scoped mutable templates; callers copy values into independent drafts. */
export function createMethodCatalogRepository(db: DatabaseExecutor) {
  return {
    async list(shopId: string): Promise<MethodTemplate[]> {
      return (
        await sql<MethodTemplate>`SELECT method_id::text AS id,name,version::text FROM method_catalog WHERE shop_id=${shopId} ORDER BY name,method_id LIMIT 100`.execute(
          db,
        )
      ).rows;
    },
    async create(shopId: string, id: string, name: string): Promise<MethodTemplate | null> {
      return (
        (
          await sql<MethodTemplate>`INSERT INTO method_catalog(shop_id,method_id,name) SELECT ${shopId},${id}::uuid,${name} WHERE (SELECT count(*) FROM method_catalog WHERE shop_id=${shopId})<100 RETURNING method_id::text AS id,name,version::text`.execute(
            db,
          )
        ).rows[0] ?? null
      );
    },
    async rename(shopId: string, id: string, version: string, name: string): Promise<MethodTemplate | null> {
      return (
        (
          await sql<MethodTemplate>`UPDATE method_catalog SET name=${name},version=version+1,updated_at=clock_timestamp() WHERE shop_id=${shopId} AND method_id=${id}::uuid AND version=${version}::bigint RETURNING method_id::text AS id,name,version::text`.execute(
            db,
          )
        ).rows[0] ?? null
      );
    },
    async delete(shopId: string, id: string, version: string): Promise<boolean> {
      return (
        (
          await sql`DELETE FROM method_catalog WHERE shop_id=${shopId} AND method_id=${id}::uuid AND version=${version}::bigint RETURNING method_id`.execute(
            db,
          )
        ).rows.length === 1
      );
    },
  };
}
