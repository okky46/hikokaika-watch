-- PL/pgSQL fragment. Called before AND after pending migrations, in one transaction.
if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('user_case_notes','user_global_notes','user_case_favorites')
    and c.relkind='r' and c.relrowsecurity) <> 3 then raise exception 'HW_PROTECTED_NOTES'; end if;
if (select count(*) from pg_policies where schemaname='public'
    and tablename in ('user_case_notes','user_global_notes','user_case_favorites')) <> 3
or (select count(*) from pg_policies where schemaname='public'
    and tablename in ('user_case_notes','user_global_notes','user_case_favorites')
    and roles=array['authenticated']::name[] and cmd='ALL' and permissive='PERMISSIVE'
    and regexp_replace(qual,'[[:space:]()]','','g')='auth.uid=user_id'
    and regexp_replace(with_check,'[[:space:]()]','','g')='auth.uid=user_id') <> 3
then raise exception 'HW_PROTECTED_NOTES'; end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.is_admin()') and prosecdef and prorettype='boolean'::regtype)
or original_auth is distinct from (select string_agg(pg_get_functiondef(oid), E'\n' order by oid)
    from pg_proc where oid in (to_regprocedure('public.is_admin()'),to_regprocedure('auth.uid()'),to_regprocedure('auth.jwt()')))
then raise exception 'HW_PROTECTED_AUTH'; end if;

-- Enforce the reviewed API grant boundary once the hardening migration exists.
-- This does not change any auth function or owner-only note policy.
if to_regclass('site_deploy.migrations') is not null then
if exists(select 1 from site_deploy.migrations where name='0019_api_privilege_hardening.sql') then
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r'
      and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        or has_table_privilege('authenticated',c.oid,'TRUNCATE,TRIGGER')))
  or has_function_privilege('anon','public.is_admin()','EXECUTE')
  or has_function_privilege('anon','public.record_revision_history()','EXECUTE')
  or has_function_privilege('authenticated','public.record_revision_history()','EXECUTE')
  then raise exception 'HW_PROTECTED_API_PRIVILEGES'; end if;
end if;
end if;
