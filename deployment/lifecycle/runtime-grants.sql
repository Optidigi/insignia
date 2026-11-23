-- Schema owner only, after migration 20261123000100.
-- Explicit psql identifier inputs web_role/worker_role; no login or role creation.
GRANT SELECT,INSERT ON public.uninstall_destinations TO :"web_role", :"worker_role";
GRANT UPDATE(state,dispatched_at,subscription_id,registered_at) ON public.uninstall_destinations TO :"web_role", :"worker_role";
GRANT SELECT ON public.uninstall_delivery_authority TO :"web_role", :"worker_role";
GRANT INSERT ON public.uninstall_delivery_authority TO :"web_role";
GRANT EXECUTE ON FUNCTION public.snapshot_generic_uninstall_scope(uuid),
 public.lookup_shop_privacy_replay(text,text,text,text,timestamptz,text,text,text),
 public.find_erased_shop(text,text),public.has_compacted_shop_uninstall(text,timestamptz),public.shop_installation_was_seen(text,text),
 public.reattach_erased_shop(text,bigint,text,text,timestamptz) TO :"web_role";
GRANT EXECUTE ON FUNCTION public.cover_generic_uninstall_cleanup(integer),
 public.recover_pending_uninstall_privacy(integer),public.uninstall_privacy_status()
 TO :"worker_role";
