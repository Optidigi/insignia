-- migrate:up
ALTER TABLE buyer_commands ADD COLUMN declined_at timestamptz;
ALTER TABLE buyer_commands ADD CONSTRAINT buyer_command_decline_terminal CHECK
 (declined_at IS NULL OR (kind='accept' AND application_id IS NULL AND declined_at>=created_at));
CREATE FUNCTION guard_buyer_command_decline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.declined_at IS NOT NULL AND NEW.declined_at IS DISTINCT FROM OLD.declined_at THEN
  RAISE EXCEPTION 'buyer command decline is immutable' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER buyer_command_decline BEFORE UPDATE ON buyer_commands FOR EACH ROW EXECUTE FUNCTION guard_buyer_command_decline();
-- migrate:down
LOCK TABLE buyer_commands IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM buyer_commands WHERE declined_at IS NOT NULL) THEN
  RAISE EXCEPTION 'terminal buyer declines prevent rollback' USING ERRCODE='check_violation';
 END IF;
END; $$;
DROP TRIGGER buyer_command_decline ON buyer_commands;
DROP FUNCTION guard_buyer_command_decline();
ALTER TABLE buyer_commands DROP CONSTRAINT buyer_command_decline_terminal;
ALTER TABLE buyer_commands DROP COLUMN declined_at;
