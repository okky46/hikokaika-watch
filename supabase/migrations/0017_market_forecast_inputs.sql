-- Optional forecast calculation set. Existing published actuals and private-data RLS are unchanged.
-- Validate both versions on writes so the existing draft/publication RPCs keep their permissions.
create function public.validate_valuation_forecast_sets() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare p jsonb; f jsonb; k text; v jsonb;
begin
  foreach p in array array[new.draft,new.published] loop
    if p is null or not (p ? 'forecastFacts') then continue; end if;
    f=p->'forecastFacts';
    if p->>'kind'<>'financials' or jsonb_typeof(f) is distinct from 'object' or not (f ? 'eps' or f ? 'ebitda') then raise exception '会社予想EPSまたは予想EBITDAが必要です'; end if;
    perform public.validate_valuation(jsonb_build_object('kind','financials','code',p->'code','name',p->'name','industry',p->'industry','checkedOn',p->'checkedOn','notes',p->'notes','facts',f));
    for k,v in select * from jsonb_each(f) loop
      if v->>'basis' is distinct from (case when k in ('eps','ebitda') then 'company_forecast' else 'actual' end) then raise exception '予想の利益と実績の残高を区別してください'; end if;
    end loop;
  end loop;
  return new;
end $$;
revoke all on function public.validate_valuation_forecast_sets() from public,anon,authenticated;
create trigger valuation_forecast_sets_check before insert or update on public.valuation_editions
for each row execute function public.validate_valuation_forecast_sets();
