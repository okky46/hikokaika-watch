-- ============================================================
-- 非公開化ウォッチ 初期スキーマ + RLS
-- Supabase SQL Editor でそのまま実行できる。
-- ============================================================

-- ------------------------------------------------------------
-- 共通: updated_at 自動更新トリガー関数
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 管理者テーブル(先に定義: is_admin() が参照するため)
-- 管理者本人のユーザーUUIDのみ登録する。一般ユーザーが管理者権限を
-- 取得できる経路は存在しない(insert/update ポリシーを一切作らない)。
-- ------------------------------------------------------------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
-- ポリシーなし = anon/authenticated からは一切読み書き不可。
-- 登録は Supabase Dashboard(service role)からのみ行う。

-- ------------------------------------------------------------
-- 管理者判定関数
-- security definer で admin_users を参照する(RLSポリシーから安全に使う)。
-- フロントエンドのメールアドレス比較には依存しない(要件 §10-7)。
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and is_active
  );
$$;

-- 管理画面が「ログイン中のユーザーが管理者かどうか」を確認するための RPC。
-- (RLS は行を黙って除外するため、判定には関数呼び出しを使う)
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.is_admin() from anon;

-- 【推奨】Supabase MFA(TOTP)登録後は、上の関数を以下の aal2 必須版に
-- 置き換える(要件 §10-6)。MFA未登録のまま置き換えると管理操作が
-- できなくなるため、必ず /admin からTOTP登録を済ませてから実行すること。
--
-- create or replace function public.is_admin()
-- returns boolean
-- language sql
-- security definer
-- set search_path = public
-- stable
-- as $$
--   select exists (
--     select 1 from public.admin_users
--     where user_id = auth.uid() and is_active
--   )
--   and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
-- $$;

-- ------------------------------------------------------------
-- 公開データ: 会社
-- ------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  security_code text not null,            -- 証券コードは文字列(先頭ゼロ・英字コード対応)
  name_ja       text not null,
  market        text,
  industry      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index companies_security_code_idx on public.companies (security_code);

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 公開データ: 案件(1社に複数案件が発生しうるため会社と分離)
-- ------------------------------------------------------------
create table public.cases (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id),
  title             text not null,
  slug              text not null,        -- 例: 1234-company-name
  status            text not null default 'rumored',
  summary           text not null default '',
  first_reported_at timestamptz,
  site_published_at timestamptz,
  updated_at        timestamptz not null default now(),
  is_visible        boolean not null default false,
  metadata          jsonb,
  constraint cases_status_check check (status in (
    'rumored',      -- 観測報道段階(正式発表前)
    'commented',    -- 会社コメントあり(正式発表前)
    'announced',    -- 正式発表済み(TOB等進行中)
    'completed',    -- 成立・完了
    'withdrawn',    -- 撤回・不成立
    'dormant'       -- 検討終了・長期未進展
  ))
);

create unique index cases_slug_idx on public.cases (slug);
create index cases_company_id_idx on public.cases (company_id);
create index cases_updated_at_idx on public.cases (updated_at desc);

create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 公開データ: 出来事タイムライン
-- ------------------------------------------------------------
create table public.case_events (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.cases (id) on delete cascade,
  event_type        text not null,
  occurred_at       timestamptz not null,   -- 報道・公表された日時
  title             text not null,
  summary           text not null default '',
  source_name       text not null default '',
  source_url        text not null default '',
  site_published_at timestamptz,            -- 非公開化ウォッチへの初回掲載日時
  updated_at        timestamptz not null default now(),
  sort_order        integer not null default 0,
  is_visible        boolean not null default false,
  metadata          jsonb,                  -- 訂正情報 {"corrected": true, "correction_note": "..."} 等
  constraint case_events_type_check check (event_type in (
    'observation_report',   -- 観測報道
    'company_comment',      -- 会社コメント
    'follow_up_report',     -- 続報
    'timely_disclosure',    -- 適時開示
    'formal_announcement',  -- 正式発表
    'price_revision',       -- 公開買付価格の変更
    'tender_offer_result',  -- 公開買付結果
    'consideration_ended',  -- 検討終了
    'withdrawal',           -- 撤回・不成立
    'correction',           -- 訂正
    'other'
  ))
);

create index case_events_case_id_idx on public.case_events (case_id, occurred_at);

create trigger case_events_set_updated_at
  before update on public.case_events
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 公開データ: 株価スナップショット(管理者が手動登録する参考値)
-- 価格は numeric(固定小数点)。浮動小数点は使用しない(要件 §8)。
-- ------------------------------------------------------------
create table public.price_snapshots (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases (id) on delete cascade,
  price_type  text not null,
  price       numeric(12, 2) not null,
  price_date  date not null,
  source_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint price_snapshots_type_check check (price_type in (
    'pre_report_close',   -- 観測報道前終値
    'current_close',      -- 現在株価(手動更新の参考値)
    'formal_offer_price'  -- 正式公開買付価格
  ))
);

create index price_snapshots_case_id_idx on public.price_snapshots (case_id, price_type, price_date desc);

create trigger price_snapshots_set_updated_at
  before update on public.price_snapshots
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 公開データテーブルの RLS
--   一般公開の閲覧は静的サイト経由のため、anon への SELECT 許可は不要。
--   ビルドは service role(RLSバイパス)で行う。
--   管理者(is_admin())のみ読み書き可能。
-- ------------------------------------------------------------
alter table public.companies       enable row level security;
alter table public.cases           enable row level security;
alter table public.case_events     enable row level security;
alter table public.price_snapshots enable row level security;

create policy "admin all" on public.companies
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin all" on public.cases
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin all" on public.case_events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin all" on public.price_snapshots
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 管理設定(Deploy Hook URL 等)。管理者のみアクセス可。
-- ------------------------------------------------------------
create table public.admin_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

create trigger admin_settings_set_updated_at
  before update on public.admin_settings
  for each row execute function public.set_updated_at();

alter table public.admin_settings enable row level security;

create policy "admin all" on public.admin_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- ユーザーデータ: お気に入り(関心度 1〜3)
-- ------------------------------------------------------------
create table public.user_case_favorites (
  user_id    uuid not null references auth.users (id) on delete cascade,
  case_id    uuid not null references public.cases (id) on delete cascade,
  intensity  smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, case_id),          -- user_id × case_id で一意(要件 §8)
  constraint favorites_intensity_check check (intensity between 1 and 3)
);

create trigger user_case_favorites_set_updated_at
  before update on public.user_case_favorites
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- ユーザーデータ: 案件別メモ(ユーザー×案件で1件)
-- ------------------------------------------------------------
create table public.user_case_notes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  case_id    uuid not null references public.cases (id) on delete cascade,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, case_id)
);

create trigger user_case_notes_set_updated_at
  before update on public.user_case_notes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- ユーザーデータ: 全体メモ(ユーザーごとに1件)
-- ------------------------------------------------------------
create table public.user_global_notes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_global_notes_set_updated_at
  before update on public.user_global_notes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- ユーザーデータの RLS(要件 §11)
--   本人のみ 閲覧・登録・更新・削除 可能。
--   フロントエンドの出し分けではなく、DB側で他人のデータを拒否する。
-- ------------------------------------------------------------
alter table public.user_case_favorites enable row level security;
alter table public.user_case_notes     enable row level security;
alter table public.user_global_notes   enable row level security;

create policy "own favorites" on public.user_case_favorites
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own case notes" on public.user_case_notes
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own global note" on public.user_global_notes
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
