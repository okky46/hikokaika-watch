# DB更新を自動にする初回設定

2026-09-29の適用後CSVでは、0007・0008の追加テーブル・列・関数、メモとお気に入りの本人限定RLSを確認できた。**0007・0008をもう一度実行する必要はない。** CSVは定義の全文や実ログインを検証したものではないため、初回の自動更新でDB定義も照合する。

設定後は、mainへのマージや管理画面の「公開処理」で、コード検証 → DB更新 → サイトのビルド → Cloudflareによる公開の順に進む。毎回SQL Editorを操作する必要はない。既存のGoogleログイン、メモ、ドメイン、フォントをそのまま使う。

## 最初に一度だけ行うこと

### 2026-09-29の設定状況

- 管理者の承認を受け、`hikokaika-watch` だけの Database Read-write トークン `hikokaika-cloudflare-deploy` を発行済み。有効期限は **2026-12-28**。期限前の更新が必要であり、鍵の自動更新は未実装。
- 既存Cloudflare Pages `hikokaika-watch` の **Production** に `SUPABASE_DEPLOY_TOKEN` をSecretとして保存し、「値が暗号化されました」を確認済み。Previewには存在しないことも確認済み。鍵の値はリポジトリに保存しない。
- Supabaseの対象と既存 `SUPABASE_URL` の一致、本番の `DEPLOY_ENV=production` / `DATA_SOURCE=supabase`、Previewの `DEPLOY_ENV=preview` / `DATA_SOURCE=sample` を確認済み。
- **未完了:** PR #10・#11のマージ、ビルドコマンド変更、初回本番デプロイ、実DBの照合・Googleログインとメモの動作確認。現在のビルドコマンドは `npm run build` のまま。自動化コードがmainに入る前に変更しない。

再開時は鍵を再発行せず、PRとCloudflareの最新状態を確認して未完了項目から進める。

### 1. 自動化コードを取り込む

PR #10を先にマージし、その後、この自動化PRをマージする。最初はCloudflareの従来の `npm run build` のままでよい。今回の0007・0008は手動適用済みなので、新コードを取り込むための追加SQLはない。

### 2. 更新用の鍵を作る

[SupabaseのAccess Tokens画面](https://supabase.com/dashboard/account/tokens)で新しいトークンを作成する。

- 名前の例: `hikokaika-cloudflare-deploy`
- 対象: このサイトで現在使用しているプロジェクトだけ
- 権限: **Database → Database → Read-write**（SQL実行用）
- 有効期限: 自分で管理できる期限を設定。期限前に同じ方法で更新する。

これは既存のanon keyやservice role keyとは別の、自動更新用の鍵。表示された値をチャット・リポジトリ・CSVに貼らず、次のCloudflareのSecret欄へ直接登録する。プロジェクトを選ぶ際は、Cloudflareに既に設定されている `SUPABASE_URL` と同じものを使う。

### 3. Cloudflareへ登録する

Cloudflare → Workers & Pages → **既存の `hikokaika-watch`** → Settings → Variables and Secretsで、**Productionだけ**に追加する。

| 項目 | 入力内容 |
|---|---|
| 種類 | Secret（暗号化） |
| 名前 | `SUPABASE_DEPLOY_TOKEN` |
| 値 | 手順2で作ったトークン |

`PUBLIC_`は付けない。Previewには登録しない。既存のSupabase URL・キーを置き換えない。

続いてSettingsのビルド設定で、Build commandを次へ変更する。

```text
npm run build:cloudflare
```

出力先 `dist`、本番ブランチ `main`、ドメイン、Google認証の設定はそのままにする。本番は既存どおり `DEPLOY_ENV=production` / `DATA_SOURCE=supabase`。Previewは `DEPLOY_ENV=preview` / `DATA_SOURCE=sample`。本番用の `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` もPreviewには設定しない。

### 4. 一度だけ再デプロイして確認する

Deploymentsから、**自動化コードが入った最新main**を再デプロイする。ログに次が表示され、デプロイが成功すれば有効化完了。

```text
[deploy] 公開前のコード検証
[deploy] DBの状態照合・未適用SQLの更新
[deploy] DB更新履歴 6件を確認。サイトをビルドします
```

初回の6件は既存SQLの実行記録を引き継いだもの。既存SQLそのものは再実行せず、非公開の `site_deploy.migrations` に記録する。履歴はSupabase CLI用の `supabase_migrations` とは別管理であり、CLIの `db push` と併用しない。

成功後は本番サイトでGoogleログインとメモの保存・再読込を一度確認する。これ以降の通常更新では、SQLファイル番号の選択・コピー・貼り付けは不要。

## 更新に失敗したら

エラーメッセージをこのチャットへ送ればよい。SQLを適当に再実行したり、DBを初期化したりしない。

- **トークン・権限・期限**: トークンの対象プロジェクト・権限・期限を確認する。
- **0008構成と一致しない**: 既存の定義と基準との差を確認する。自動で上書きしない。
- **別のDB更新が実行中**: もう一方が終わった後に再デプロイする。
- **更新履歴の不一致**: 過去のSQLが変更・削除されたか、古いコードを再ビルドしていないか確認する。

DB更新は1つのトランザクションで実行し、失敗した回のSQLと履歴はまとめてロールバックする。通信切断時は実行済みか分からない場合があるため、その場で無条件に再送しない。次の再デプロイで履歴を確認し、適用済みSQLは飛ばす。

**DB更新が成功した後にサイトのビルドが失敗した場合、DB更新は残る。** Cloudflareの以前の公開サイトは維持されるため、DB変更は旧サイトとも互換性のある追加変更を原則とする。公開サイトの切り戻しはCloudflareの過去のデプロイを使い、古いコミットからDBを巻き戻そうとしない。

## 今後の開発作業（Codex向け）

- スキーマ変更は `supabase/migrations/0009_description.sql` 以降へ追加し、PRでレビューする。4桁連番。0005/0006を後から追加しない。
- 新SQLに `BEGIN` / `COMMIT` / `ROLLBACK`を入れない。実行側がトランザクションを管理する。トランザクション内で使えない操作は自動実行対象にしない。
- 適用済みファイルは変更・削除しない。改行コード以外の変更はハッシュ不一致として停止する。
- 初回基準の `baseline.json` と `verify_baseline.sql` は、0008までの変更を適用した隔離DBから作成したもの。今後の変更に合わせて基準を進めたり、照合が通るよう安易に緩めたりしない。
- 初回照合は100列・9関数・41制約と記事権限を確認する。既存 `is_admin()` のMFA設定は保持する。メモのRLS・本人限定ポリシーと認証関数は更新前後に検査する。
- すべてのSQLの意味を機械で保証する仕組みではない。削除・データ消失・権限変更・後方互換性のない変更が必要なら、実装・本番適用前にユーザーへ確認する。
- プレビューは本番DBへ接続しない。本番用トークンがPreviewにある場合も処理を停止する。
- 環境変数やAPIエラー本文をログへ出さない。更新トークンをAstro/Viteやテストの子プロセスへ渡さない。
- Authのプロバイダー設定、DNS、契約・課金、バックアップ復元はこの自動SQL更新の対象外。
- Cloudflareのビルドコマンドを `npm run build` に戻すと自動更新も停止する。以後のDB変更を含むPRはその状態でデプロイしない。

## 検証・有効化の状態

自動化コードはメモリ内PostgreSQLと模擬APIで検証する。実際のManagement API、トークンの権限、初回の本番照合、Cloudflare設定は、初回設定・デプロイが成功するまで未検証。リポジトリへのコード追加だけで有効化済みとは扱わない。

公式資料: [Supabase SQL実行API](https://supabase.com/docs/reference/api/v1-run-a-query)、[トークンの権限](https://supabase.com/docs/guides/platform/personal-access-tokens)、[Cloudflareのビルド設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)。
