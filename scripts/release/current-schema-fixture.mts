/** Isolated append-role integration setup, never a deployment/schema owner operator. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';

export async function currentSchemaFixture(connectionString: string) {
  const address = new URL(connectionString);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(address.hostname), 'isolated_loopback_database_required');
  assert(/^\/release_append_[a-f0-9]{32}$/.test(address.pathname), 'new_append_fixture_database_required');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  await promisify(execFile)(
    `${root}node_modules/.bin/dbmate`,
    ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'up'],
    { cwd: root, env: { ...process.env, DATABASE_URL: connectionString }, timeout: 30000 },
  );
  const pool = new Pool({ connectionString });
  const client = await pool.connect().catch(async (error: unknown) => {
    await pool.end();
    throw error;
  });
  const releasePassword = randomBytes(32).toString('hex');
  try {
    await client.query('BEGIN');
    await client.query(
      "SET LOCAL log_statement='none'; SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1; SET LOCAL log_statement_sample_rate=0; SET LOCAL log_min_error_statement='panic'; SET LOCAL log_parameter_max_length=0; SET LOCAL log_parameter_max_length_on_error=0",
    );
    // Independently owned append identity has INSERT+sequence authority only.
    // Do not execute a historical schema18 provisioner or archived SQL file.
    await client.query(`
      CREATE ROLE insignia_release_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE insignia_release_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
      CREATE ROLE insignia_release_append LOGIN PASSWORD '${releasePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
      ALTER TABLE public.trusted_release_records OWNER TO insignia_release_owner;
      ALTER FUNCTION public.forbid_trusted_release_rewrite() OWNER TO insignia_release_owner;
      REVOKE ALL ON public.trusted_release_records FROM PUBLIC, insignia_runtime;
      GRANT SELECT ON public.trusted_release_records TO insignia_runtime;
      GRANT USAGE ON SCHEMA public TO insignia_runtime, insignia_release_operator;
      GRANT EXECUTE ON FUNCTION pg_catalog.clock_timestamp(), pg_catalog.jsonb_typeof(jsonb), pg_catalog.isfinite(timestamp with time zone) TO insignia_release_operator;
      GRANT INSERT ON public.trusted_release_records TO insignia_release_operator;
      GRANT USAGE ON SEQUENCE public.trusted_release_records_record_seq_seq TO insignia_release_operator;
      GRANT insignia_release_operator TO insignia_release_append;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC, insignia_runtime, insignia_release_operator;
      DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO insignia_release_operator, insignia_release_append', current_database()); END $$;
    `);
    await client.query('COMMIT');
    const releaseAddress = new URL(connectionString);
    releaseAddress.username = 'insignia_release_append';
    releaseAddress.password = releasePassword;
    return { releasePassword, releaseUrl: releaseAddress.href };
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  }
}
