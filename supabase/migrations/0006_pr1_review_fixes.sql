-- PR #8 review follow-up. 旧0005適用済み環境にも同じ修正を適用する。
-- 新規環境は0005の後に本マイグレーションを実行する（すべて冪等）。

alter table public.case_events alter column event_category drop not null;
update public.case_events set
  event_category = case
    when event_type in ('observation_report','follow_up_report') then 'media_report'
    when event_type in ('company_comment','timely_disclosure','consideration_ended') then 'company_disclosure'
    when event_type = 'formal_announcement' then 'formal_announcement'
    when event_type in ('price_revision','tender_offer_result','withdrawal') then 'post_announcement_update'
    when event_type = 'correction' then 'correction' else 'related_information' end,
  report_role = case when event_type = 'observation_report' then 'initial'
                     when event_type = 'follow_up_report' then 'follow_up' end,
  date_precision = case when occurred_at is null then 'unknown' else coalesce(date_precision, 'datetime') end,
  sort_at = coalesce(sort_at, occurred_at, market_trigger_date::timestamptz,
                     issue_year_month::timestamptz, site_published_at, updated_at)
where event_category is null;

alter table public.case_events drop constraint if exists case_events_report_role_check;
alter table public.case_events add constraint case_events_report_role_check check (
  (event_category = 'media_report' and report_role is not null and report_role in ('initial','follow_up','related','market_reaction'))
  or (event_category <> 'media_report' and report_role is null)
) not valid;
alter table public.case_events drop constraint if exists case_events_category_check;
alter table public.case_events add constraint case_events_category_check check (event_category in (
  'media_report','company_disclosure','formal_announcement','post_announcement_update','related_information','correction'
)) not valid;
alter table public.case_events drop constraint if exists case_events_company_stance_check;
alter table public.case_events add constraint case_events_company_stance_check check (
  company_stance is null or (event_category = 'company_disclosure' and company_stance in ('private_consideration','capital_policy','denied'))
) not valid;
alter table public.case_events drop constraint if exists case_events_date_precision_check;
alter table public.case_events add constraint case_events_date_precision_check check (
  (date_precision in ('datetime','date') and occurred_at is not null)
  or (date_precision = 'issue' and issue_label is not null and issue_year_month is not null)
  or (date_precision = 'unknown')
) not valid;

drop index if exists public.case_events_one_visible_initial_idx;
-- 複数の旧 observation_report は、内部順序キーが最古の1件だけを初報にする。
with ranked as (
  select id, row_number() over (
    partition by case_id
    order by coalesce(occurred_at, site_published_at, updated_at) asc nulls last,
             sort_order asc, id asc
  ) as report_number
  from public.case_events
  where is_visible and event_category = 'media_report' and report_role = 'initial'
)
update public.case_events e
set report_role = 'follow_up',
    metadata = coalesce(e.metadata, '{}'::jsonb) || '{"pr1_duplicate_initial_demoted":true}'::jsonb
from ranked r where e.id = r.id and r.report_number > 1;

alter table public.cases validate constraint cases_canonical_status_check;
alter table public.case_events validate constraint case_events_category_check;
alter table public.case_events validate constraint case_events_report_role_check;
alter table public.case_events validate constraint case_events_company_stance_check;
alter table public.case_events validate constraint case_events_date_precision_check;
alter table public.case_events alter column event_category set not null;

create unique index if not exists case_events_one_visible_initial_idx on public.case_events(case_id)
  where is_visible and event_category = 'media_report' and report_role = 'initial';

create or replace function public.legacy_company_stance(tags text[]) returns text
language sql immutable set search_path = public as $$
  with candidates as (
    select case
      when tag in ('consideration_acknowledged','proposal_received','discussions_ongoing') then 'private_consideration'
      when tag = 'strategic_options_under_review' then 'capital_policy'
      when tag in ('not_under_consideration','report_denied') then 'denied'
    end stance from unnest(coalesce(tags, '{}'::text[])) tag
  )
  select case when count(distinct stance) = 1 then min(stance) end from candidates where stance is not null
$$;

-- 旧管理画面が旧フィールドだけを更新した場合だけ新分類を再同期する。
create or replace function public.sync_case_classification() returns trigger language plpgsql as $$
begin
  if new.canonical_status is null
     or (tg_op = 'UPDATE' and new.status is distinct from old.status and new.canonical_status is not distinct from old.canonical_status) then
    new.canonical_status := case when new.status in ('rumored','commented') then 'tracking'
      when new.status in ('announced','completed','withdrawn') then 'announced' else 'closed' end;
  end if;
  return new;
end $$;
drop trigger if exists cases_sync_classification on public.cases;
create trigger cases_sync_classification before insert or update on public.cases
  for each row execute function public.sync_case_classification();

create or replace function public.sync_case_event_classification() returns trigger language plpgsql as $$
declare legacy_driven boolean;
begin
  legacy_driven := new.event_category is null or
    (tg_op = 'UPDATE' and new.event_type is distinct from old.event_type
      and new.event_category is not distinct from old.event_category);

  if legacy_driven then
    new.event_category := case
      when new.event_type in ('observation_report','follow_up_report') then 'media_report'
      when new.event_type in ('company_comment','timely_disclosure','consideration_ended') then 'company_disclosure'
      when new.event_type = 'formal_announcement' then 'formal_announcement'
      when new.event_type in ('price_revision','tender_offer_result','withdrawal') then 'post_announcement_update'
      when new.event_type = 'correction' then 'correction' else 'related_information' end;
    new.report_role := case when new.event_type = 'observation_report' then 'initial'
      when new.event_type = 'follow_up_report' then 'follow_up' end;
    if new.is_visible and new.report_role = 'initial' and exists (
      select 1 from public.case_events existing
      where existing.case_id = new.case_id and existing.id <> new.id and existing.is_visible
        and existing.event_category = 'media_report' and existing.report_role = 'initial'
    ) then
      new.report_role := 'follow_up';
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || '{"pr1_duplicate_initial_demoted":true}'::jsonb;
    end if;
    if tg_op = 'INSERT' or new.company_stance is not distinct from old.company_stance then
      new.company_stance := case when new.event_category = 'company_disclosure'
        then public.legacy_company_stance(new.comment_tags) end;
    end if;
  else
    if new.event_category <> 'media_report' and
       (tg_op = 'INSERT' or new.report_role is not distinct from old.report_role) then new.report_role := null; end if;
    if new.event_category <> 'company_disclosure' and
       (tg_op = 'INSERT' or new.company_stance is not distinct from old.company_stance) then new.company_stance := null; end if;
    if tg_op = 'UPDATE' and new.comment_tags is distinct from old.comment_tags
       and new.company_stance is not distinct from old.company_stance then
      new.company_stance := case when new.event_category = 'company_disclosure'
        then public.legacy_company_stance(new.comment_tags) end;
    end if;
  end if;

  if new.occurred_at is null and new.date_precision in ('datetime','date')
     and (tg_op = 'INSERT' or new.date_precision is not distinct from old.date_precision) then
    new.date_precision := 'unknown';
  end if;
  if tg_op = 'INSERT' or new.sort_at is not distinct from old.sort_at then
    new.sort_at := coalesce(new.occurred_at, new.market_trigger_date::timestamptz,
      new.issue_year_month::timestamptz, new.site_published_at, new.updated_at);
  end if;
  return new;
end $$;
drop trigger if exists case_events_sync_classification on public.case_events;
create trigger case_events_sync_classification before insert or update on public.case_events
  for each row execute function public.sync_case_event_classification();

-- 元テーブルのRLSを迂回させず、直接SELECTはservice_roleだけに限定する。
drop function if exists public.admin_case_event_migration_review();
drop view if exists public.case_event_migration_review;
create view public.case_event_migration_review with (security_invoker = true) as
select e.id, e.case_id, e.event_type, e.title,
  case when coalesce((e.metadata->>'pr1_duplicate_initial_demoted')::boolean, false) then '重複初報から続報へ自動変換'
       when e.event_type = 'timely_disclosure' then 'formal_announcement の可能性を確認'
       when e.event_category = 'company_disclosure' and e.company_stance is null and cardinality(e.comment_tags) > 1 then '旧スタンスタグの競合を確認'
       else '号数・日付精度を確認' end as review_reason
from public.case_events e
where e.event_type = 'timely_disclosure'
   or (e.event_category = 'company_disclosure' and e.company_stance is null and cardinality(e.comment_tags) > 1)
   or e.date_precision in ('issue','unknown') or e.issue_label is not null or e.issue_year_month is not null
   or coalesce((e.metadata->>'pr1_duplicate_initial_demoted')::boolean, false)
   or exists (select 1 from public.case_event_tags cet join public.event_tags t on t.id = cet.tag_id
              where cet.event_id = e.id and t.kind = 'source' and t.slug = 'monthly-magazine');
revoke all on public.case_event_migration_review from public, anon, authenticated;
grant select on public.case_event_migration_review to service_role;

create or replace function public.admin_case_event_migration_review()
returns table(id uuid, case_id uuid, event_type text, title text, review_reason text)
language sql security definer stable set search_path = public as $$
  select r.id, r.case_id, r.event_type, r.title, r.review_reason
  from public.case_event_migration_review r where public.is_admin()
$$;
revoke all on function public.admin_case_event_migration_review() from public, anon;
grant execute on function public.admin_case_event_migration_review() to authenticated, service_role;

-- 初期投入・バックフィル後に監査を有効化し、移行ノイズを生成しない。
drop trigger if exists event_tags_revision_history on public.event_tags;
create trigger event_tags_revision_history after insert or update or delete on public.event_tags
  for each row execute function public.record_revision_history();
create or replace function public.record_case_event_tag_revision_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.revision_history(table_name, record_id, operation, before_data, after_data, changed_by)
  values ('case_event_tags', coalesce(new.event_id, old.event_id), tg_op,
    case when tg_op = 'DELETE' then to_jsonb(old) end,
    case when tg_op = 'INSERT' then to_jsonb(new) end, auth.uid());
  return coalesce(new, old);
end $$;
drop trigger if exists case_event_tags_revision_history on public.case_event_tags;
create trigger case_event_tags_revision_history after insert or delete on public.case_event_tags
  for each row execute function public.record_case_event_tag_revision_history();
