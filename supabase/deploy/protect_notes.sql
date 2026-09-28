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
