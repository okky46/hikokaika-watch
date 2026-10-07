-- API roles need only row-level operations, never RLS-bypassing TRUNCATE
-- or trigger/DDL privileges. Keep all existing policies and auth definitions.
revoke all on all tables in schema public from public, anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke all on public.admin_users from authenticated;
revoke insert, update, delete on public.revision_history from authenticated;

-- REVOKE from anon alone does not remove privileges inherited from PUBLIC.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
revoke all on function public.set_updated_at(), public.record_revision_history()
  from public, anon, authenticated;
alter function public.set_updated_at() set search_path = pg_catalog, public, pg_temp;

-- New objects must explicitly opt in to authenticated API access.
-- Service-role grants remain unchanged for the existing build/collection jobs.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
-- PostgreSQL's built-in PUBLIC EXECUTE is global; a schema-only REVOKE
-- cannot remove it. Preserve explicit service_role grants.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
