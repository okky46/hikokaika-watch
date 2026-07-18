-- ============================================================
-- フェーズ5: 情報収集候補 inbox
-- ============================================================

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('tdnet','edinet','news')),
  title text not null,
  url text not null,
  published_at timestamptz,
  security_code text,
  matched_case_id uuid references public.cases(id),
  suggested_event_type text,
  suggested_comment_tags text[],
  raw jsonb,
  dedup_key text unique not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.inbox_items enable row level security;

create policy "admin all" on public.inbox_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
