# 非公開化ウォッチ (hikokaika-watch)

上場企業の非公開化・MBO・TOB等に関する **観測報道 → 会社コメント → 続報 → 正式発表 → その後の経過** と株価情報を、案件単位で時系列に整理する公開データベース。

> 本サービスは投資助言サービスではなく、一般公開された情報を確認・整理するための情報アーカイブです。

## 構成概要

| 項目 | 採用技術 |
|---|---|
| フレームワーク | Astro(完全静的出力) |
| 公開サイト配信 | Cloudflare Pages(静的HTML/JSON) |
| DB | Supabase PostgreSQL |
| 一般ユーザー認証 | Supabase Auth(Google OAuth) |
| ユーザーデータ保護 | Supabase RLS |
| 管理画面防御 | Cloudflare Access(MFA必須・管理者1名限定)+ Supabase `admin_users` RLS |
| 追加掲載・訂正申請 | Googleフォーム(外部リンク) |

**設計の柱**: 公開ページの閲覧では Supabase に一切アクセスしない。公開データはビルド時に静的化され、Cloudflare から配信される。Supabase へ接続するのはログインユーザーの操作(認証・お気に入り・メモ)と管理画面のみ。

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

## 開発

```bash
npm install
npm run dev      # 開発サーバー(サンプルデータで動作)
npm run build    # 静的ビルド(dist/)
npm run preview  # ビルド結果の確認
```

Cloudflare Pages 以外のローカル環境では、`DEPLOY_ENV` と `DATA_SOURCE` が両方未設定の場合のみ、安全な既定値として `DEPLOY_ENV=development` / `DATA_SOURCE=sample` が使われるため、リポジトリ取得直後でもサンプルデータ(`data/sample/`)で動作する。どちらか一方だけを設定した場合や未知の値はエラーになる。
Supabase / Google フォーム連携は `.env.example` を `.env` にコピーして設定する。

## デプロイ・初期セットアップ

Supabase プロジェクト作成、マイグレーション適用、Google OAuth、Cloudflare Pages、
Cloudflare Access(管理画面保護)の手順は [docs/SETUP.md](docs/SETUP.md) を参照。

## ディレクトリ構成

```
├── data/sample/          # サンプル公開データ(Supabase未設定時のビルド用・架空データ)
├── docs/                 # アーキテクチャ・セットアップ・進捗ドキュメント
├── public/               # 静的アセット(robots.txt, _headers 等)
├── supabase/migrations/  # DBスキーマ + RLSポリシー
└── src/
    ├── components/       # UIコンポーネント
    ├── layouts/          # ベースレイアウト(SEO/OGP含む)
    ├── lib/              # 型定義・ビルド時データ取得・ブラウザ用Supabaseクライアント
    ├── pages/            # ルーティング(/, /cases/[slug], /mypage, /admin ほか)
    └── styles/           # グローバルCSS
```

## ライセンス・免責

掲載情報の取り扱い・免責事項はサイト内の「免責事項」「掲載基準」ページを参照。

## ビルド時データソース

本番誤公開防止のため、ビルド環境は `DEPLOY_ENV=development|test|preview|production`、データソースは `DATA_SOURCE=sample|supabase` で判定します。Cloudflare Pages では両方必須で、本番は `DEPLOY_ENV=production DATA_SOURCE=supabase` と `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を設定してください。ローカル開発では両方未設定の場合に限り `development + sample` にフォールバックします。`SITE_URL` は canonical / OGP / sitemap 用であり、環境判定には使用しません。
