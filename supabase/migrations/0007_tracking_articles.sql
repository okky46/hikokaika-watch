-- 0001〜0004が前提。PR #8の0005/0006には依存しない（適用済みでも共存）。
-- Auth、is_admin()、個人メモ・お気に入りのRLS、既存IDを変更しない。
begin;

alter table public.cases add column if not exists tracking_reason text not null default '';
alter table public.cases add column if not exists tracking_started_on date;
alter table public.cases add column if not exists last_checked_on date;
alter table public.cases add column if not exists verification_note text not null default '';
-- 日付不明の出来事を、推測の日時で登録しない。PR #8適用済みなら既にnullable。
alter table public.case_events alter column occurred_at drop not null;

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  draft jsonb not null,
  published jsonb,
  revision bigint not null default 1,
  publication_version uuid,
  first_published_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint articles_publication_check check (
    (published is null and publication_version is null)
    or (published is not null and publication_version is not null and published_at is not null and first_published_at is not null)
  )
);

-- 関連付けは会社単位。同じ会社の複数案件に同じ関連記事を表示する。
-- 下書きの関連付け変更も、公開承認までは公開版へ反映しない。
create table public.article_companies (
  article_id uuid not null references public.articles(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  edition text not null check (edition in ('draft','published')),
  primary key(article_id, company_id, edition)
);
alter table public.articles enable row level security;
alter table public.article_companies enable row level security;
create policy "admin read articles" on public.articles for select to authenticated using (public.is_admin());
create policy "admin read article companies" on public.article_companies for select to authenticated using (public.is_admin());
revoke all on public.articles, public.article_companies from public, anon, authenticated;
grant select on public.articles, public.article_companies to authenticated;
grant all on public.articles, public.article_companies to service_role;

-- UI以外からRPCを呼んでも、同じ形式・公開条件を満たすこと。
create function public.validate_article_content(payload jsonb, for_publication boolean)
returns void language plpgsql set search_path = public as $$
declare k text; s jsonb; d text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception '記事はJSONオブジェクトで指定してください'; end if;
  if exists (select 1 from jsonb_object_keys(payload) as keys(key) where key not in
    ('title','summary','body','confirmed_facts','interpretation','unknowns','checked_on','correction_note','sources')) then
    raise exception '記事に未対応の項目があります';
  end if;
  foreach k in array array['title','summary','body','confirmed_facts','interpretation','unknowns','checked_on','correction_note'] loop
    if jsonb_typeof(payload->k) is distinct from 'string' or length(payload->>k) > 50000 then raise exception '記事の項目が不正です: %', k; end if;
  end loop;
  if length(payload->>'title') > 240 then raise exception 'タイトルが長すぎます'; end if;
  d := payload->>'checked_on';
  if d <> '' and (d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD') <> d) then raise exception '確認日が不正です'; end if;
  if jsonb_typeof(payload->'sources') is distinct from 'array' then raise exception '出典は配列で指定してください'; end if;
  if jsonb_array_length(payload->'sources') > 30 then raise exception '出典は30件までです'; end if;
  for s in select value from jsonb_array_elements(payload->'sources') loop
    if jsonb_typeof(s) <> 'object' then raise exception '出典が不正です'; end if;
    foreach k in array array['name','url','published_on','checked_on'] loop
      if jsonb_typeof(s->k) is distinct from 'string' then raise exception '出典の項目が不正です'; end if;
    end loop;
    if btrim(s->>'name') = '' or (s->>'url') !~* '^https?://[^/@[:space:]]+([/?#]|$)' then raise exception '出典名とhttp(s) URLが必要です'; end if;
    foreach k in array array['published_on','checked_on'] loop
      d := s->>k;
      if (k = 'checked_on' or d <> '') and (d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD') <> d) then raise exception '出典の日付が不正です'; end if;
    end loop;
  end loop;
  if for_publication and (btrim(payload->>'title') = '' or btrim(payload->>'summary') = '' or btrim(payload->>'confirmed_facts') = '' or payload->>'checked_on' = '' or jsonb_array_length(payload->'sources') = 0) then
    raise exception '公開にはタイトル・要約・確認できた事実・確認日・出典が必要です';
  end if;
end $$;
revoke all on function public.validate_article_content(jsonb,boolean) from public, anon, authenticated;

create function public.save_article_draft(article_id uuid, article_slug text, payload jsonb, company_ids uuid[], expected_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.articles; current_row public.articles;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です' using errcode='42501'; end if;
  perform public.validate_article_content(payload, false);
  if article_id is null then
    insert into public.articles(slug,draft) values(article_slug,payload) returning * into saved;
  else
    select * into current_row from public.articles where id=article_id for update;
    if not found then raise exception '記事が見つかりません'; end if;
    if expected_revision is distinct from current_row.revision then raise exception '別の編集があります。再読込してください'; end if;
    if current_row.first_published_at is not null and article_slug <> current_row.slug then raise exception '公開済みURLは変更できません'; end if;
    update public.articles set slug=article_slug,draft=payload,revision=revision+1,updated_at=now() where id=article_id returning * into saved;
  end if;
  delete from public.article_companies where article_companies.article_id=saved.id and edition='draft';
  insert into public.article_companies(article_id,company_id,edition)
    select saved.id, code, 'draft' from (select distinct unnest(coalesce(company_ids,'{}'::uuid[])) as code) codes;
  return jsonb_build_object('id',saved.id,'revision',saved.revision);
end $$;

create function public.set_article_publication(article_id uuid, expected_revision bigint, make_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare current_row public.articles; saved public.articles;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です' using errcode='42501'; end if;
  select * into current_row from public.articles where id=article_id for update;
  if not found then raise exception '記事が見つかりません'; end if;
  if expected_revision is distinct from current_row.revision then raise exception '別の編集があります。再読込してください'; end if;
  if make_public is null then raise exception '公開操作を指定してください'; end if;
  if make_public then
    perform public.validate_article_content(current_row.draft, true);
    update public.articles set published=draft,publication_version=gen_random_uuid(),
      first_published_at=coalesce(first_published_at,now()),published_at=now(),revision=revision+1,updated_at=now()
      where id=article_id returning * into saved;
  else
    update public.articles set published=null,publication_version=null,revision=revision+1,updated_at=now()
      where id=article_id returning * into saved;
  end if;
  delete from public.article_companies where article_companies.article_id=saved.id and edition='published';
  if make_public then
    insert into public.article_companies(article_id,company_id,edition)
      select saved.id,company_id,'published' from public.article_companies where article_companies.article_id=saved.id and edition='draft';
  end if;
  return jsonb_build_object('id',saved.id,'revision',saved.revision,'publication_version',saved.publication_version);
end $$;
revoke all on function public.save_article_draft(uuid,text,jsonb,uuid[],bigint) from public,anon;
revoke all on function public.set_article_publication(uuid,bigint,boolean) from public,anon;
grant execute on function public.save_article_draft(uuid,text,jsonb,uuid[],bigint) to authenticated;
grant execute on function public.set_article_publication(uuid,bigint,boolean) to authenticated;

-- 公開ビルドは1つのSQLスナップショットで本文と関連付けを読む。
-- draft/revision/下書きの関連付けを返さない。認証ブラウザからも実行不可。
create function public.read_published_articles() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'articles',coalesce((select jsonb_agg(jsonb_build_object('id',id,'slug',slug,'published',published,
      'publication_version',publication_version,'first_published_at',first_published_at,'published_at',published_at)) from public.articles where published is not null),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(to_jsonb(c)) from public.article_companies c join public.articles a on a.id=c.article_id where c.edition='published' and a.published is not null),'[]'::jsonb)
  );
$$;
revoke all on function public.read_published_articles() from public,anon,authenticated;
grant execute on function public.read_published_articles() to service_role;
commit;
