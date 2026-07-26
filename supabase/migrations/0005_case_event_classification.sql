-- PR1: 案件・イベント分類の非破壊移行。
-- 旧 status/event_type/comment_* は互換期間中そのまま保持する。

alter table public.cases add column if not exists canonical_status text;
alter table public.cases drop constraint if exists cases_canonical_status_check;
alter table public.cases add constraint cases_canonical_status_check
  check (canonical_status in ('tracking', 'announced', 'closed')) not valid;

alter table public.case_events
  alter column occurred_at drop not null,
  add column if not exists event_category text,
  add column if not exists report_role text,
  add column if not exists company_stance text,
  add column if not exists date_precision text not null default 'datetime',
  add column if not exists issue_label text,
  add column if not exists issue_year_month date,
  add column if not exists market_trigger_date date,
  add column if not exists sort_at timestamptz;

alter table public.case_events drop constraint if exists case_events_category_check;
alter table public.case_events add constraint case_events_category_check check (event_category in (
  'media_report','company_disclosure','formal_announcement','post_announcement_update','related_information','correction'
)) not valid;
alter table public.case_events drop constraint if exists case_events_report_role_check;
alter table public.case_events add constraint case_events_report_role_check check (
  (event_category = 'media_report' and report_role is not null and report_role in ('initial','follow_up','related','market_reaction'))
  or (event_category <> 'media_report' and report_role is null)
) not valid;
alter table public.case_events drop constraint if exists case_events_company_stance_check;
alter table public.case_events add constraint case_events_company_stance_check check (
  company_stance is null or (event_category = 'company_disclosure' and company_stance in ('private_consideration','capital_policy','denied'))
) not valid;
alter table public.case_events drop constraint if exists case_events_date_precision_check;
alter table public.case_events add constraint case_events_date_precision_check check (
  (date_precision in ('datetime','date') and occurred_at is not null)
  or (date_precision = 'issue' and issue_label is not null and issue_year_month is not null)
  or date_precision = 'unknown'
) not valid;

alter table public.price_snapshots add column if not exists basis_note text;

create table if not exists public.event_tags (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('source','content')),
  slug text not null,
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, slug)
);
create table if not exists public.case_event_tags (
  event_id uuid not null references public.case_events(id) on delete cascade,
  tag_id uuid not null references public.event_tags(id),
  created_at timestamptz not null default now(),
  primary key (event_id, tag_id)
);
create index if not exists case_event_tags_tag_id_idx on public.case_event_tags(tag_id);

-- 再実行時も初期データ投入を監査履歴へ記録しない。
drop trigger if exists event_tags_revision_history on public.event_tags;
drop trigger if exists case_event_tags_revision_history on public.case_event_tags;

drop trigger if exists event_tags_set_updated_at on public.event_tags;
create trigger event_tags_set_updated_at before update on public.event_tags
  for each row execute function public.set_updated_at();

alter table public.event_tags enable row level security;
alter table public.case_event_tags enable row level security;
drop policy if exists "admin all" on public.event_tags;
create policy "admin all" on public.event_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.case_event_tags;
create policy "admin all" on public.case_event_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.event_tags(kind, slug, label, sort_order) values
  ('source','news-organization','報道機関',10), ('source','target-company','対象会社',20),
  ('source','parent-or-bidder','親会社・買付者',30), ('source','tdnet-exchange','TDnet・取引所',40),
  ('source','edinet-government','EDINET・官公庁',50), ('source','monthly-magazine','月刊誌',60),
  ('source','paid-media','有料媒体',70), ('source','foreign-media','海外メディア',80),
  ('content','wholly-owned-subsidiary','完全子会社化',10), ('content','privatization-policy','非公開化方針',20),
  ('content','privatization-consideration','非公開化検討',30), ('content','mbo','MBO',40), ('content','tob','TOB',50),
  ('content','fa-selection','FA選定',60), ('content','special-committee','特別委員会',70),
  ('content','initial-proposal','初期提案',80), ('content','first-bid','一次入札',90),
  ('content','final-bid','二次・最終入札',100), ('content','buyer-candidate','買い手候補',110),
  ('content','price-terms','価格・条件',120), ('content','timing','実施時期',130),
  ('content','consideration-ended','検討終了',140), ('content','tender-price-change','公開買付価格変更',150),
  ('content','tender-period-extension','公開買付期間延長',160), ('content','tender-result','公開買付結果',170),
  ('content','squeeze-out','スクイーズアウト',180), ('content','delisting','上場廃止',190),
  ('content','withdrawal-cancellation','撤回・中止',200), ('content','large-shareholding','大量保有報告',210)
on conflict (kind, slug) do update set label = excluded.label, sort_order = excluded.sort_order;

update public.cases set canonical_status = case
  when status in ('rumored','commented') then 'tracking'
  when status in ('announced','completed','withdrawn') then 'announced'
  when status in ('denied','ended','dormant') then 'closed'
end where canonical_status is null;

update public.case_events set
  event_category = case
    when event_type in ('observation_report','follow_up_report') then 'media_report'
    when event_type in ('company_comment','timely_disclosure','consideration_ended') then 'company_disclosure'
    when event_type = 'formal_announcement' then 'formal_announcement'
    when event_type in ('price_revision','tender_offer_result','withdrawal') then 'post_announcement_update'
    when event_type = 'correction' then 'correction' else 'related_information' end,
  report_role = case when event_type = 'observation_report' then 'initial' when event_type = 'follow_up_report' then 'follow_up' end,
  date_precision = case when occurred_at is null then 'unknown' else 'datetime' end,
  sort_at = coalesce(sort_at, occurred_at, site_published_at, updated_at)
where event_category is null;

-- 競合する旧タグは推測せず null のままにする。
update public.case_events set company_stance = case
  when comment_tags && array['consideration_acknowledged','proposal_received','discussions_ongoing']::text[]
    and not comment_tags && array['strategic_options_under_review','not_under_consideration','report_denied']::text[] then 'private_consideration'
  when comment_tags && array['strategic_options_under_review']::text[]
    and not comment_tags && array['consideration_acknowledged','proposal_received','discussions_ongoing','not_under_consideration','report_denied']::text[] then 'capital_policy'
  when comment_tags && array['not_under_consideration','report_denied']::text[]
    and not comment_tags && array['consideration_acknowledged','proposal_received','discussions_ongoing','strategic_options_under_review']::text[] then 'denied'
end where event_category = 'company_disclosure' and company_stance is null;

insert into public.case_event_tags(event_id, tag_id)
select e.id, t.id from public.case_events e join public.event_tags t
  on t.kind = 'content' and t.slug = 'consideration-ended'
where e.event_type = 'consideration_ended' on conflict do nothing;

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
