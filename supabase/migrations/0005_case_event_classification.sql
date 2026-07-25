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
  (event_category = 'media_report' and report_role in ('initial','follow_up','related','market_reaction'))
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

alter table public.cases validate constraint cases_canonical_status_check;
alter table public.case_events validate constraint case_events_category_check;
alter table public.case_events validate constraint case_events_report_role_check;
alter table public.case_events validate constraint case_events_company_stance_check;
alter table public.case_events validate constraint case_events_date_precision_check;

create unique index if not exists case_events_one_visible_initial_idx on public.case_events(case_id)
  where is_visible and event_category = 'media_report' and report_role = 'initial';

-- 旧管理画面からの INSERT/UPDATE にも新分類を補完する互換トリガー。
create or replace function public.sync_case_classification() returns trigger language plpgsql as $$
begin
  if new.canonical_status is null
     or (tg_op = 'UPDATE' and new.status is distinct from old.status and new.canonical_status is not distinct from old.canonical_status) then
    new.canonical_status := case
      when new.status in ('rumored','commented') then 'tracking'
      when new.status in ('announced','completed','withdrawn') then 'announced'
      else 'closed' end;
  end if;
  return new;
end $$;
drop trigger if exists cases_sync_classification on public.cases;
create trigger cases_sync_classification before insert or update on public.cases
  for each row execute function public.sync_case_classification();

create or replace function public.sync_case_event_classification() returns trigger language plpgsql as $$
begin
  if new.event_category is null
     or (tg_op = 'UPDATE' and new.event_type is distinct from old.event_type and new.event_category is not distinct from old.event_category) then
    new.event_category := case
      when new.event_type in ('observation_report','follow_up_report') then 'media_report'
      when new.event_type in ('company_comment','timely_disclosure','consideration_ended') then 'company_disclosure'
      when new.event_type = 'formal_announcement' then 'formal_announcement'
      when new.event_type in ('price_revision','tender_offer_result','withdrawal') then 'post_announcement_update'
      when new.event_type = 'correction' then 'correction' else 'related_information' end;
    new.report_role := case when new.event_type = 'observation_report' then 'initial' when new.event_type = 'follow_up_report' then 'follow_up' end;
  end if;
  if new.occurred_at is null and new.date_precision = 'datetime' then new.date_precision := 'unknown'; end if;
  new.sort_at := coalesce(new.occurred_at, new.market_trigger_date::timestamptz, new.issue_year_month::timestamptz, new.site_published_at, new.updated_at);
  return new;
end $$;
drop trigger if exists case_events_sync_classification on public.case_events;
create trigger case_events_sync_classification before insert or update on public.case_events
  for each row execute function public.sync_case_event_classification();

-- 要確認一覧: timely_disclosure の正式発表混在、旧スタンスタグ競合、便宜日時の月刊誌は本番確認対象。
create or replace view public.case_event_migration_review as
select id, case_id, event_type, title,
  case when event_type = 'timely_disclosure' then 'formal_announcement の可能性を確認'
       when event_category = 'company_disclosure' and company_stance is null and cardinality(comment_tags) > 1 then '旧スタンスタグの競合を確認'
       else '月刊誌等の便宜日時・日付精度を確認' end as review_reason
from public.case_events
where event_type = 'timely_disclosure'
   or (event_category = 'company_disclosure' and company_stance is null and cardinality(comment_tags) > 1);
