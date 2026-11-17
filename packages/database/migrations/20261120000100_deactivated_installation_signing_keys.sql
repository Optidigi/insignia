-- migrate:up
-- Spec §5.5: "Reinstall: a new installation generation. The old generation's keys are destroyed at
-- deactivation." Every deactivation (uninstall processing or a reinstall's start) sets
-- installation_generations.deactivated_at once, in the transaction that revokes the generation's
-- credentials. In that same transaction this trigger destroys the generation's signing keys: state
-- 'destroyed' with the private half scrubbed, exactly as SigningKeyLifecycle
-- .destroyInactiveInstallationKeys does. Public key, fingerprint, ids and window stay, so orders the
-- generation already authorized still verify. It runs as the schema owner, so neither the web nor the
-- worker role needs a new grant, and it changes nothing else. Generations deactivated before this
-- migration are not swept; an operator destroys one named generation's keys with
-- scripts/database/destroy-generation-signing-keys.mts.
CREATE FUNCTION public.destroy_deactivated_installation_signing_keys() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.signing_keys SET state = 'destroyed', private_envelope = NULL, wrapping_key_id = NULL,
    destroyed_at = clock_timestamp()
  WHERE shop_id = NEW.shop_id AND installation_generation = NEW.generation AND state <> 'destroyed';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.destroy_deactivated_installation_signing_keys() FROM PUBLIC;
CREATE TRIGGER installation_deactivation_destroys_signing_keys
  AFTER UPDATE OF deactivated_at ON public.installation_generations FOR EACH ROW
  WHEN (OLD.deactivated_at IS NULL AND NEW.deactivated_at IS NOT NULL)
  EXECUTE FUNCTION public.destroy_deactivated_installation_signing_keys();

-- migrate:down
-- Destroyed keys stay destroyed; only later deactivations stop destroying keys.
DROP TRIGGER installation_deactivation_destroys_signing_keys ON public.installation_generations;
DROP FUNCTION public.destroy_deactivated_installation_signing_keys();
