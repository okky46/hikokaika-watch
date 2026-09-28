-- 0007適用後に実行。公開データ・権限・記事RPCの引数は変更しない。
begin;

-- JavaScript String.trim()と同じ空白集合（Unicode WhiteSpace + LineTerminator）。
create or replace function public.article_trim(value text) returns text
language sql immutable strict set search_path=public as $$
  select btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

-- JavaScriptの文字列.lengthと同じUTF-16単位数。補助平面の文字は2単位。
create or replace function public.article_utf16_length(value text) returns integer
language sql immutable strict set search_path=public as $$
  select length(regexp_replace(value, U&'[\+010000-\+10FFFF]', 'xx', 'g'));
$$;

-- articleSourceUrl.tsと共通の範囲。国際化ドメインは対象外。
-- URL()で解釈が変わるuserinfo、制御文字、バックスラッシュ、非標準IP表記を拒否する。
create or replace function public.article_source_url_valid(value text) returns boolean
language plpgsql immutable strict set search_path=public as $$
declare parts text[]; hostname text; octet text;
begin
  if value ~ '[[:cntrl:][:space:]]' or strpos(value, chr(92)) > 0 then return false; end if;
  parts := regexp_match(value, '^https?://(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:([0-9]{1,5}))?([/?#].*)?$', 'i');
  if parts is null then return false; end if;
  hostname := lower(parts[1]);
  if parts[3] is not null and parts[3]::integer > 65535 then return false; end if;
  if left(hostname,1) = '[' then
    begin return family(trim(both '[]' from hostname)::inet) = 6;
    exception when invalid_text_representation then return false; end;
  end if;
  if hostname ~ '^([0-9]{1,3}\.){3}[0-9]{1,3}$' then
    foreach octet in array string_to_array(hostname,'.') loop
      if octet::integer > 255 or octet <> octet::integer::text then return false; end if;
    end loop;
    return true;
  end if;
  return length(hostname) <= 254 and hostname !~ '(^|\.)xn--'
    and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z]([a-z0-9-]{0,61}[a-z0-9])?\.?$';
end $$;

revoke all on function public.article_trim(text), public.article_utf16_length(text), public.article_source_url_valid(text) from public,anon,authenticated;

create or replace function public.validate_article_content(payload jsonb, for_publication boolean)
returns void language plpgsql set search_path = public as $$
declare k text; s jsonb; d text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception '記事はJSONオブジェクトで指定してください'; end if;
  if exists (select 1 from jsonb_object_keys(payload) as keys(key) where key not in
    ('title','summary','body','confirmed_facts','interpretation','unknowns','checked_on','correction_note','sources')) then
    raise exception '記事に未対応の項目があります';
  end if;
  foreach k in array array['title','summary','body','confirmed_facts','interpretation','unknowns','checked_on','correction_note'] loop
    if jsonb_typeof(payload->k) is distinct from 'string' or public.article_utf16_length(public.article_trim(payload->>k)) > 50000 then raise exception '記事の項目が不正です: %', k; end if;
  end loop;
  if public.article_utf16_length(public.article_trim(payload->>'title')) > 240 then raise exception 'タイトルが長すぎます'; end if;
  d := public.article_trim(payload->>'checked_on');
  if d <> '' and (d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD') <> d) then raise exception '確認日が不正です'; end if;
  if jsonb_typeof(payload->'sources') is distinct from 'array' then raise exception '出典は配列で指定してください'; end if;
  if jsonb_array_length(payload->'sources') > 30 then raise exception '出典は30件までです'; end if;
  for s in select value from jsonb_array_elements(payload->'sources') loop
    if jsonb_typeof(s) <> 'object' then raise exception '出典が不正です'; end if;
    foreach k in array array['name','url','published_on','checked_on'] loop
      if jsonb_typeof(s->k) is distinct from 'string' then raise exception '出典の項目が不正です'; end if;
    end loop;
    if public.article_trim(s->>'name') = '' or not public.article_source_url_valid(s->>'url') then raise exception '出典名とhttp(s) URLが必要です'; end if;
    foreach k in array array['published_on','checked_on'] loop
      d := s->>k;
      if (k = 'checked_on' or d <> '') and (d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD') <> d) then raise exception '出典の日付が不正です'; end if;
    end loop;
  end loop;
  if for_publication and (public.article_trim(payload->>'title') = '' or public.article_trim(payload->>'summary') = '' or public.article_trim(payload->>'confirmed_facts') = '' or public.article_trim(payload->>'checked_on') = '' or jsonb_array_length(payload->'sources') = 0) then
    raise exception '公開にはタイトル・要約・確認できた事実・確認日・出典が必要です';
  end if;
end $$;
revoke all on function public.validate_article_content(jsonb,boolean) from public, anon, authenticated;


-- 0007時代に不正な公開版が登録されていれば、データを黙って変更せず停止する。
do $$
declare article record;
begin
  for article in select slug,published from public.articles where published is not null loop
    begin perform public.validate_article_content(article.published,true);
    exception when others then
      raise exception '既存公開記事 % を修正・再承認または非公開化してから0008を再実行してください: %',article.slug,sqlerrm;
    end;
  end loop;
end $$;
commit;
