-- Additive: existing case/event IDs, Auth and private-note policies stay intact.
-- The deployment runner owns the transaction. Do not add BEGIN/COMMIT here.
create table public.media_outlets (
  id text primary key check (id ~ '^[a-z][a-z0-9-]*$' and length(id) <= 60),
  name text not null check (length(btrim(name)) between 1 and 100),
  aliases text[] not null default '{}',
  is_active boolean not null default true
);
insert into public.media_outlets(id,name,aliases) values
  ('mergermarket','Mergermarket',array['マージャーマーケット']),
  ('nikkei','日本経済新聞',array['日経','日経電子版']),
  ('sentaku','選択',array['月刊選択','月刊誌選択']),
  ('bloomberg','Bloomberg',array['ブルームバーグ']),
  ('reuters','Reuters',array['ロイター']),
  ('kabutan','株探','{}'),
  ('traders','トレーダーズ・ウェブ',array['トレーダーズ']),
  ('unknown','媒体未特定','{}');
alter table public.media_outlets enable row level security;
create policy "admin media" on public.media_outlets for all to authenticated using(public.is_admin()) with check(public.is_admin());
revoke all on public.media_outlets from public,anon,authenticated;
grant select,insert,update on public.media_outlets to authenticated;
grant all on public.media_outlets to service_role;

-- One spelling/alias belongs to one outlet. Serialize dictionary edits so concurrent
-- administrators cannot introduce ambiguous aliases in two different rows.
create function public.validate_media_outlet() returns trigger
language plpgsql security definer set search_path=public as $$
declare names text[]; item text;
begin
  if tg_op='UPDATE' and new.id<>old.id then raise exception '媒体IDは変更できません'; end if;
  lock table public.media_outlets in share row exclusive mode;
  if cardinality(new.aliases)>30 or cardinality(new.aliases)<>coalesce(array_length(new.aliases,1),0) then raise exception '媒体の別名は一次元・30件以内です'; end if;
  names:=array_prepend(new.name,new.aliases);
  foreach item in array names loop
    if item is null or public.article_trim(item)='' or item<>public.article_trim(item) or public.article_utf16_length(item)>100 then raise exception '媒体名・別名を確認してください'; end if;
  end loop;
  if (select count(*)<>count(distinct lower(normalize(v,NFKC))) from unnest(names) v) then raise exception '媒体名・別名が重複しています'; end if;
  if exists(select 1 from public.media_outlets m,unnest(array_prepend(m.name,m.aliases)) existing,unnest(names) incoming where m.id<>new.id and lower(normalize(existing,NFKC))=lower(normalize(incoming,NFKC))) then raise exception '他の媒体と名前・別名が重複しています'; end if;
  return new;
end $$;
create trigger media_outlet_validation before insert or update on public.media_outlets for each row execute function public.validate_media_outlet();
revoke all on function public.validate_media_outlet() from public,anon,authenticated;

create table public.tracking_editions (
  case_id uuid primary key references public.cases(id),
  draft jsonb not null,
  published jsonb,
  revision bigint not null default 1,
  publication_version uuid,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tracking_publication_check check (
    (published is null and publication_version is null) or
    (published is not null and publication_version is not null and published_at is not null)
  )
);
alter table public.tracking_editions enable row level security;
create policy "admin read tracking editions" on public.tracking_editions for select to authenticated using(public.is_admin());
revoke all on public.tracking_editions from public,anon,authenticated;
grant select on public.tracking_editions to authenticated;
grant all on public.tracking_editions to service_role;

create function public.tracking_text(value jsonb, field text, max_length integer) returns text
language plpgsql set search_path=public as $$
declare result text;
begin
  if jsonb_typeof(value->field) is distinct from 'string' then raise exception '文字列の項目が不正です: %',field; end if;
  result := value->>field;
  if public.article_utf16_length(result) > max_length then raise exception '文字数が上限を超えています: %',field; end if;
  if result<>public.article_trim(result) then raise exception '先頭・末尾の空白を取り除いてください: %',field; end if;
  return result;
end $$;

create function public.tracking_date_valid(value text) returns boolean
language plpgsql immutable set search_path=public as $$
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(value,4)='0000' then return false; end if;
  return to_char(value::date,'YYYY-MM-DD')=value;
exception when others then return false;
end $$;

create function public.tracking_legacy_status(value text) returns text
language sql immutable set search_path=public as $$
  select case
    when value='rumor' then 'rumored'
    when value in ('proposal','consideration','discussions','comment') then 'commented'
    when value in ('consideration_denied','report_denied') then 'denied'
    when value in ('announced','offer_open','offer_succeeded') then 'announced'
    when value in ('delisted','privatized') then 'completed'
    when value='consideration_ended' then 'ended'
    when value in ('withdrawn','failed') then 'withdrawn'
    else null end;
$$;

create function public.validate_tracking_profile(payload jsonb, for_publication boolean, tracking_id uuid) returns void
language plpgsql set search_path=public as $$
declare k text; r jsonb; v text; ref text; refs text[] := '{}'; max_length integer; status_value text;
begin
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception '入力形式が不正です'; end if;
  if exists(select 1 from jsonb_object_keys(payload) x where x not in
    ('title','summary','tracking_reason','tracking_started_on','last_checked_on','verification_note','short_reason','status_note','public_status','status_event_ids','statements','report_state','report_note','reports','event_dates')) then raise exception '未対応の項目があります'; end if;
  foreach k in array array['title','summary','tracking_reason','tracking_started_on','last_checked_on','verification_note','short_reason','status_note','report_note'] loop
    max_length := case when k='title' then 240 when k in ('short_reason','status_note') then 300 else 6000 end;
    v:=public.tracking_text(payload,k,max_length);
    if k in ('tracking_started_on','last_checked_on') and v<>'' and not public.tracking_date_valid(v) then raise exception '日付が不正です'; end if;
  end loop;
  status_value:=public.tracking_text(payload,'public_status',60);
  if public.tracking_legacy_status(status_value) is null then raise exception '状況タグが不正です'; end if;
  v:=public.tracking_text(payload,'report_state',20);
  if v not in ('none','reported','unreviewed') then raise exception '媒体分類が不正です'; end if;
  foreach k in array array['status_event_ids','statements','reports','event_dates'] loop
    if jsonb_typeof(payload->k) is distinct from 'array' then raise exception '配列の項目が不正です: %',k; end if;
    max_length:=case k when 'status_event_ids' then 10 when 'statements' then 5 when 'reports' then 50 else 300 end;
    if jsonb_array_length(payload->k)>max_length then raise exception '項目数が上限を超えています: %',k; end if;
  end loop;
  for r in select value from jsonb_array_elements(payload->'status_event_ids') loop
    if jsonb_typeof(r)<>'string' then raise exception '出来事IDが不正です'; end if;
    refs:=array_append(refs,r#>>'{}');
  end loop;
  if (select count(*)<>count(distinct lower(value#>>'{}')) from jsonb_array_elements(payload->'status_event_ids')) then raise exception '状態の根拠が重複しています'; end if;
  for r in select value from jsonb_array_elements(payload->'statements') loop
    if jsonb_typeof(r)<>'object' or exists(select 1 from jsonb_object_keys(r) x where x not in ('event_id','subject','text','tags')) then raise exception '会社説明が不正です'; end if;
    refs:=array_append(refs,public.tracking_text(r,'event_id',36));
    v:=public.tracking_text(r,'subject',100);
    if for_publication and v='' then raise exception '会社説明の主体が必要です'; end if;
    v:=public.tracking_text(r,'text',300);
    if for_publication and v='' then raise exception '会社説明の内容が必要です'; end if;
    if jsonb_typeof(r->'tags') is distinct from 'array' or jsonb_array_length(r->'tags')>10 then raise exception '会社説明タグが不正です'; end if;
    for v in select value from jsonb_array_elements_text(r->'tags') loop
      if v is null or v not in ('consideration_acknowledged','strategic_options_under_review','proposal_received','discussions_ongoing','no_decision','not_company_announcement','not_under_consideration','report_denied','comment_declined','other') then raise exception '会社説明タグが不正です'; end if;
    end loop;
  end loop;
  for r in select value from jsonb_array_elements(payload->'reports') loop
    if jsonb_typeof(r)<>'object' or exists(select 1 from jsonb_object_keys(r) x where x not in ('outlet_id','event_id','source_name','source_url','method','access','checked_on','reported_on','scope_note')) then raise exception '報道の根拠が不正です'; end if;
    v:=public.tracking_text(r,'outlet_id',60);
    if not exists(select 1 from public.media_outlets where id=v) then raise exception '媒体が見つかりません'; end if;
    v:=public.tracking_text(r,'event_id',36);
    if v<>'' then refs:=array_append(refs,v); end if;
    if public.tracking_text(r,'source_name',240)='' or public.tracking_text(r,'scope_note',1000)='' then raise exception '出典と分類理由が必要です'; end if;
    if not public.article_source_url_valid(public.tracking_text(r,'source_url',2000)) then raise exception '出典URLが不正です'; end if;
    if public.tracking_text(r,'method',20) not in ('direct','company','secondary') or public.tracking_text(r,'access',20) not in ('full','partial','unread') then raise exception '確認方法が不正です'; end if;
    if r->>'method'<>'direct' and r->>'access'<>'unread' then raise exception '間接確認では原文未閲覧を選択してください'; end if;
    if not public.tracking_date_valid(public.tracking_text(r,'checked_on',10)) then raise exception '確認日が不正です'; end if;
    v:=public.tracking_text(r,'reported_on',10);
    if v<>'' and not public.tracking_date_valid(v) then raise exception '報道日が不正です'; end if;
  end loop;
  if (payload->>'report_state'='reported') is distinct from (jsonb_array_length(payload->'reports')>0) then raise exception '媒体分類と根拠が一致しません'; end if;
  for r in select value from jsonb_array_elements(payload->'event_dates') loop
    if jsonb_typeof(r)<>'object' or exists(select 1 from jsonb_object_keys(r) x where x not in ('event_id','precision','value','issue_label')) then raise exception '日付精度が不正です'; end if;
    refs:=array_append(refs,public.tracking_text(r,'event_id',36));
    k:=public.tracking_text(r,'precision',20);
    v:=public.tracking_text(r,'value',40);
    perform public.tracking_text(r,'issue_label',100);
    if k not in ('datetime','date','month','issue','unknown') then raise exception '日付精度を選択してください'; end if;
    if k='date' and not public.tracking_date_valid(v) then raise exception '公表日が不正です'; end if;
    if k='month' or (k='issue' and v<>'') then
      if v!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or not public.tracking_date_valid(v||'-01') then raise exception '年月が不正です'; end if;
    end if;
    if k='issue' and public.article_trim(r->>'issue_label')='' then raise exception '号数が必要です'; end if;
    if k='unknown' and v<>'' then raise exception '日付不明には日時を指定できません'; end if;
    if k='datetime' then
      if v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,3})?)?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' or not public.tracking_date_valid(left(v,10)) then raise exception '日時が不正です'; end if;
      perform v::timestamptz;
    end if;
  end loop;
  if (select count(*)<>count(distinct lower(value->>'event_id')) from jsonb_array_elements(payload->'event_dates')) then raise exception '日付設定が重複しています'; end if;
  foreach ref in array refs loop
    if ref!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception '出来事IDが不正です'; end if;
    if not exists(select 1 from public.case_events where id=ref::uuid and case_id=tracking_id and (not for_publication or is_visible)) then raise exception '非公開・別案件・削除済みの出来事を参照しています'; end if;
  end loop;
  if for_publication then
    if public.article_trim(payload->>'title')='' or public.article_trim(payload->>'short_reason')='' or payload->>'last_checked_on'='' or payload->>'report_state'='unreviewed' then raise exception '公開にはタイトル・噂の概要・確認日・媒体分類が必要です'; end if;
    if payload->>'report_state'='none' and public.article_trim(payload->>'report_note')='' then raise exception '報道なしとして登録する内容・確認範囲が必要です'; end if;
    if status_value<>'rumor' and jsonb_array_length(payload->'status_event_ids')=0 then raise exception '状況タグの根拠となる出来事が必要です'; end if;
  end if;
end $$;

create function public.save_tracking_draft(tracking_id uuid, target_company_id uuid, case_slug text, payload jsonb, expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.cases; edition public.tracking_editions; saved public.tracking_editions;
begin
  if public.is_admin() is not true then raise exception '管理者権限が必要です' using errcode='42501'; end if;
  if case_slug is null or case_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' or length(case_slug)>160 then raise exception 'URL用slugが不正です'; end if;
  if not exists(select 1 from public.companies where id=target_company_id and is_active) then raise exception '有効な会社を選択してください'; end if;
  if tracking_id is null then
    if expected_revision is not null then raise exception '新規作成に版番号は指定できません'; end if;
    perform public.validate_tracking_profile(payload,false,null);
    insert into public.cases(company_id,title,slug,is_visible) values(target_company_id,payload->>'title',case_slug,false) returning * into target;
  else
    select * into target from public.cases where id=tracking_id for update;
    if not found then raise exception '銘柄が見つかりません'; end if;
    -- IDs bind notes/favorites and company history: no silent reassignment.
    if target.company_id<>target_company_id then raise exception '登録済み案件の会社は変更できません'; end if;
    if target.site_published_at is not null and target.slug<>case_slug then raise exception '公開済みURLは変更できません'; end if;
    perform public.validate_tracking_profile(payload,false,target.id);
    if target.site_published_at is null then update public.cases set slug=case_slug where id=target.id; end if;
  end if;
  select * into edition from public.tracking_editions where case_id=target.id for update;
  if found then
    if expected_revision is distinct from edition.revision then raise exception '別の編集があります。再読込してください'; end if;
    update public.tracking_editions set draft=payload,revision=revision+1,updated_at=now() where case_id=target.id returning * into saved;
  else
    if expected_revision is not null then raise exception '版番号が一致しません'; end if;
    insert into public.tracking_editions(case_id,draft) values(target.id,payload) returning * into saved;
  end if;
  return jsonb_build_object('id',target.id,'revision',saved.revision);
end $$;

create function public.set_tracking_publication(tracking_id uuid, expected_revision bigint, make_public boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.cases; edition public.tracking_editions; saved public.tracking_editions; p jsonb;
begin
  if public.is_admin() is not true then raise exception '管理者権限が必要です' using errcode='42501'; end if;
  select * into target from public.cases where id=tracking_id for update;
  if not found then raise exception '銘柄が見つかりません'; end if;
  select * into edition from public.tracking_editions where case_id=tracking_id for update;
  if not found or expected_revision is distinct from edition.revision then raise exception '別の編集があります。再読込してください'; end if;
  if make_public is null then raise exception '公開操作を指定してください'; end if;
  if make_public then
    if not exists(select 1 from public.companies where id=target.company_id and is_active) then raise exception '有効な会社を選択してください'; end if;
    p:=edition.draft;
    perform public.validate_tracking_profile(p,true,tracking_id);
    update public.cases set title=p->>'title',summary=p->>'summary',tracking_reason=p->>'tracking_reason',
      tracking_started_on=nullif(p->>'tracking_started_on','')::date,last_checked_on=nullif(p->>'last_checked_on','')::date,
      verification_note=p->>'verification_note',status=public.tracking_legacy_status(p->>'public_status'),
      is_visible=true,site_published_at=coalesce(site_published_at,now()) where id=tracking_id;
    update public.tracking_editions set published=draft,publication_version=gen_random_uuid(),published_at=now(),revision=revision+1,updated_at=now() where case_id=tracking_id returning * into saved;
  else
    update public.cases set is_visible=false where id=tracking_id;
    update public.tracking_editions set published=null,publication_version=null,revision=revision+1,updated_at=now() where case_id=tracking_id returning * into saved;
  end if;
  return jsonb_build_object('id',tracking_id,'revision',saved.revision,'publication_version',saved.publication_version);
end $$;

create function public.read_published_tracking() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare e record;
begin
  for e in select t.* from public.tracking_editions t join public.cases c on c.id=t.case_id join public.companies co on co.id=c.company_id where t.published is not null and c.is_visible and co.is_active loop
    perform public.validate_tracking_profile(e.published,true,e.case_id);
  end loop;
  return jsonb_build_object(
    'outlets',coalesce((select jsonb_agg(to_jsonb(m) order by id) from public.media_outlets m),'[]'::jsonb),
    'editions',coalesce((select jsonb_agg(jsonb_build_object('case_id',t.case_id,'published',t.published,'publication_version',t.publication_version,'published_at',t.published_at)) from public.tracking_editions t join public.cases c on c.id=t.case_id join public.companies co on co.id=c.company_id where t.published is not null and c.is_visible and co.is_active),'[]'::jsonb)
  );
end $$;

revoke all on function public.tracking_text(jsonb,text,integer),public.tracking_date_valid(text),public.tracking_legacy_status(text),public.validate_tracking_profile(jsonb,boolean,uuid) from public,anon,authenticated;
revoke all on function public.save_tracking_draft(uuid,uuid,text,jsonb,bigint),public.set_tracking_publication(uuid,bigint,boolean) from public,anon;
grant execute on function public.save_tracking_draft(uuid,uuid,text,jsonb,bigint),public.set_tracking_publication(uuid,bigint,boolean) to authenticated;
revoke all on function public.read_published_tracking() from public,anon,authenticated;
grant execute on function public.read_published_tracking() to service_role;
