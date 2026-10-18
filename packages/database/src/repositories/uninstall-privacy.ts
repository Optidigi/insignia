import { type Kysely, sql } from 'kysely';
import type { Database } from '../client/database.js';
export type UninstallPrivacyRecovery = {
  kind: 'GENERATION_ERASURE_STAGED';
  shopId: string;
  installationGeneration: string;
};
export type UninstallPrivacyStatus = {
  blockedReceiptCount: number;
  legacyScopeReceiptCount: number;
  recoveryDecisionCount: number;
  activeGenerationHoldCount: number;
  unrecoveredBlockedReceiptCount: number;
};
/** Uses only durable receipt identities; caller cannot select tenant/generation. */
export function createUninstallPrivacyRepository(db: Kysely<Database>) {
  return {
    async recover(privacyInboxId: string, uninstallInboxId: string): Promise<UninstallPrivacyRecovery> {
      return (
        await sql<{
          value: UninstallPrivacyRecovery;
        }>`SELECT public.recover_uninstall_privacy(${privacyInboxId}::uuid,${uninstallInboxId}::uuid) AS value`.execute(
          db,
        )
      ).rows[0]!.value;
    },
    async recoverPending(limit = 100): Promise<number> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid uninstall privacy budget');
      return (
        await sql<{ value: number }>`SELECT public.recover_pending_uninstall_privacy(${limit}) AS value`.execute(db)
      ).rows[0]!.value;
    },
    async status(): Promise<UninstallPrivacyStatus> {
      return (
        await sql<{ value: UninstallPrivacyStatus }>`SELECT public.uninstall_privacy_status() AS value`.execute(db)
      ).rows[0]!.value;
    },
  };
}
