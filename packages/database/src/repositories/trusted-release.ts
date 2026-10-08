import {
  createTrustedReleaseEvidencePort,
  type ExpectedFunctionBuild,
  type FunctionArtifactScope,
  parseExpectedFunctionBuild,
  type TrustedReleaseRecord,
} from '@insignia/application';
import { sql } from 'kysely';
import type { DatabaseExecutor } from '../client/database.js';
import { sha256CanonicalJson } from '../hash/canonical.js';

export type TrustedDeploymentEvidence = Readonly<{
  record: TrustedReleaseRecord;
  expectedBuild: ExpectedFunctionBuild;
  activeVersionEvidenceSha256: string;
  evidenceDigest: string;
}>;
export type TrustedReleaseRead = Readonly<{
  scope: FunctionArtifactScope;
  expectedActiveAppVersionRef: string;
  now: Date;
}>;

/** A runtime SELECT capability, not an operator writer or an environment-JSON source. */
export function createTrustedReleaseReader(database: DatabaseExecutor) {
  return Object.freeze({
    async read(input: TrustedReleaseRead): Promise<TrustedDeploymentEvidence | null> {
      const { scope } = input;
      if (
        !scope ||
        !/^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$/.test(scope.shopId) ||
        !/^[1-9][0-9]{0,19}$/.test(scope.installationGeneration) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(scope.appClientId) ||
        !/^[A-Za-z0-9][A-Za-z0-9:/._-]{0,255}$/.test(input.expectedActiveAppVersionRef) ||
        !(input.now instanceof Date) ||
        !Number.isFinite(input.now.getTime())
      )
        throw new TypeError('Invalid trusted release scope');
      try {
        const privileges = await sql<{ readable: boolean; writable: boolean; schema_writable: boolean }>`
          SELECT has_table_privilege(current_user, 'public.trusted_release_records', 'SELECT') AS readable,
            has_table_privilege(current_user, 'public.trusted_release_records', 'INSERT,UPDATE,DELETE,TRUNCATE') AS writable,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_writable
        `.execute(database);
        const rights = privileges.rows[0];
        if (!rights?.readable || rights.writable || rights.schema_writable) return null;
        const result = await sql<{
          record_id: string;
          trusted_record: unknown;
          expected_build: unknown;
          active_version_observed_at: Date;
          active_version_evidence_sha256: string;
          evidence_digest: string;
        }>`
          WITH current_active AS (
            SELECT min(active_app_version_ref) AS version_ref
            FROM public.trusted_release_records
            WHERE app_client_id = ${scope.appClientId}
              AND active_version_observed_at = (
                SELECT max(active_version_observed_at) FROM public.trusted_release_records
                WHERE app_client_id = ${scope.appClientId}
              )
            HAVING count(DISTINCT active_app_version_ref) = 1
          ), latest_record AS (
            SELECT * FROM public.trusted_release_records
            WHERE shop_id = ${scope.shopId} AND installation_generation = ${scope.installationGeneration}
              AND app_client_id = ${scope.appClientId}
            ORDER BY record_seq DESC LIMIT 1
          )
          SELECT r.record_id, r.trusted_record, r.expected_build, r.active_version_observed_at,
            r.active_version_evidence_sha256, r.evidence_digest
          FROM latest_record r
          JOIN current_active a ON a.version_ref = r.active_app_version_ref
          JOIN public.shops s ON s.shop_id = r.shop_id AND s.current_generation = r.installation_generation
          JOIN public.installation_generations i ON i.shop_id = r.shop_id AND i.generation = r.installation_generation
          WHERE i.deactivated_at IS NULL AND s.shopify_shop_id IS NOT NULL
            AND r.active_app_version_ref = ${input.expectedActiveAppVersionRef}
        `.execute(database);
        const row = result.rows[0];
        if (!row || !(row.active_version_observed_at instanceof Date)) return null;
        const observedAt = row.active_version_observed_at.toISOString();
        const age = input.now.getTime() - row.active_version_observed_at.getTime();
        // Preserve existing exact freshness semantics. Never restamp stored evidence at read time.
        if (age < 0 || age > 30_000) return null;
        const digest = sha256CanonicalJson({
          trustedRecord: row.trusted_record,
          expectedBuild: row.expected_build,
          activeVersionObservedAt: observedAt,
          activeVersionEvidenceSha256: row.active_version_evidence_sha256,
        });
        if (digest !== row.evidence_digest) return null;
        try {
          const record = await createTrustedReleaseEvidencePort({ read: async () => row.trusted_record }).readRecord(
            scope,
          );
          const expectedBuild = parseExpectedFunctionBuild(row.expected_build);
          if (
            !record ||
            record.recordId !== row.record_id ||
            record.activeAppVersionRef !== input.expectedActiveAppVersionRef ||
            record.attestation.observedAt !== observedAt ||
            input.now.getTime() >= Date.parse(record.attestation.expiresAt) ||
            expectedBuild.shopId !== scope.shopId ||
            expectedBuild.installationGeneration !== scope.installationGeneration ||
            expectedBuild.appClientId !== scope.appClientId ||
            expectedBuild.appVersionRef !== record.activeAppVersionRef
          )
            return null;
          return Object.freeze({
            record,
            expectedBuild,
            activeVersionEvidenceSha256: row.active_version_evidence_sha256,
            evidenceDigest: row.evidence_digest,
          });
        } catch {
          return null;
        }
      } catch (error) {
        // Missing relation/SELECT privilege remains unqualified, never permission escalation or auto-provisioning.
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === '42P01' || code === '42501') return null;
        throw new Error('Trusted release source unavailable');
      }
    },
  });
}
