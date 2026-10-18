-- Schema owner only, after migrations 20261018000200 through 20261018000400.
-- Explicit psql identifier inputs web_role/worker_role; no login or role creation.
GRANT SELECT,INSERT ON public.uninstall_destinations TO :"web_role", :"worker_role";
GRANT UPDATE(state,dispatched_at,subscription_id,registered_at) ON public.uninstall_destinations TO :"web_role", :"worker_role";
GRANT SELECT ON public.uninstall_delivery_authority TO :"web_role", :"worker_role";
GRANT INSERT ON public.uninstall_delivery_authority TO :"web_role";
GRANT EXECUTE ON FUNCTION public.snapshot_generic_uninstall_scope(uuid) TO :"web_role";
GRANT EXECUTE ON FUNCTION public.cover_generic_uninstall_cleanup(integer),
 public.recover_pending_uninstall_privacy(integer),public.uninstall_privacy_status()
 TO :"worker_role";
