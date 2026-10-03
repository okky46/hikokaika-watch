-- 0013の保存先・公開版分離・RLSを維持し、算定根拠と一括下書き保存を追加する。
create function public.validate_comparable_research(p jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
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
    if jsonb_typeof(v->'inputs') is distinct from 'array' or jsonb_array_length(v->'inputs')>60 or jsonb_typeof(v->'peers') is distinct from 'array' or jsonb_array_length(v->'peers')>60 then raise exception '入力数値・比較会社が不正です'; end if;
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

create or replace function public.validate_valuation(p jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
declare k text; v jsonb; items jsonb; d text; n numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>100000 then raise exception 'データ形式・サイズが不正です'; end if;
  if coalesce(p->>'kind','') not in ('financials','comparable') or jsonb_typeof(p->'code') is distinct from 'string' or coalesce(p->>'code','') !~ '^[0-9][0-9A-Z]{3}$' then raise exception 'データ種別・コードが不正です'; end if;
  foreach k in array array['name','industry','checkedOn','notes'] loop
    if jsonb_typeof(p->k) is distinct from 'string' or length(p->>k)>2000 then raise exception '項目の形式が不正です: %',k; end if;
  end loop;
  if length(btrim(p->>'name')) not between 1 and 200 or length(btrim(p->>'industry')) not between 1 and 100 then raise exception '名称・業種が必要です'; end if;
  d=p->>'checkedOn'; if d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD')<>d then raise exception '確認日が不正です'; end if;
  items=case when p->>'kind'='financials' then p->'facts' else p->'multiples' end;
  perform public.validate_comparable_research(p);
  if jsonb_typeof(items) is distinct from 'object' or (items='{}'::jsonb and not (p->>'kind'='comparable' and coalesce(jsonb_array_length(p->'research'->'valuations'),0)>0)) then raise exception '財務数値・倍率が必要です'; end if;
  for k,v in select * from jsonb_each(items) loop
    if (p->>'kind'='financials' and k not in ('eps','bps','ebitda','debt','cash','adjustments','shares')) or (p->>'kind'='comparable' and k not in ('per','pbr','evEbitda')) then raise exception '不明な計算項目です'; end if;
    if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'value') is distinct from 'number' then raise exception '数値が不正です'; end if;
    n=(v->>'value')::numeric;
    if abs(n)>1e16 or (k in ('debt','cash','shares') and n<0) or (p->>'kind'='comparable' and (n<=0 or n>10000)) then raise exception '数値の範囲が不正です'; end if;
    if coalesce(v->>'basis','') not in ('actual','company_forecast') or jsonb_typeof(v->'period') is distinct from 'string' or length(btrim(v->>'period')) not between 1 and 100 then raise exception '対象期・実績予想の区分が必要です'; end if;
    if not coalesce(public.article_source_url_valid(v->>'sourceUrl'),false) or v->>'sourceUrl' !~ '^https://' or v->>'sourceUrl' ~* '(subscription-key|api[_-]?key|access_token)=' then raise exception '公開用のHTTPS出典URLが必要です'; end if;
    if p->>'kind'='financials' then
      if coalesce(v->>'scope','') not in ('consolidated','standalone') or jsonb_typeof(v->'sourceName') is distinct from 'string' or length(btrim(v->>'sourceName')) not between 1 and 200 or jsonb_typeof(v->'note') is distinct from 'string' or length(v->>'note')>2000 then raise exception '連結範囲・出典名・注記が不正です'; end if;
    else
      if coalesce(v->>'method','') not in ('calculated','disclosed') or jsonb_typeof(v->'calculation') is distinct from 'string' or length(btrim(v->>'calculation')) not between 1 and 2000 then raise exception '算定方法・計算根拠が必要です'; end if;
    end if;
  end loop;
  if p->>'kind'='comparable' then
    d=p->>'announcedOn'; if d is null or d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD')<>d then raise exception '公表日が不正です'; end if;
    if jsonb_typeof(p->'offerPrice') is distinct from 'number' or (p->>'offerPrice')::numeric<=0 or (p->>'offerPrice')::numeric>1e16 or jsonb_typeof(p->'priceStage') is distinct from 'string' or length(btrim(p->>'priceStage')) not between 1 and 100 then raise exception '価格と段階が必要です'; end if;
    if jsonb_typeof(p->'articleUrl') is distinct from 'string' or length(p->>'articleUrl')>2000 then raise exception '記事URLが不正です'; end if;
    if p->>'articleUrl'<>'' and p->>'articleUrl' !~ '^/articles/[a-z0-9-]+/$' and not (coalesce(public.article_source_url_valid(p->>'articleUrl'),false) and p->>'articleUrl' ~ '^https://' and p->>'articleUrl' !~* '(subscription-key|api[_-]?key|access_token)=') then raise exception '記事URLが不正です'; end if;
    if not coalesce(public.article_source_url_valid(p->>'sourceUrl'),false) or p->>'sourceUrl' !~ '^https://' or p->>'sourceUrl' ~* '(subscription-key|api[_-]?key|access_token)=' then raise exception '出典URLが不正です'; end if;
    if jsonb_typeof(p->'history') is distinct from 'array' or jsonb_array_length(p->'history')>50 then raise exception '価格履歴が不正です'; end if;
    for v in select * from jsonb_array_elements(p->'history') loop
      d=v->>'date'; if d is null or d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD')<>d then raise exception '履歴日付が不正です'; end if;
      if jsonb_typeof(v->'price') is distinct from 'number' or (v->>'price')::numeric<=0 or (v->>'price')::numeric>1e16 or jsonb_typeof(v->'note') is distinct from 'string' or length(v->>'note')>2000 then raise exception '履歴項目が不正です'; end if;
      if not coalesce(public.article_source_url_valid(v->>'sourceUrl'),false) or v->>'sourceUrl' !~ '^https://' or v->>'sourceUrl' ~* '(subscription-key|api[_-]?key|access_token)=' then raise exception '履歴出典が不正です'; end if;
    end loop;
  end if;
end $$;


create function public.save_valuation_batch(items jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; result jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です'; end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 or octet_length(items::text)>5000000 then raise exception '一括保存は1〜100件です'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(items) x)<>jsonb_array_length(items) then raise exception '保存先IDが重複しています'; end if;
  for item in select x from jsonb_array_elements(items) x order by x->>'id' loop
    if jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'payload') is distinct from 'object' or (jsonb_typeof(item->'revision') is distinct from 'number' and jsonb_typeof(item->'revision') is distinct from 'null') then raise exception '一括保存の形式が不正です'; end if;
    result=result||jsonb_build_array(public.save_valuation_draft(item->>'id',item->'payload',(item->>'revision')::bigint));
  end loop;
  return result;
end $$;
revoke all on function public.save_valuation_batch(jsonb) from public,anon,authenticated;
grant execute on function public.save_valuation_batch(jsonb) to authenticated;
create function public.publish_valuation_batch(items jsonb,make_public boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; result jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です'; end if;
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 or octet_length(items::text)>50000 or make_public is null then raise exception '一括公開は1〜100件です'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(items) x)<>jsonb_array_length(items) then raise exception '保存先IDが重複しています'; end if;
  for item in select x from jsonb_array_elements(items) x order by x->>'id' loop
    if jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'revision') is distinct from 'number' then raise exception '一括公開の形式が不正です'; end if;
    result=result||jsonb_build_array(public.publish_valuation(item->>'id',(item->>'revision')::bigint,make_public));
  end loop;
  return result;
end $$;
revoke all on function public.publish_valuation_batch(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_valuation_batch(jsonb,boolean) to authenticated;

