-- migrate:up
-- #466 part A: a command key of an operator claim is single-use per shop, enforced by the database
-- (not only by the command's own check before m5_operator_claim_abandoned_hold). Only operator
-- claims carry a commandKey; the key is immutable once written (v3 audit trigger), so the index
-- holds for the life of the row.
CREATE UNIQUE INDEX m5_activation_operator_command_key ON public.m5_activation_state
  (shop_id, (hold#>>'{abandonmentClaim,commandKey}'))
  WHERE hold#>>'{abandonmentClaim,commandKey}' IS NOT NULL;

-- migrate:down
DROP INDEX public.m5_activation_operator_command_key;
