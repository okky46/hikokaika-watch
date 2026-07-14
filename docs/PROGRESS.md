# 実装進捗

実装中断からの再開用メモ。

## 状態: MVP実装完了(コード側)

| # | 項目 | 状態 |
|---|---|---|
| 1 | プロジェクト基盤(Astro, tsconfig, env, docs) | ✅ |
| 2 | Supabase マイグレーション(スキーマ + RLS + is_admin RPC) | ✅ |
| 3 | データ層(types / publicData / サンプルデータ) | ✅ |
| 4 | 公開ページ(トップ・一覧・詳細・掲載基準/FAQ・免責・プライバシー・404・sitemap・robots) | ✅ |
| 5 | ログイン機能(Googleログイン・お気に入り・関心度・案件別メモ・全体メモ・mypage) | ✅ |
| 6 | 管理画面(CRUD・プレビュー・公開処理・訂正履歴・MFA登録UI) | ✅ |
| 7 | ビルド検証(astro check 0 errors / PC・モバイル表示確認) | ✅ |

## 残作業(コード外・運用セットアップ)

デプロイ時に docs/SETUP.md の手順を実施する:

1. Supabase プロジェクト作成 + `supabase/migrations/0001_init.sql` 実行
2. Google OAuth 設定(Supabase Auth)
3. 管理者UUIDを `admin_users` に登録
4. Cloudflare Pages 接続 + 環境変数設定 + Deploy Hook 作成
5. `admin_settings` に `deploy_hook_url` を登録
6. **Cloudflare Access で /admin を保護(必須・MFA有効化)**
7. Google フォーム作成 + `PUBLIC_REQUEST_FORM_URL` 設定
8. (推奨)管理画面からTOTP登録後、`is_admin()` を aal2 必須版へ置き換え

## 設計上の決定事項(再開時に必ず読む)

- フレームワーク: **Astro 静的出力のみ**。UIランタイムなし(素のTSアイランド)。
  依存は `astro` + `@supabase/supabase-js` のみ(+開発用型チェッカー)。
- 公開データはビルド時取得: `src/lib/publicData.ts` が
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` があれば Supabase から、
  なければ `data/sample/*.json` から読む(サンプル時は画面に注意書き表示)。
- 案件ステータス(cases.status): `rumored / commented / announced / completed / withdrawn / dormant`
  ラベル・記号・トーンは `src/lib/status.ts` に集約。
- 検索・絞り込みはトップページの行 data-* 属性 + クライアントJS(外部リクエストなし)。
- ログイン機能は `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` 未設定なら非表示。
- 管理画面 /admin は静的シェル + supabase-js。管理者判定は `is_admin()` RPC、
  書き込み権限はすべて RLS で判定。Deploy Hook URL は `admin_settings` に保存。
- 価格は numeric(固定小数点)、証券コードは text。
- `[hidden] { display:none !important }` を global.css に定義済み
  (display 指定を持つ要素の hidden 属性対策)。

## 検証方法

```bash
npm run build   # サンプルデータで静的ビルド
npm run check   # astro check(型チェック)
npm run preview # ローカル確認
```
