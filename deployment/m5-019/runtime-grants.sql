-- Run as the dedicated migration owner after all accepted migrations.
-- Create insignia_runtime separately with a generated private password.
ALTER ROLE insignia_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE insignia_rewrite TO insignia_runtime;
GRANT USAGE ON SCHEMA public TO insignia_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO insignia_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO insignia_runtime;
