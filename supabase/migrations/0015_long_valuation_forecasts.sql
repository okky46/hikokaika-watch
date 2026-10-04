-- 長期DCFの前提数値を1算定120件まで保持する。比較会社・他の検査・権限は維持。
create or replace function public.validate_comparable_research(p jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare r jsonb; v jsonb; i jsonb; m jsonb; d jsonb; k text; day text; n numeric; actual numeric; f jsonb;
begin
  r=p->'research'; if r is null or r='null'::jsonb then return; end if;
  if p->>'kind'<>'comparable' or jsonb_typeof(r) is distinct from 'object' then raise exception '算定根拠の形式が不正です'; end if;
  if jsonb_typeof(r->'dealId') is distinct from 'string' or r->>'dealId' !~* ('^'||(p->>'code')||'-[a-z0-9-]{1,60}$') then raise exception '案件IDが不正です'; end if;
  if jsonb_typeof(r->'buyer') is distinct from 'string' or length(btrim(r->>'buyer')) not between 1 and 200 or coalesce(r->>'transactionType','') not in ('mbo','parent_subsidiary','third_party','other') or coalesce(r->>'status','') not in ('announced','completed','failed','withdrawn','unverified') or coalesce(r->>'priceBasis','') not in ('initial','revised','final') or coalesce(r->>'scope','') not in ('consolidated','standalone') or jsonb_typeof(r->'statisticsEligible') is distinct from 'boolean' then raise exception '取引条件が不正です'; end if;
  if jsonb_typeof(r->'definitions') is distinct from 'object' or jsonb_typeof(r->'denominators') is distinct from 'object' or jsonb_typeof(r->'valuations') is distinct from 'array' or jsonb_array_length(r->'valuations')>30 then raise exception '算定根拠の項目が不正です'; end if;
  for k,v in select * from jsonb_each(r->'definitions') loop
    if k not in ('per','pbr','evEbitda') or jsonb_typeof(v) is distinct from 'string' or length(v#>>'{}')>300 then raise exception '倍率定義が不正です'; end if;
  end loop;
  d=r->'denominators';
  if d<>'{}'::jsonb then
    perform public.validate_valuation(jsonb_build_object('kind','financials','code',p->'code','name',p->'name','industry',p->'industry','checkedOn',p->'checkedOn','notes','', 'facts',d));
  end if;
  for v in select * from jsonb_array_elements(r->'valuations') loop
    if jsonb_typeof(v) is distinct from 'object' then raise exception '算定の形式が不正です'; end if;
    foreach k in array array['advisor','role','page','notes'] loop
      if jsonb_typeof(v->k) is distinct from 'string' or length(v->>k)>(case when k='advisor' then 200 when k in ('role','page') then 100 else 2000 end) or (k<>'notes' and btrim(v->>k)='') then raise exception '算定主体・出典ページが不正です'; end if;
    end loop;
    day=v->>'date'; if day is null or day !~ '^\d{4}-\d{2}-\d{2}$' or to_char(day::date,'YYYY-MM-DD')<>day then raise exception '算定日が不正です'; end if;
    if coalesce(v->>'method','') not in ('market','trading_comparables','dcf','other') or jsonb_typeof(v->'low') is distinct from 'number' or jsonb_typeof(v->'high') is distinct from 'number' or (v->>'low')::numeric<0 or (v->>'high')::numeric<(v->>'low')::numeric or abs((v->>'high')::numeric)>1e16 then raise exception '算定レンジが不正です'; end if;
    if not coalesce(public.article_source_url_valid(v->>'sourceUrl'),false) or v->>'sourceUrl' !~ '^https://' or v->>'sourceUrl' ~* '(subscription-key|api[_-]?key|access_token)=' then raise exception '算定の出典URLが不正です'; end if;
    if jsonb_typeof(v->'inputs') is distinct from 'array' or jsonb_array_length(v->'inputs')>120 or jsonb_typeof(v->'peers') is distinct from 'array' or jsonb_array_length(v->'peers')>60 then raise exception '入力数値・比較会社が不正です'; end if;
    for i in select * from jsonb_array_elements(v->'peers') loop
      if jsonb_typeof(i) is distinct from 'string' or length(i#>>'{}')>200 then raise exception '比較会社が不正です'; end if;
    end loop;
    for i in select * from jsonb_array_elements(v->'inputs') loop
      foreach k in array array['name','unit','period','definition'] loop
        if jsonb_typeof(i->k) is distinct from 'string' or length(btrim(i->>k)) not between 1 and (case when k='name' then 200 when k='unit' then 50 when k='period' then 100 else 2000 end) then raise exception '算定入力の形式が不正です'; end if;
      end loop;
      if jsonb_typeof(i->'low') is distinct from 'number' or jsonb_typeof(i->'high') is distinct from 'number' or abs((i->>'low')::numeric)>1e16 or abs((i->>'high')::numeric)>1e16 or (i->>'high')::numeric<(i->>'low')::numeric or coalesce(i->>'basis','') not in ('actual','company_forecast','valuation_assumption','unknown') then raise exception '算定入力の値が不正です'; end if;
    end loop;
  end loop;
  if (r->>'statisticsEligible')::boolean then
    if p->'multiples'='{}'::jsonb then raise exception '集計対象には取引倍率が必要です'; end if;
    for k,m in select * from jsonb_each(p->'multiples') loop
      if coalesce(btrim(r->'definitions'->>k),'')='' then raise exception '集計する倍率の定義が必要です'; end if;
      if m->>'method'='calculated' then
        f=d->(case when k='per' then 'eps' when k='pbr' then 'bps' else 'ebitda' end);
        if f is null or f->>'basis' is distinct from m->>'basis' or f->>'period' is distinct from m->>'period' or f->>'scope' is distinct from r->>'scope' or (f->>'value')::numeric<=0 then raise exception '採用数値・対象期・範囲が一致しません'; end if;
        if k in ('per','pbr') then actual=(p->>'offerPrice')::numeric/(f->>'value')::numeric;
        else
          if d->'shares' is null or d->'debt' is null or d->'cash' is null or d->'adjustments' is null or (d->'shares'->>'value')::numeric<=0 then raise exception 'EVの採用数値が必要です'; end if;
          foreach day in array array['shares','debt','cash','adjustments'] loop
            if d->day->>'scope' is distinct from r->>'scope' or d->day->>'period' is distinct from d->'cash'->>'period' then raise exception 'EVの範囲・基準日が一致しません'; end if;
          end loop;
          actual=((p->>'offerPrice')::numeric*(d->'shares'->>'value')::numeric+(d->'debt'->>'value')::numeric-(d->'cash'->>'value')::numeric+(d->'adjustments'->>'value')::numeric)/(f->>'value')::numeric;
        end if;
        if actual<=0 or abs(actual-(m->>'value')::numeric)>greatest(0.0001,(m->>'value')::numeric*0.0001) then raise exception '倍率と採用数値が一致しません'; end if;
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.validate_comparable_research(jsonb) from public,anon,authenticated;
