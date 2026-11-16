-- migrate:up
-- D7 (owner, 16 Nov 2026): a store can turn off Insignia's automatic customer artwork emails.
-- On by default. A notice whose store has it off is settled SUPPRESSED (never sent, also not
-- later when the store turns it back on); the merchant can still copy the upload link from the
-- order. Constant defaults: no table rewrite. Running images ignore the new columns, and never
-- write SUPPRESSED. The web role's existing table-level grants on merchant_preferences and its
-- UPDATE(state, settled_at) on customer_artwork_notifications cover the new behaviour.
ALTER TABLE public.merchant_preferences
 ADD COLUMN notifications_version bigint NOT NULL DEFAULT 0 CHECK(notifications_version>=0),
 ADD COLUMN customer_artwork_email boolean NOT NULL DEFAULT true;
ALTER TABLE public.customer_artwork_notifications
 DROP CONSTRAINT customer_artwork_notifications_state_check,
 ADD CONSTRAINT customer_artwork_notifications_state_check
  CHECK(state IN ('PENDING','DISPATCHING','SENT','UNCERTAIN','NO_EFFECT','CANCELLED','SUPPRESSED'));

-- migrate:down
-- Both are terminal no-send states; the older image knows only CANCELLED.
UPDATE public.customer_artwork_notifications SET state='CANCELLED' WHERE state='SUPPRESSED';
ALTER TABLE public.customer_artwork_notifications
 DROP CONSTRAINT customer_artwork_notifications_state_check,
 ADD CONSTRAINT customer_artwork_notifications_state_check
  CHECK(state IN ('PENDING','DISPATCHING','SENT','UNCERTAIN','NO_EFFECT','CANCELLED'));
ALTER TABLE public.merchant_preferences DROP COLUMN customer_artwork_email, DROP COLUMN notifications_version;
