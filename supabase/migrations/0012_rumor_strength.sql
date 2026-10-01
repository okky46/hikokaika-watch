-- Optional editorial rumor strength. Existing profiles remain unassessed.
-- Existing IDs, publication procedures, Auth and private-note RLS are unchanged.
-- The deployment runner owns the transaction.
create or replace function public.validate_tracking_profile(payload jsonb, for_publication boolean, tracking_id uuid) returns void
language plpgsql set search_path=public as $$
declare k text; r jsonb; v text; ref text; refs text[] := '{}'; max_length integer; status_value text;
begin
  if payload is null or jsonb_typeof(payload)<>'object' then raise exception '入力形式が不正です'; end if;
  if exists(select 1 from jsonb_object_keys(payload) x where x not in
    ('title','summary','tracking_reason','tracking_started_on','last_checked_on','verification_note','short_reason','status_note','public_status','status_event_ids','statements','report_state','report_note','reports','event_dates','bidding','rumor_strength')) then raise exception '未対応の項目があります'; end if;
  if payload ? 'rumor_strength' then
    if jsonb_typeof(payload->'rumor_strength') is distinct from 'string' or payload->>'rumor_strength' not in ('weak','medium','strong') then raise exception '噂の強度が不正です'; end if;
  end if;
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
