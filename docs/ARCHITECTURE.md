# アーキテクチャ

要件定義書 §21 で求められている「採用するフレームワーク、静的公開方式、認証構成、管理画面の保護方式」の整理。

## 1. フレームワーク: Astro(静的出力)

- 公開情報は静的配信が基本(要件 §9・§21)のため、静的サイト生成に特化した Astro を採用。
- `output: 'static'`。SSR・サーバー関数は使わない(無料枠・課金防止の観点でも最も安全)。
- インタラクティブな部分(ログイン機能・管理画面)は、フレームワークランタイムを持たない
  素の TypeScript の `<script>` アイランドとして実装。React 等のランタイム依存を持たず、
  依存パッケージは `astro` と `@supabase/supabase-js` のみに抑える(保守性・無料運用)。

## 2. 静的公開方式

```
[管理者] → 管理画面(/admin) → Supabase(公開データテーブルへ書き込み)
                │
                └ 「公開処理」ボタン → Cloudflare Pages Deploy Hook を呼ぶ
                                            │
                              Cloudflare Pages がビルドを実行
                                            │
        ビルド時: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY で公開データを取得
        (is_visible = true のみ)→ 静的HTML + 静的JSON(/data/cases.json)を生成
                                            │
                              [一般閲覧者] ← Cloudflare CDN から静的配信
```

- **公開ページの閲覧では Supabase に一切アクセスしない。** 集計カード・検索・絞り込み・
  タイムライン・株価はすべてビルド時に HTML / ページ内埋め込み JSON へ焼き込まれる。
- 検索・絞り込みはページに埋め込んだ JSON をクライアント側 JS でフィルタする
  (MVP の案件数規模では十分。外部リクエストは発生しない)。
- Service Role Key は **ビルド環境(Cloudflare Pages のビルド環境変数)にのみ** 存在し、
  `PUBLIC_` プレフィックスを付けないためブラウザへは絶対に出ない。
- ローカル開発では `DEPLOY_ENV` と `DATA_SOURCE` が両方未設定の場合のみ `development + sample` にフォールバックし、CI / Cloudflare Pages では `DEPLOY_ENV` と `DATA_SOURCE` を明示する。`SITE_URL` は canonical / OGP / sitemap 用で、データソースや実行環境の判定には使わない。
- 再公開フロー: 管理画面の「公開処理」→ Deploy Hook → 数分後に静的サイトが更新される。
  Deploy Hook URL は Supabase の `admin_settings` テーブル(管理者のみ RLS で読める)に保存する。

## 3. 認証構成

| 対象 | 方式 |
|---|---|
| 一般閲覧者 | 認証なし。静的ページのみ。Supabase 接続なし |
| ログインユーザー | Supabase Auth + Google OAuth。ブラウザから anon key + RLS で自分のデータのみ操作 |
| 管理者 | Cloudflare Access(前段)+ Supabase Auth Google ログイン + `admin_users` RLS(後段) |

ログインユーザーが Supabase へ直接アクセスするのは以下のみ(要件 §9):
認証 / お気に入り / 関心度 / 案件別メモ / 全体メモ。
これらはすべて RLS で `auth.uid() = user_id` を強制し、他人のデータは DB レベルで取得不可。

## 4. 管理画面の保護(多層防御)

1. **Cloudflare Access** で `/admin*` を保護(手順は SETUP.md)。
   許可メールアドレスは管理者本人の 1 件のみ。Access 側で MFA を必須化。
2. `/admin` ページ自体は `noindex` + robots.txt で検索エンジン除外。
3. 管理画面へ入れても、操作には **Supabase Auth での本人ログイン** が必要。
4. 書き込みの最終判定は **DB 側の RLS**: `admin_users` テーブルに登録された UUID
   (`is_active = true`)のみ公開データテーブルへ read/write 可能。
   フロントエンドのメールアドレス比較による管理者判定は行わない。
5. Supabase 側で MFA(TOTP)を登録した場合、`aal2` セッションを要求するポリシーへ
   切り替え可能(マイグレーション内にコメント付きで用意)。
6. Service Role Key はビルド環境のみ。管理画面は anon key + 本人セッションで動作する。

## 5. 無料運用・課金防止

- 公開ページは Cloudflare の静的配信のみ → アクセス急増しても Supabase の
  DB/API/転送量を消費しない。
- Supabase 無料枠が停止しても、公開ページ(Cloudflare 上の静的ファイル)は閲覧可能。
  ログイン・メモ等の動的機能のみ停止する(要件 §16 の縮退方針どおり)。
- 有料 API・画像アップロード・自動課金サービスは使用しない。株価は管理者の手動登録。

## 6. 将来拡張への備え

- `cases` / `case_events` に `metadata jsonb` を持たせ、将来の
  `created_by_type` / `review_status` 等はマイグレーション追加のみで対応可能。
- AI 収集は「下書き保存 → 管理者承認 → 公開」フローを想定し、`is_visible` フラグと
  管理画面のプレビュー機能が承認フローの土台になる。

## 会社コメント分類と監査ログ

会社コメントイベントは `case_events.comment_tags` に複数タグを保持し、TypeScript の `src/lib/commentTags.ts` で表示名・説明・分類影響を一元管理します。タグから `comment_stance` を自動算出し、公開データにも会社コメント分類を含めます。

管理者操作の内部監査は `revision_history` にDBトリガーで記録します。公開画面の「訂正あり」とは分離し、対象は `companies`、`cases`、`case_events`、`price_snapshots` です。`admin_settings` は履歴対象外です。
