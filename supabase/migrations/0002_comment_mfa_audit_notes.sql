-- 会社コメント分類、案件ステータス、メモ制約、監査ログを追加する非破壊マイグレーション。

alter table public.case_events
  add column if not exists comment_stance text,
  add column if not exists comment_tags text[] not null default '{}';

alter table public.case_events drop constraint if exists case_events_comment_stance_check;
alter table public.case_events add constraint case_events_comment_stance_check check (
  comment_stance is null or comment_stance in ('acknowledged','neutral','denied','declined','unclear','needs_review')
);

alter table public.cases drop constraint if exists cases_status_check;
alter table public.cases add constraint cases_status_check check (status in (
  'rumored','commented','denied','announced','completed','withdrawn','ended','dormant'
));

alter table public.user_case_notes drop constraint if exists user_case_notes_body_length_check;
alter table public.user_case_notes add constraint user_case_notes_body_length_check check (char_length(body) <= 1000);
alter table public.user_global_notes drop constraint if exists user_global_notes_body_length_check;
alter table public.user_global_notes add constraint user_global_notes_body_length_check check (char_length(body) <= 1000);

create table if not exists public.revision_history (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.revision_history enable row level security;
drop policy if exists "admin read revision history" on public.revision_history;
create policy "admin read revision history" on public.revision_history
  for select to authenticated using (public.is_admin() and changed_by = auth.uid());

create or replace function public.record_revision_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  rid := coalesce(new.id, old.id);
  insert into public.revision_history(table_name, record_id, operation, before_data, after_data, changed_by)
  values (tg_table_name, rid, tg_op, case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end, auth.uid());
  return coalesce(new, old);
end;
$$;

create trigger companies_revision_history after insert or update or delete on public.companies
  for each row execute function public.record_revision_history();
create trigger cases_revision_history after insert or update or delete on public.cases
  for each row execute function public.record_revision_history();
create trigger case_events_revision_history after insert or update or delete on public.case_events
  for each row execute function public.record_revision_history();
create trigger price_snapshots_revision_history after insert or update or delete on public.price_snapshots
  for each row execute function public.record_revision_history();

-- aal2 必須化する場合の is_admin(): 管理画面は aal2 昇格後にこの RPC を呼ぶ。
-- create or replace function public.is_admin()
-- returns boolean language sql security definer set search_path = public stable as $$
--   select exists (select 1 from public.admin_users where user_id = auth.uid() and is_active)
--     and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
-- $$;
