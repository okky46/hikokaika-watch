-- 財務数値とTOB事例の下書き・公開版。既存の認証・個人データを変更しない。
create table public.valuation_editions (
  id text primary key check (id ~ '^(financials:[0-9][0-9A-Z]{3}|tob:[a-z0-9-]{1,80})$'),
  draft jsonb not null,
  published jsonb,
  revision bigint not null default 1,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.valuation_editions enable row level security;
revoke all on public.valuation_editions from anon, authenticated;
grant select on public.valuation_editions to authenticated;
grant all on public.valuation_editions to service_role;
create policy valuation_admin_read on public.valuation_editions for select to authenticated using(public.is_admin());

create function public.validate_valuation(p jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
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
  if jsonb_typeof(items) is distinct from 'object' or items='{}'::jsonb then raise exception '財務数値・倍率が必要です'; end if;
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

create function public.save_valuation_draft(record_id text,payload jsonb,expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.valuation_editions;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です'; end if;
  perform public.validate_valuation(payload);
  if (payload->>'kind'='financials' and record_id<>'financials:'||(payload->>'code')) or (payload->>'kind'='comparable' and record_id !~ '^tob:') then raise exception '保存先IDが不正です'; end if;
  if expected_revision is null then
    insert into public.valuation_editions(id,draft) values(record_id,payload) returning * into r;
  else
    update public.valuation_editions set draft=payload,revision=revision+1,updated_at=now() where id=record_id and revision=expected_revision returning * into r;
    if not found then raise exception '更新が競合しました。再読込してください'; end if;
  end if;
  return to_jsonb(r);
end $$;
create function public.publish_valuation(record_id text,expected_revision bigint,make_public boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.valuation_editions;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です'; end if;
  if make_public is null then raise exception '公開区分が必要です'; end if;
  select * into r from public.valuation_editions where id=record_id for update;
  if not found or expected_revision is null or r.revision<>expected_revision then raise exception '更新が競合しました。再読込してください'; end if;
  if make_public then perform public.validate_valuation(r.draft); end if;
  update public.valuation_editions set published=case when make_public then draft else null end,published_at=case when make_public then now() else null end,revision=revision+1,updated_at=now() where id=record_id returning * into r;
  return to_jsonb(r);
end $$;
create function public.read_published_valuations() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'content',v.published,'published_at',v.published_at) order by v.id),'[]'::jsonb)
  from public.valuation_editions v where v.published is not null and
    (v.published->>'kind'='comparable' or exists(select 1 from public.companies c join public.cases s on s.company_id=c.id where c.security_code=v.published->>'code' and c.is_active and s.is_visible))
$$;
revoke all on function public.validate_valuation(jsonb),public.save_valuation_draft(text,jsonb,bigint),public.publish_valuation(text,bigint,boolean),public.read_published_valuations() from public,anon,authenticated;
grant execute on function public.save_valuation_draft(text,jsonb,bigint),public.publish_valuation(text,bigint,boolean) to authenticated;
grant execute on function public.read_published_valuations() to service_role;
