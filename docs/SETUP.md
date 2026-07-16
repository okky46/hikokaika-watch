# セットアップ手順

ゼロから本番運用を開始するまでの手順。すべて無料枠で完結する。

## 1. Supabase プロジェクト

1. https://supabase.com で新規プロジェクト作成(Free プラン、リージョンは Tokyo 推奨)。
2. SQL Editor で最新の `supabase/migrations` をファイル名順にすべて適用する。
   - 現時点では、少なくとも以下の順番で実行する。
     1. `supabase/migrations/0001_init.sql`
     2. `supabase/migrations/0002_comment_mfa_audit_notes.sql`
   - `0001_init.sql` でテーブル・RLS ポリシー・`is_admin()` 関数が作成される。
   - `0002_comment_mfa_audit_notes.sql` で会社コメントの複数タグ・分類、`denied` / `ended` ステータス、メモの1,000文字制限、`revision_history`、MFA・監査関連の追加設定が適用される。`0002` を適用しないと、これらの列・制約・設定が不足し、管理画面での保存や監査機能が正しく動作しない。
3. (任意)`supabase` CLI を使う場合: `supabase db push` で未適用のマイグレーションをすべて適用する。

## 2. Google OAuth(Supabase Auth)

1. Google Cloud Console で OAuth クライアント ID(Webアプリ)を作成。
   - 承認済みリダイレクト URI: `https://<project-ref>.supabase.co/auth/v1/callback`
2. Supabase Dashboard → Authentication → Providers → Google に
   Client ID / Client Secret を設定して有効化。
3. Authentication → URL Configuration:
   - Site URL: `https://<本番ドメイン>`
   - Redirect URLs: `https://<本番ドメイン>/**`(開発用に `http://localhost:4321/**` も追加可)

## 3. 管理者ユーザーの登録

1. 本番サイト(または開発サーバー)の `/mypage` から自分の Google アカウントでログインする
   (これで `auth.users` に自分のユーザーが作られる)。
2. Supabase Dashboard → Authentication → Users で自分の UUID をコピー。
3. SQL Editor で実行:
   ```sql
   insert into public.admin_users (user_id, is_active) values ('<自分のUUID>', true);
   ```
4. (推奨)Supabase 側 MFA を使う場合:
   - Dashboard → Authentication → Multi-Factor で TOTP を有効化。
   - 管理画面(/admin)の「セキュリティ」からTOTPを登録。
   - `0001_init.sql` 末尾のコメントに従い `is_admin()` を aal2 必須版に置き換える。

## 4. Cloudflare Pages(公開サイト)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git で
   `hikokaika-watch` リポジトリを接続。
2. ビルド設定:
   - Build command: `npm run build`
   - Build output directory: `dist`
3. 環境変数(Production):
   | 変数 | 値 |
   |---|---|
   | `DEPLOY_ENV` | `production` |
   | `DATA_SOURCE` | `supabase` |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key(**ビルド専用。他で使わない**) |
   | `PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SITE_URL` | `https://<本番ドメイン>` |
   | `PUBLIC_REQUEST_FORM_URL` | Google フォームの URL |
4. 環境ごとの `DEPLOY_ENV` / `DATA_SOURCE` は以下を明示する。
   - 本番: `DEPLOY_ENV=production` / `DATA_SOURCE=supabase`。上記の本番環境変数表に必ず設定する。
   - ローカル開発: `DEPLOY_ENV=development` / `DATA_SOURCE=sample`。両方未設定の場合のみ、この安全な既定値へフォールバックする。
   - CI: `DEPLOY_ENV=test` / `DATA_SOURCE=sample`。
   - Cloudflare Preview でサンプルデータを使う場合: `DEPLOY_ENV=preview` / `DATA_SOURCE=sample` を明示する。
   - `DEPLOY_ENV=production` では誤公開防止のため `DATA_SOURCE=sample` は拒否され、ビルドが失敗する。`SITE_URL` は canonical / OGP / sitemap 用で、環境判定には使用しない。
5. Settings → Builds & deployments → **Deploy Hooks** で hook を作成し、URL を控える。

## 5. 公開処理(Deploy Hook)の登録

管理画面の「公開処理」ボタンは Supabase の `admin_settings` テーブルに保存された
Deploy Hook URL を呼び出す。SQL Editor で登録する:

```sql
insert into public.admin_settings (key, value)
values ('deploy_hook_url', 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/....')
on conflict (key) do update set value = excluded.value;
```

※ このテーブルは RLS で管理者本人しか読めない。

## 6. Cloudflare Access(管理画面の保護)— 必須

**この設定を行うまで、本番の `/admin` を使用しないこと。**

1. Cloudflare Dashboard → Zero Trust(無料プラン可)→ Access → Applications → Add an application → Self-hosted。
2. Application domain: `<本番ドメイン>` / Path: `admin` (`/admin` 以下すべて)。
3. Policy を作成:
   - Action: Allow
   - Include → Emails: **管理者本人のメールアドレス 1 件のみ**
4. 認証方式: One-time PIN でも可だが、**Google 等の IdP + MFA を推奨**。
   Zero Trust → Settings → Authentication で Google をログイン方法に追加し、
   Google アカウント側の 2 段階認証を必須運用とする。
   (Access ポリシーの Require に「Authentication Method」を追加できるプランでは必須化する)
5. 動作確認: シークレットウィンドウで `/admin` にアクセスし、Access のログイン画面に
   リダイレクトされること、許可メール以外で拒否されることを確認する。

> 保護は多層: Access を突破されても、Supabase Auth の本人ログイン +
> `admin_users` RLS がなければ一切の読み書きができない。

## 7. Google フォーム(追加掲載・訂正申請)

1. Google フォームを作成し、以下を設定する。
   - 申請種別(選択式): 新規案件の追加 / 続報・会社コメントの追加 / 既存情報の訂正 / その他
   - 対象の会社名・証券コード(記述式)
   - 情報源のURL(記述式)
   - 補足(段落)
2. フォームの説明文に以下の注意書きを入れる:
   > 本フォームは、一般に公開されている報道、会社発表等の追加掲載または訂正を申請するためのものです。会社関係者として知り得た未公表情報、情報源を公開できない内部情報、第三者の個人情報は送信しないでください。
3. フォーム URL を `PUBLIC_REQUEST_FORM_URL` に設定して再デプロイする。

## 8. 運用フロー(日常)

1. `/admin` を開く(Cloudflare Access → Supabase ログイン)。
2. 会社 → 案件 → 出来事 → 株価を登録・編集(`is_visible` で下書き管理)。
3. 「プレビュー」で内容確認。
4. 「公開処理」ボタン → Cloudflare Pages が再ビルド → 数分で公開ページ更新。

## 9. ローカル開発

```bash
npm install
npm run dev   # http://localhost:4321 (サンプルデータで動作)
```

Supabase 連携込みで確認する場合は `.env.example` を `.env` にコピーして値を設定する。

## DATA_SOURCE と本番フェイルクローズ

ビルド時の環境判定は `DEPLOY_ENV`、データ取得元は `DATA_SOURCE` で明示します。`SITE_URL` は canonical / OGP / sitemap 用であり、環境判定には使用しません。

- Cloudflare Pages 上(`CF_PAGES=1`)では `DEPLOY_ENV` と `DATA_SOURCE` が必須です。未設定ならビルドを失敗させます。
- 本番: `DEPLOY_ENV=production` / `DATA_SOURCE=supabase`。Supabase から公開データを取得します。`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が必須です。不足時はビルドを失敗させます。
- ローカル開発: `DEPLOY_ENV=development` / `DATA_SOURCE=sample`。Cloudflare Pages 以外で両方未設定の場合のみ、この安全な既定値を使います。
- CI: `DEPLOY_ENV=test` / `DATA_SOURCE=sample`。
- Cloudflare Preview でサンプルデータを使う場合: `DEPLOY_ENV=preview` / `DATA_SOURCE=sample` を明示します。
- 片方だけが設定されている場合、未知の値、または `DEPLOY_ENV=production` / `DATA_SOURCE=sample` はビルドを失敗させます。

## メモ1000文字制約の検証運用

`supabase/migrations/0002_comment_mfa_audit_notes.sql` は、既存DBに1,000文字を超える案件別メモ・全体メモがあってもマイグレーションが失敗しないよう、`user_case_notes` / `user_global_notes` のCHECK制約を `NOT VALID` で追加します。これにより、新規INSERT・UPDATEには1,000文字制約が適用されますが、既存の違反行は無断で切り詰めず保持されます。

マイグレーション内では既存違反行が存在しない場合のみ `VALIDATE CONSTRAINT` を実行します。後日、制約状態と違反行を確認する場合は Supabase SQL Editor で以下を実行してください。

```sql
select conname, convalidated
from pg_constraint
where conname in (
  'user_case_notes_body_length_check',
  'user_global_notes_body_length_check'
);

select
  user_id,
  case_id,
  char_length(body) as body_length
from public.user_case_notes
where char_length(body) > 1000;

select
  user_id,
  char_length(body) as body_length
from public.user_global_notes
where char_length(body) > 1000;
```

既存違反行をユーザー確認のうえ整理した後、以下で制約を検証済みにできます。

```sql
alter table public.user_case_notes validate constraint user_case_notes_body_length_check;
alter table public.user_global_notes validate constraint user_global_notes_body_length_check;
```

## Supabase MFA aal2 運用と復旧

管理画面は Google ログイン後に Supabase Auth の AAL を確認し、`currentLevel=aal1` かつ `nextLevel=aal2` の場合は登録済みTOTPコードで `challenge` / `verify` を実行してから `is_admin()` を呼びます。DB側で `is_admin()` を aal2 必須版に切り替える前に、必ず管理者アカウントでTOTP登録を完了してください。

誤設定で管理者がログインできなくなった場合は、Supabase SQL Editor で一時的に以下の aal1 許可版へ戻して復旧します。

```sql
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
```

復旧後、管理者のTOTP登録・ログインを確認し、必要に応じて aal2 必須版へ再度切り替えてください。

## 10. 広告収益化とアクセス統計(フェーズ3)

### Google AdSense

- `PUBLIC_ADSENSE_CLIENT` に AdSense の client ID(`ca-pub-...`)を設定すると、仕様で定めた広告枠だけに広告タグが出力されます。
- 未設定の場合、広告関連タグはHTMLへ一切出力されません。ローカル開発時のプレースホルダ表示も `PUBLIC_ADSENSE_CLIENT` がある場合だけ表示されます。
- `public/ads.txt` は審査・承認後に AdSense 管理画面で提示される正式な行へ差し替えてください。例:
  ```text
  google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
  ```
- AdSense審査はサンプルデータ状態では通りません。実案件データを数十件投入し、免責事項・プライバシーポリシー・問い合わせ導線を整えてから申請してください。

### Cloudflare Web Analytics

- `PUBLIC_CF_ANALYTICS_TOKEN` に Cloudflare Web Analytics の公開トークンを設定すると、全ページにCookieレスのビーコンが出力されます。
- 未設定の場合、Cloudflare Web Analytics のビーコンはHTMLへ出力されません。

### 管理画面のアクセス統計タブ

`/admin` の「アクセス統計」タブは `/api/analytics` の Cloudflare Pages Function 経由で Cloudflare GraphQL Analytics API を呼び出します。APIトークンは必ず Pages のサーバー側環境変数に設定し、`PUBLIC_` を付けないでください。

| 変数 | 種別 | 用途 |
|---|---|---|
| `PUBLIC_ADSENSE_CLIENT` | 公開 | AdSense client ID。未設定なら広告タグ非出力。 |
| `PUBLIC_CF_ANALYTICS_TOKEN` | 公開 | Cloudflare Web Analytics ビーコントークン。未設定ならビーコン非出力。 |
| `CF_ANALYTICS_API_TOKEN` | サーバー側 | Pages Function が Cloudflare GraphQL Analytics API を呼ぶためのトークン。 |
| `CF_ZONE_TAG` | サーバー側 | Analytics 対象のCloudflare zoneTag。 |
| `CF_ACCOUNT_ID` | サーバー側 | 必要に応じて運用メモ・将来拡張で利用するアカウントID。 |

Pages Function は Cloudflare Access で保護された `/admin` からの利用を前提にします。`/admin` のAccess保護を外した状態で本番運用しないでください。
