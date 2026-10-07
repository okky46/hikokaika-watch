-- 半手動の終値更新と最初の噂の直前株価。既存行とRLSを保持する。
alter table public.price_snapshots add column share_basis_on date, add column rumor_on date, add column note text;
alter table public.price_snapshots drop constraint price_snapshots_type_check;
alter table public.price_snapshots add constraint price_snapshots_type_check check(price_type in ('pre_report_close','current_close','formal_offer_price','daily_close','pre_rumor_close'));
create function public.check_manual_price() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.price<=0 or new.price::text in ('NaN','Infinity','-Infinity') or length(coalesce(new.note,''))>500 or length(coalesce(new.source_name,''))>200 then raise exception '価格・注記を確認してください'; end if;
 if new.share_basis_on>(now() at time zone 'Asia/Tokyo')::date then raise exception '分割基準日は今日以前にしてください'; end if;
 if new.price_type in ('daily_close','pre_rumor_close') then
  if new.price_date>(now() at time zone 'Asia/Tokyo')::date or extract(isodow from new.price_date)>5 then raise exception '終値の日付を確認してください'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.case_id::text||new.price_type,0));
  if exists(select 1 from public.price_snapshots p where p.case_id=new.case_id and p.price_type=new.price_type and p.id<>new.id and (new.price_type='pre_rumor_close' or p.price_date=new.price_date)) then raise exception '同じ基準の価格が登録済みです。既存行を編集してください'; end if;
 end if;
 if new.price_type='pre_rumor_close' and (new.rumor_on is null or new.price_date>=new.rumor_on or new.rumor_on>(now() at time zone 'Asia/Tokyo')::date) then raise exception '最初の噂の日と、その直前の株価を確認してください'; end if;
 return new;
end $$;
create trigger check_manual_price before insert or update on public.price_snapshots for each row execute function public.check_manual_price();
revoke all on function public.check_manual_price() from public,anon,authenticated;

-- 一括入力は全件成功か全件取消。既存値の上書きは個別編集で行う。
create function public.add_daily_closes(rows jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; n integer:=0;
begin
 if not public.is_admin() then raise exception '管理者ログインが必要です'; end if;
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 300 or octet_length(rows::text)>500000 then raise exception '終値は1〜300件で指定してください'; end if;
 for r in select value from jsonb_array_elements(rows) loop
  if r->>'price_type' is distinct from 'daily_close' or jsonb_typeof(r->'price') is distinct from 'number' or (r->>'price')::numeric<>round((r->>'price')::numeric,2) then raise exception '日次終値の数値を確認してください'; end if;
  insert into public.price_snapshots(case_id,price_type,price,price_date,source_name,share_basis_on,note)
   values((r->>'case_id')::uuid,'daily_close',(r->>'price')::numeric,(r->>'price_date')::date,nullif(r->>'source_name',''),nullif(r->>'share_basis_on','')::date,nullif(r->>'note',''));
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.add_daily_closes(jsonb) from public,anon,authenticated;
grant execute on function public.add_daily_closes(jsonb) to authenticated;

-- 任意の財務補足も保存・公開時に検証し、旧レコードはそのまま許容する。
create function public.check_market_financial_basis() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare p jsonb; d text;
begin
 foreach p in array array[new.draft,new.published] loop
  if p->>'kind'='financials' then
   if p ? 'shareBasisOn' then
    d:=p->>'shareBasisOn';
    if jsonb_typeof(p->'shareBasisOn') is distinct from 'string' or d !~ '^\d{4}-\d{2}-\d{2}$' or to_char(d::date,'YYYY-MM-DD')<>d then raise exception '株式数の分割基準日を確認してください'; end if;
   end if;
   if p ? 'ebitdaPeriodMonths' and (jsonb_typeof(p->'ebitdaPeriodMonths') is distinct from 'number' or (p->>'ebitdaPeriodMonths')::numeric not between 1 and 12 or (p->>'ebitdaPeriodMonths')::numeric<>trunc((p->>'ebitdaPeriodMonths')::numeric)) then raise exception 'EBITDAの対象月数を確認してください'; end if;
  end if;
 end loop;
 return new;
end $$;
create trigger check_market_financial_basis before insert or update on public.valuation_editions for each row execute function public.check_market_financial_basis();
revoke all on function public.check_market_financial_basis() from public,anon,authenticated;
