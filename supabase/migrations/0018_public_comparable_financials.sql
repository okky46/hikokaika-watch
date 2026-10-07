-- Published financials for untracked TOB issuers may have a public calculator page.
-- Existing inactive companies or hidden cases keep their existing publication boundary.
create or replace function public.read_published_valuations() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'content',v.published,'published_at',v.published_at) order by v.id),'[]'::jsonb)
  from public.valuation_editions v where v.published is not null and (
    v.published->>'kind'='comparable'
    or exists(select 1 from public.companies c join public.cases s on s.company_id=c.id where c.security_code=v.published->>'code' and c.is_active and s.is_visible)
    or (v.published->>'kind'='financials'
      and not exists(select 1 from public.companies c where c.security_code=v.published->>'code')
      and exists(select 1 from public.valuation_editions p where p.published->>'kind'='comparable' and p.published->>'code'=v.published->>'code'))
  )
$$;
revoke all on function public.read_published_valuations() from public,anon,authenticated;
grant execute on function public.read_published_valuations() to service_role;
