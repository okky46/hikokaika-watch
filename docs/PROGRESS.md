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

## 2026-07-15 改修

- 会社コメントの複数タグ・自動分類・管理画面UIを追加。
- 案件ステータスに `denied` / `ended` を追加し、トップ画面を簡素化して主要チップ絞り込みを追加。
- Supabase MFA の aal2 昇格フローを管理画面ログイン時に追加。
- `DATA_SOURCE` 明示によるフェイルクローズ型ビルドへ変更。
- メモをDB/UI双方で1,000文字に制限。
- `revision_history` と監査トリガーを追加。
- GitHub Actions CI と Node.js 標準テストを追加。

## フェーズ1: 派生値の導出と表示刷新(2026-07-15)

DB変更なし。派生値はDB/JSONに永続化せず、`src/lib/derive.ts`(新規・純関数)で
ビルド時に計算し `src/lib/publicData.ts` がビューモデルに合成する方式で実装した。

- `reportCount` / `commentCount` / `heatLevel` / `speculationPremium` / `tobPremium` /
  `arbSpread` / `daysSinceFirstReport` / `effectiveStatus`(dormant判定含む) /
  `isPreAnnouncement` を `CaseListItem`(`CaseDetail`が継承)に追加。DBの `status` は書き換えない。
- トップページを「発表前(観測報道段階)」「発表後(アーカイブ)」の2テーブルに分割。
  発表前は heatLevel 降順→最終更新日降順、発表後は最終更新日降順。
  発表前テーブルに報道回数・コメントスタンス・思惑プレミアム・経過日数を追加。
  発表後テーブルにTOBプレミアム・裁定スプレッドを追加し、arbSpread が負の行をハイライト。
- 案件詳細ページにステータスファネル(`StatusFunnel.astro`・新規)を追加。クライアントJSなし。
- 色システムを再設計: 発表前=暖色ヒートスケール(`--heat-1〜4-*`)、
  発表後=寒色固定(`--post-announced/completed/withdrawn-*`)、
  分岐系(denied/ended/dormant)は`--pre-denied-*` / `--pre-dormant-*`。
  **既存の `--tone-*` 変数と `badge--{watch|comment|announce|done|stop|pause}` クラスは
  admin画面(`src/pages/admin/index.astro`)が直接参照しているため削除せず維持し、
  公開ページ専用の新トーン(`publicStatusTone()` / `badge--heat-N` 等)を別途追加する形にした。**
  この判断はユーザーに確認済み(admin画面は今回変更対象外のため)。
- サンプルデータに証券コードが英字を含む案件(`130A` heat-3 / `245B` dormant / `912C` arbSpread負)を追加。
- `tests/derive.test.mjs`(新規)で heatLevel・effectiveStatus・各プレミアムの境界値を検証。
  Node.js 22 のネイティブTS実行(`node --test`)を利用し、`src/lib/derive.ts` を直接importしてテストする。

## フェーズ2: スキーマ小拡張と可視化強化(2026-07-16)

DB変更は `supabase/migrations/0003_price_event_enums.sql` 1本のみで、`price_type` の `daily_close` と
`event_type` の `large_shareholding_report` 追加だけに限定した。

- `daily_close` 時系列を読み込み、案件に1件以上あれば最新の `daily_close` を現在株価として使い、無ければ従来の `current_close` を使うルールを `src/lib/publicData.ts` に明記して実装。
- 純関数 `renderSparkline(input): string` を `src/lib/sparkline.ts` に追加し、詳細ページと一覧にビルド時生成SVGを表示。色はCSS変数参照のみ。
- 大量保有報告イベントを `EVENT_TYPE` に追加し、管理画面のメタデータ入力欄とタイムライン表示を追加。
- 企業単位ページ `/companies/[code]/` を追加し、案件詳細の社名・コードからリンク、sitemapにも企業URLを追加。
- 案件別メモはテーブル変更なしで既存 `body` に v1 JSON文字列を保存。旧プレーンテキストは `freeText` として読み込む。
- サンプルデータに `daily_close` 時系列と大量保有報告イベントを追加し、英字入り証券コードを文字列のまま扱う検証対象にした。
- `tests/sparkline.test.mjs` を追加し、SVG・CSS変数色・欠損スキップを検証。

## フェーズ3: 広告収益化とアクセス統計(2026-07-16)

DB変更なし。広告タグとアクセス統計は環境変数未設定時に公開HTMLへ出力しない方針で実装した。

- `AdSlot.astro` を AdSense 対応にし、`PUBLIC_ADSENSE_CLIENT` 未設定時は何も出力しない。広告ラベル「広告」は維持。
- 広告枠はトップの発表前/発表後セクション間、案件詳細タイムラインの3イベントごと(上限2枠)だけに移設し、仕様外の既存枠を撤去。
- `Base.astro` に `PUBLIC_CF_ANALYTICS_TOKEN` がある場合だけ Cloudflare Web Analytics ビーコンを出力する条件分岐を追加。
- `/admin` に「アクセス統計」タブを追加し、`functions/api/analytics.ts` の Pages Function 経由で Cloudflare GraphQL Analytics API から直近7日/30日とURL別PVを取得する構成にした。APIトークンは `CF_ANALYTICS_API_TOKEN` としてサーバー側にのみ置く。
- `public/ads.txt` のプレースホルダ、プライバシーポリシーの広告/Cookie/Cloudflare Web Analytics説明、`.env.example` と `docs/SETUP.md` の新規環境変数・審査手順を追加。

## フェーズ4: 株価取得の自動化(2026-07-17)

DB変更なし。GitHub Actions から平日16:30 JST に公開中の進行案件の終値を取得する方式で実装した。

- `scripts/fetch_prices/` に、取得元を `sources.py` の `fetch_close()` へ分離したPythonバッチを追加。yfinanceで `security_code` を常に文字列として `f"{security_code}.T"` に連結し、調整前終値を `Decimal` の小数2桁で扱う。
- 対象は可視の `rumored` / `commented` / `denied` / `announced`。JST日付で日次終値を取得し、価格がない休場日・取得失敗はログしてスキップする。
- `price_snapshots` に一意制約がない既存設計に揃え、`case_id × daily_close × price_date` をselectして既存行はupdate、なければinsertする。管理画面の重複防止と公開読み込み時の重複正規化を維持し、migrationは追加していない。
- `.github/workflows/fetch-prices.yml` にcronと手動実行を追加し、固定concurrency groupで重複実行は後続を待機させる。insert/updateが1件以上の場合だけDeploy Hookを呼ぶ。dry-runはDB書き込み・Deploy Hookを行わず、接続情報なしでは英字入り証券コード`130A`を使うローカル検証モードになる。
- `docs/SETUP.md` と `.env.example` に必要なGitHub Secrets、yfinanceの利用条件、ローカルdry-run手順を追記。
