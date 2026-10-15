import type { Pool } from 'pg';

const updates: Readonly<Record<string, readonly string[]>> = {
  artwork_assets: [
    'state',
    'claim_id',
    'claim_until',
    'manifest',
    'rejection',
    'owner_hash',
    'quarantine_cleaned_at',
    'retry_at',
    'cleanup_attempt_at',
    'quarantine_cleanup_attempt_at',
    'updated_at',
  ],
  shops: ['updated_at'],
  installation_generations: ['deactivated_at'],
};
/** Qualify the effective inspection LOGIN, including direct and inherited grants.
 * Capability membership alone cannot authorize storage/inspection custody. */
export async function qualifyArtworkRuntimeRole(
  pool: Pool,
  options: { merchantPreviews?: boolean } = {},
): Promise<void> {
  const expectedUpdates = options.merchantPreviews
    ? { ...updates, merchant_preview_assets: ['state', 'manifest', 'updated_at'], config_revision_preview_assets: [] }
    : updates;
  const denied = () => {
    throw new Error('Inspection database role unavailable');
  };
  const identity = (
    await pool.query(`SELECT
    current_user=session_user AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
    AND pg_has_role(current_user,'insignia_artwork_inspect','MEMBER')
    AND EXISTS(SELECT 1 FROM pg_roles cap WHERE cap.rolname='insignia_artwork_inspect'
      AND NOT (cap.rolcanlogin OR cap.rolsuper OR cap.rolcreatedb OR cap.rolcreaterole OR cap.rolreplication OR cap.rolbypassrls))
    AND NOT pg_has_role(current_user,'insignia_queue_consume','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid
      AND (m.admin_option OR m.roleid<>(SELECT oid FROM pg_roles WHERE rolname='insignia_artwork_inspect')))
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members m
      WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='insignia_artwork_inspect'))
    AND NOT has_schema_privilege(current_user,'public','CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE pg_has_role(current_user,c.relowner,'USAGE'))
    AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE pg_has_role(current_user,p.proowner,'USAGE')) AS qualified
    FROM pg_roles r WHERE r.rolname=current_user`)
  ).rows[0];
  if (identity?.qualified !== true) denied();
  const functions = await pool.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
      AND has_function_privilege(current_user,p.oid,'EXECUTE') LIMIT 1`);
  if (functions.rowCount !== 0) denied();
  const columns = await pool.query(`SELECT c.relname,a.attname,
    has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS readable,
    has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS insertable,
    has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS mutable,
    has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS referenceable,
    has_table_privilege(current_user,c.oid,'DELETE, TRUNCATE, TRIGGER, MAINTAIN') AS destructive
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')`);
  const seen = new Set<string>();
  for (const column of columns.rows) {
    const allowed = Object.hasOwn(expectedUpdates, column.relname) ? expectedUpdates[column.relname] : undefined;
    if (!allowed) {
      if (column.readable || column.insertable || column.mutable || column.referenceable || column.destructive)
        denied();
      continue;
    }
    seen.add(column.relname);
    if (
      column.readable !== true ||
      column.insertable ||
      column.referenceable ||
      column.destructive ||
      column.mutable !== allowed.includes(column.attname)
    )
      denied();
  }
  if (seen.size !== Object.keys(expectedUpdates).length) denied();
}
