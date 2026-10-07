-- Add optional observation history to the existing draft/publication workflow.
-- No table, Auth, private-note policy, ID or existing SQL is changed.
create function public.validate_watch_observations(items jsonb, for_publication boolean, tracking_id uuid)
returns void language plpgsql set search_path=public as $$
declare r jsonb; k text; v text; ref text; seen text[];
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>200 then raise exception '観察は200件以内です'; end if;
 for r in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(r) is distinct from 'object' then raise exception '観察の形式が不正です'; end if;
  if exists(select 1 from jsonb_object_keys(r) x where x not in ('id','kind','title','occurred_on','date_note','recorded_at','updated_at','observer','facts','interpretation','outcome','related_id','event_id','source_name','source_url','price','price_on','volume')) then raise exception '観察に未対応の項目があります'; end if;
  foreach k in array array['id','kind','title','occurred_on','date_note','recorded_at','updated_at','observer','facts','interpretation','outcome','related_id','event_id','source_name','source_url','price_on'] loop
   v:=public.tracking_text(r,k,case when k in ('facts','interpretation') then 3000 when k='source_url' then 2000 else 300 end);
   if k in ('title','facts','observer') and v='' then raise exception '観察の見出し・事実・記録者が必要です'; end if;
   if k in ('id','related_id','event_id') and (k='id' or v<>'') and v!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception '観察の参照IDが不正です'; end if;
   if k in ('recorded_at','updated_at') then
    if v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{3})?Z$' or not public.tracking_date_valid(left(v,10)) then raise exception '記録日時が不正です'; end if;
    perform v::timestamptz;
   end if;
   if k='occurred_on' and v<>'' and not public.tracking_date_valid(v) then raise exception '観察日が不正です'; end if;
  end loop;
  if jsonb_typeof(r->'kind') is distinct from 'string' or jsonb_typeof(r->'outcome') is distinct from 'string' or r->>'kind' not in ('origin','observation','check','retrospective') or r->>'outcome' not in ('open','no_change','explained','closed','confirmed') then raise exception '観察の種類・結果が不正です'; end if;
  if r->>'occurred_on'='' and public.article_trim(r->>'date_note')='' then raise exception '日付不明なら時期の説明が必要です'; end if;
  if (r->>'updated_at')::timestamptz<(r->>'recorded_at')::timestamptz then raise exception '修正日時が記録日時より前です'; end if;
  if r->>'source_url'<>'' and (not public.article_source_url_valid(r->>'source_url') or public.article_trim(r->>'source_name')='') then raise exception '観察の出典が不正です'; end if;
  foreach k in array array['price','volume'] loop
   if not r ? k or jsonb_typeof(r->k) not in ('number','null') then raise exception '株価・出来高の形式が不正です'; end if;
   if jsonb_typeof(r->k)='number' and ((r->>k)::numeric<0 or (r->>k)::numeric>1e15 or (k='price' and (r->>k)::numeric=0)) then raise exception '株価・出来高の範囲が不正です'; end if;
  end loop;
  if r->'price'<>'null'::jsonb and (not public.tracking_date_valid(r->>'price_on') or public.article_trim(r->>'source_name')='') then raise exception '株価の基準日と出典が必要です'; end if;
  if r->'price'='null'::jsonb and r->>'price_on'<>'' then raise exception '株価も必要です'; end if;
  ref:=r->>'event_id';
  if ref<>'' and not exists(select 1 from public.case_events where id=ref::uuid and case_id=tracking_id and (not for_publication or is_visible)) then raise exception '観察が非公開・別案件・削除済みの出来事を参照しています'; end if;
  seen:=array[r->>'id']; ref:=r->>'related_id';
  while ref<>'' loop
   if ref=any(seen) then raise exception '観察の関連付けが循環しています'; end if;
   seen:=array_append(seen,ref);
   if not exists(select 1 from jsonb_array_elements(items) x where x->>'id'=ref) then raise exception '関連する観察がありません'; end if;
   select x->>'related_id' into ref from jsonb_array_elements(items) x where x->>'id'=ref;
  end loop;
 end loop;
 if (select count(*)<>count(distinct lower(value->>'id')) from jsonb_array_elements(items)) then raise exception '観察IDが重複しています'; end if;
end $$;
revoke all on function public.validate_watch_observations(jsonb,boolean,uuid) from public,anon,authenticated;

-- Recording time is server-owned; importing historical observations never backdates it.
create function public.stamp_watch_observations() returns trigger language plpgsql set search_path=public as $$
declare item jsonb; prior jsonb; result jsonb:='[]'; previous jsonb:='[]'; stamp text;
begin
 if not new.draft ? 'observations' then return new; end if;
 if tg_op='UPDATE' then previous:=coalesce(old.draft->'observations','[]')||coalesce(old.published->'observations','[]'); end if;
 stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 for item in select value from jsonb_array_elements(new.draft->'observations') loop
  select value into prior from jsonb_array_elements(previous) where value->>'id'=item->>'id' limit 1;
  item:=jsonb_set(item,'{recorded_at}',coalesce(prior->'recorded_at',to_jsonb(stamp)));
  item:=jsonb_set(item,'{updated_at}',case when prior is not null and (prior-'recorded_at'-'updated_at')=(item-'recorded_at'-'updated_at') then prior->'updated_at' else to_jsonb(stamp) end);
  result:=result||jsonb_build_array(item);
 end loop;
 new.draft:=jsonb_set(new.draft,'{observations}',result);
 return new;
end $$;
revoke all on function public.stamp_watch_observations() from public,anon,authenticated;
create trigger stamp_watch_observations before insert or update of draft on public.tracking_editions for each row execute function public.stamp_watch_observations();

-- Optional editorial color strengths for rumor/report/consideration, independent of bidding.
-- Existing IDs, publication procedures, Auth and private-note RLS are unchanged.
-- The deployment runner owns the transaction.
create or replace function public.validate_tracking_profile(payload jsonb, for_publication boolean, tracking_id uuid) returns void
language plpgsql set search_path=public as $$
declare k text; r jsonb; v text; ref text; refs text[] := '{}'; max_length integer; status_value text;
begin
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception '入力形式が不正です'; end if;
  if exists(select 1 from jsonb_object_keys(payload) x where x not in
    ('title','summary','tracking_reason','tracking_started_on','last_checked_on','verification_note','short_reason','status_note','public_status','status_event_ids','statements','report_state','report_note','reports','event_dates','bidding','observations','rumor_strength','reported_strength','process_strength')) then raise exception '未対応の項目があります'; end if;
  if payload ? 'observations' then perform public.validate_watch_observations(payload->'observations',for_publication,tracking_id); end if;
  foreach k in array array['rumor_strength','reported_strength','process_strength'] loop
    if payload ? k then
      if jsonb_typeof(payload->k) is distinct from 'string' or payload->>k not in ('weak','medium','strong') then raise exception '色の強度が不正です'; end if;
    end if;
  end loop;
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

  -- Optional extension: old profiles stay valid and published/draft isolation is unchanged.
  if payload ? 'bidding' then
    r:=payload->'bidding';
    if jsonb_typeof(r) is distinct from 'object' then raise exception '入札段階の形式が不正です'; end if;
    if exists(select 1 from jsonb_object_keys(r) x where x not in ('stage','event_id')) then raise exception '入札段階の項目が不正です'; end if;
    v:=public.tracking_text(r,'stage',30);
    if v not in ('first_round','second_round','final_round') then raise exception '入札段階を選択してください'; end if;
    if status_value not in ('rumor','proposal','consideration','discussions','comment') then raise exception '入札段階は正式発表前の進行中の状況だけに設定できます'; end if;
    ref:=public.tracking_text(r,'event_id',36);
    if payload->>'report_state'<>'reported' or not exists(select 1 from jsonb_array_elements(payload->'reports') evidence where lower(evidence->>'event_id')=lower(ref)) then raise exception '入札段階には確認済み媒体の根拠と結び付いた出来事が必要です'; end if;
    refs:=array_append(refs,ref);
  end if;
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

revoke all on function public.validate_tracking_profile(jsonb,boolean,uuid) from public,anon,authenticated;
