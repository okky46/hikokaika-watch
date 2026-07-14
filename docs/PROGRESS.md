# 実装進捗

実装中断からの再開用メモ。完了したものから ✅ を付ける。

## 状態: 実装中

| # | 項目 | 状態 |
|---|---|---|
| 1 | プロジェクト基盤(Astro, tsconfig, env, docs) | 🔄 |
| 2 | Supabase マイグレーション(スキーマ + RLS) | ⬜ |
| 3 | データ層(types / publicData / サンプルデータ) | ⬜ |
| 4 | 公開ページ(トップ・一覧・詳細・免責・プライバシー) | ⬜ |
| 5 | ログイン機能(お気に入り・関心度・メモ・mypage) | ⬜ |
| 6 | 管理画面(/admin) | ⬜ |
| 7 | ビルド検証・仕上げ・PR | ⬜ |

## 設計上の決定事項(再開時に必ず読む)

- フレームワーク: **Astro 静的出力のみ**。UIランタイムなし(素のTSアイランド)。
  依存は `astro` + `@supabase/supabase-js` のみ。
- 公開データはビルド時取得: `src/lib/publicData.ts` が
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` があれば Supabase から、
  なければ `data/sample/*.json` から読む。
- 案件ステータス(cases.status): `rumored / commented / announced / completed / withdrawn / dormant`
  ラベル・集計は `src/lib/status.ts` に集約。
- 検索・絞り込みはトップページ埋め込みJSON + クライアントJS(外部リクエストなし)。
- ログイン機能は `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` 未設定なら非表示。
- 管理画面は静的シェル + supabase-js。書き込み権限はすべて RLS の `is_admin()` で判定。
- Deploy Hook URL は `admin_settings` テーブル(管理者のみRLSで読める)に保存。
- 価格は numeric(固定小数点)、証券コードは text。

## 再開手順

1. `git log --oneline` で最後のコミットを確認
2. この表の 🔄 / ⬜ を確認
3. `npm run build` が通るか確認してから続きを実装
