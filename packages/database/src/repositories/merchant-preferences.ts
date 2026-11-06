import {
  MerchantCustomerWordingViewSchema,
  type MerchantPreferencesCommand,
  type MerchantPreferencesView,
  MerchantPreferencesViewSchema,
} from '@insignia/contracts';
import { sql } from 'kysely';
import type { DatabaseExecutor } from '../client/database.js';

type Row = { guidance_version: string; wording_version: string; guidance: unknown; overlays: unknown };
const emptyGuidance = { dismissed: false, completedSteps: [] };
const emptyOverlays = { en: { locale: 'en', messages: {} } };
/** Mutable store-wide guidance/wording; product revision text is owned elsewhere. */
export function createMerchantPreferencesRepository(db: DatabaseExecutor) {
  async function read(shopId: string, shop: string, authority: string): Promise<MerchantPreferencesView> {
    const row = (
      await sql<Row>`SELECT guidance_version::text,wording_version::text,guidance,overlays FROM merchant_preferences WHERE shop_id=${shopId}`.execute(
        db,
      )
    ).rows[0];
    return MerchantPreferencesViewSchema.parse({
      version: 'merchant-preferences-v1',
      authority,
      shop,
      guidanceVersion: row?.guidance_version ?? '0',
      wordingVersion: row?.wording_version ?? '0',
      guidance: row?.guidance ?? emptyGuidance,
      overlays: row?.overlays ?? emptyOverlays,
    });
  }
  return {
    read,
    async readWording(scope: { shopId: string; installationGeneration: string }) {
      const row = (
        await sql<{
          wording_version: string | null;
          overlays: unknown;
        }>`SELECT p.wording_version::text,p.overlays FROM shops s JOIN installation_generations i ON i.shop_id=s.shop_id AND i.generation=s.current_generation LEFT JOIN merchant_preferences p ON p.shop_id=s.shop_id WHERE s.shop_id=${scope.shopId} AND s.current_generation=${scope.installationGeneration}::bigint AND i.deactivated_at IS NULL`.execute(
          db,
        )
      ).rows[0];
      if (!row) return null;
      return MerchantCustomerWordingViewSchema.parse({
        wordingVersion: row.wording_version ?? '0',
        overlays: row.overlays ?? emptyOverlays,
      });
    },
    async save(
      shopId: string,
      shop: string,
      command: MerchantPreferencesCommand,
    ): Promise<MerchantPreferencesView | null> {
      await sql`INSERT INTO merchant_preferences(shop_id) VALUES(${shopId}) ON CONFLICT(shop_id) DO NOTHING`.execute(
        db,
      );
      const result =
        command.action === 'guidance'
          ? await sql`UPDATE merchant_preferences SET guidance=${JSON.stringify(command.guidance)}::jsonb,guidance_version=guidance_version+1,updated_at=clock_timestamp() WHERE shop_id=${shopId} AND guidance_version=${command.expectedVersion}::bigint RETURNING shop_id`.execute(
              db,
            )
          : await sql`UPDATE merchant_preferences SET overlays=${JSON.stringify(command.overlays)}::jsonb,wording_version=wording_version+1,updated_at=clock_timestamp() WHERE shop_id=${shopId} AND wording_version=${command.expectedVersion}::bigint RETURNING shop_id`.execute(
              db,
            );
      return result.rows.length ? read(shopId, shop, command.authority) : null;
    },
  };
}
