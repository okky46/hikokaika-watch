-- 読取専用。本番のSQL Editorで実行し、結果だけを確認する。秘密値・メモ本文は取得しない。
select table_name,column_name,data_type,is_nullable
from information_schema.columns where table_schema='public' and (
  (table_name='cases' and column_name in ('canonical_status','tracking_reason','last_checked_on')) or
  (table_name='case_events' and column_name in ('occurred_at','event_category','date_precision','sort_at')) or
  table_name in ('articles','article_companies')) order by table_name,ordinal_position;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public'
  and tablename in ('user_case_notes','user_global_notes','user_case_favorites','articles','article_companies');
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('user_case_notes','user_global_notes','user_case_favorites','articles','article_companies');
select routine_name from information_schema.routines where routine_schema='public'
  and routine_name in ('sync_case_classification','sync_case_event_classification','admin_case_event_migration_review','read_published_articles','save_article_draft','set_article_publication','validate_article_content','article_trim','article_utf16_length','article_source_url_valid');
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.case_events'::regclass order by conname;
