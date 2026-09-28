## 2026-09-29: 公開内容の事実確認・訂正

- 管理者の「真偽確認して更新」の依頼で、公開10銘柄・23出来事・2記事の記述と出典を再照合。確認対象は公表・報道の存在と掲載文の整合であり、噂の実現や全報道の網羅を保証しない。
- 電通総研の旧4出来事を訂正。日経の誤リンクを実記事へ修正、選択2026年1月号の根拠未確認の日時を削除、株探の長文転載を要約、会社回答の「開示すべき情報なし」と「決定事実なし」の混同を修正。元ID・初回掲載日時を保持し、公開訂正履歴を付けた。
- 電通総研の8月31日訂正開示を会社公表の英訳PDFで確認し1件追加。保留していたイーソルは会社回答PDFを取得できたため追加し、8月28日回答・9月1日JPX指定・9月11日訂正開示の3件を登録。記事は増やさず、11銘柄・27出来事・2記事となった。
- main `99fe1b1` の本番再ビルド `9d8a1ae0-300c-451d-889a-711cbc138ba4` が06:21 JSTに成功。114テスト、型チェックエラー・警告0、DB履歴6件の照合、32ページ生成を確認。追加・訂正したページを本番で照合した。
- 公開確認で、日付不明の先行記事がある場合の「最初の観測報道」というラベルが不正確だと分かったため、詳細・会社ページを「日付を確認できた最初の報道」に最小修正。ブランチ `codex-factcheck-publication`。フォント・認証・メモ・RLS・SQL・DNSの変更なし。ラベルの本番反映は別途確認する。
- 管理者向け照合記録はチャット成果物 `outputs/research-2026-09-29/factcheck-update.md`。ニッコンの有料原文・旧5月情報、未完了案件の成立・上場廃止は未確認という限定を維持。追加手作業なし。
- ラベル変更後も型チェック（エラー・警告0、既存ヒント3）、114テスト、サンプル31ページのビルドが成功。最初のローカル実行は環境変数の指定漏れで停止し、`ASTRO_TELEMETRY_DISABLED=1` とビルドの `DEPLOY_ENV=test DATA_SOURCE=sample` を明示して再実行した。

## 2026-09-29: 初回掲載と公開後照合が完了

- 管理者の掲載承認に基づき、新規8銘柄、既存2銘柄の更新、出来事19件、公式資料に基づく記事2本を管理画面から登録・公開。現在の公開対象は10銘柄、出来事23件（既存4件を含む）、記事2本。
- 未登録会社6件を追加し、既存会社を再利用。既存の案件ID・URL・初回掲載日時を維持した。噂だけの銘柄から記事は作成していない。
- PR #14をCI・Cloudflareプレビュー成功後にマージ。main `9b15f27` の本番公開後、管理画面のDeploy Hookを実行。最終確認したデプロイは `7a0efe57-e312-4401-85dd-bfa204825502`（05:56 JSTのビルド）。114テスト、DB履歴6件の照合、30ページ生成が成功。
- 初回の公開照合で出来事3件の不足と不要な訂正表示2件を発見し、入力・分類を補正して再公開。最終的に全10銘柄の出来事の件数・見出し・説明・日付・出典URLを承認原稿とブラウザー上で照合。全19件が正しい銘柄に表示されることを確認した。
- 記事2本の本文・出典・関連銘柄リンクと、管理画面の「公開反映済み」を確認。フォントCSS・Googleログイン・メモのコード・RLS・DNSは変更なし。
- 原資料未取得の1候補、既存1件の出典訂正は引き続き保留。予定日の到来だけでTOB・上場廃止を完了扱いにしない。次は未確認資料の照合と調査対象の拡充。
- 今回、管理者の追加手作業は不要。更新用鍵の期限（2026-12-28）は従来どおり。

## 2026-09-29: 初回掲載の実行準備

- 管理者が新規8銘柄・既存2銘柄の追記・公式資料に基づく2記事の公開を承認。保留候補は掲載しない。
- 指定された本人アカウントへの管理者権限追加を個別に承認・実施し、管理画面の管理者確認済み表示を確認。既存RLS・認証方式は変更なし。
- 日付だけ確認できる出来事に架空の時刻を表示しないため、入力欄と公開表示に日付のみの指定を追加。既存metadataを使用し、追加SQLなし。PR #8の精度列がある場合も同期する。
- 型チェックはエラー・警告0（既存ヒント3）、114テストとサンプル31ページ生成が成功。本番反映と掲載確認はこれから。

# 実装進捗

## 2026-09-29: 候補拡充の初回調査（内容は未公開）

- 対象期間2025-09-29〜2026-09-29で月別・会社別に探索。新規候補9件（うち1件は出典本文の追加確認待ち）、既存2案件の更新案、公表資料に基づく記事下書き2件を作成した。初回の代表例であり網羅調査の完了ではない。
- 管理者向け成果物は作業チャットの `outputs/research-2026-09-29/` に保存。`review.md` / `review.html`、銘柄案 `candidates-review.json`、記事JSON2件、`research-log.md`。未承認の銘柄別原稿を公開リポジトリへ保存しない。
- 記事JSONは現行の取込・公開用パーサーで形式検証。コード・日付・銘柄重複も確認。これは内容の正しさや本番への登録成功を保証する検証ではない。
- **本番DBへの保存・公開・サイト再ビルドは未実施。** フォント、認証、メモ、DNS、SQLの変更なし。
- 次は管理者による掲載内容の確認。承認後に直近開示を再確認し、既存コード/案件を照合して登録・公開・再ビルド・反映確認する。保留の資料と既存出典の訂正は、確認が取れてから別途反映する。

## 2026-09-29: 本番公開・DB自動更新の有効化完了

- 管理者の明示承認を受け、PR #10→#11の順にマージ。本番ビルドコマンドを `npm run build:cloudflare` に変更。
- 初回はCloudflareのNode.js 22.16でTypeScriptテストが起動できず、DB更新前に停止。PR #12で `--experimental-strip-types` を明示し、CIも22.16.0に揃えた。CIとプレビュー成功後にマージ。
- main `02899e4` / Cloudflare `f431acdc-ef4a-43bc-b15d-2f7c9031e524` は04:46 JSTに本番公開成功。112テスト成功 → 実DB定義・保護設定の照合 → 更新履歴6件確認 → 12ページ生成 → 公開成功をログで確認。既存SQLの再実行なし。
- 管理者によるGoogleログインを確認し、全体メモ・案件別メモ・お気に入りを本番で保存・再読み込み・元の内容へ復元。既存の銘柄URL、記事一覧、フォント指定、canonicalの本番ドメインも確認。
- 残る定期作業は更新用鍵の期限前更新（期限2026-12-28）。通常のSQL更新では管理者の手貼りは不要。[運用手順](AUTO_DEPLOY.md)。
- 以下は各時点の履歴。未マージ・未設定の記述は上記完了記録を優先する。

## 2026-09-29: DB適用後の確認・以後の更新を自動化

- 管理者提供CSVで0007・0008の追加テーブル・列・関数と、メモ・お気に入りの本人限定RLSを確認。0007・0008の再実行は不要。実ログイン・関数定義全文の照合はこのCSVだけでは未確認。
- 自動化はPR #10から分離した `codex-supabase-deploy` ブランチ。Cloudflareの既存公開処理に、検証 → DB更新 → ビルドを組み込む。DNS・Auth設定・フォントは変更しない。
- 初回は0008までの実DB定義を照合して履歴を引き継ぎ、既存SQLは再実行しない。以後は新SQLのみ。失敗時ロールバック、適用済みSQLの改変検出、メモRLS・認証関数の前後検査を追加。
- 型チェックはエラー・警告0（既存ヒント3）。112テスト、新しいビルド経路で31ページの生成、静的成果物検査に成功。自動更新7テストには既存DB採用、再実行、全体ロールバック、MFA維持、権限解除拒否、秘密非出力、公開順序を含む。
- PR [#11](https://github.com/okky46/hikokaika-watch/pull/11) のコードコミット `2671436` はGitHub CI・Cloudflareプレビュー成功。
- 管理者承認に基づき、対象プロジェクト限定・Database Read-write・90日有効のトークンを発行し、Cloudflare Productionの `SUPABASE_DEPLOY_TOKEN` に暗号化保存済み。期限2026-12-28。Previewに未登録であること、既存接続先との一致を確認。秘密値はリポジトリに保存しない。
- 本番はまだPR #9時点。PR #10・#11未マージ、ビルドコマンドは従来の `npm run build`。実DBへの自動更新は未実行。**自動化の有効化は未完了**。[初回だけの設定手順](AUTO_DEPLOY.md)。次はマージの了承を確認してから10→11の順で取り込み、ビルドコマンド変更・本番デプロイ・動作確認を行う。

## 2026-09-29: 敵対的レビューの入力検証差を修正

- 追加SQL `0008_article_validation.sql` で出典URL・Unicode空白・UTF-16文字数の検証を強化。0007や既存の認証・メモRLSは変更しない。
- 記事の出典URLは通常のASCIIドメインとIPアドレスを共通の対応範囲とし、国際化ドメインは管理画面とDBの双方で対象外。日本語の出典名・URLパスは使用可。
- 既存公開記事の不正データがあればslugを示して移行を停止し、変更をロールバックする。データの自動削除・自動修正はしない。
- PR #8の3構成で0008の適用・再実行・不正入力の拒否・公開モデル生成・RLSを検証。URL境界504通りについてDB許可→公開ビルド受入を照合。
- **マージ前は0007 → 0008の順で適用。0007適用済みなら0008のみ追加。** 本番には未適用。[手動手順](MANUAL_DEPLOY_2026_09.md)を更新済み。

## 2026-09-29: PR #10 自己レビューの2点を修正

- 報道の有無によらず、銘柄詳細の検索・共有向け説明を「追跡開始から現在までの経過」に変更。
- 出典欄の形式を維持し、`|`・バックスラッシュ・改行をエスケープ。JSON取込、既存記事の読込、再保存で元の文字を維持する。
- 型チェック、105テスト、サンプルビルドと生成物検査が成功。出典の往復変換と説明文を回帰検査に追加。
- 追加DB変更はなし。PR #10の0007適用手順は従来どおり。本番未反映。

## 2026-09-29: 追跡DB・独立記事のコード改修（本番未反映）

- 作業ブランチ `codex-rumor-tracking-articles`。PR #9マージ後のmainがベース。
- レビュー用PR: [#10](https://github.com/okky46/hikokaika-watch/pull/10)。マージ前に手動反映手順のDB確認・0007適用を行う。
- PR #8をそのままマージしない方針をユーザー確認済み。0005/0006の本番適用状況は不明。新SQL 0007は3状態のローカルDBで互換性を検証。
- 一覧を追跡理由・現在の状況・最新出来事中心に整理。報道なし銘柄も表示し、第0報とチャートを撤去。株探・Yahooリンクを追加。
- 記事一覧/詳細、複数会社の関連記事、下書き・公開版分離、明示承認、取込・プレビュー・公開反映確認を追加。
- フォント指定と既存認証・メモ保存先・本人限定RLSを維持。株価cronのみ停止、ニュース収集は維持。
- 型チェック、Node 103テスト、ニュース収集33テスト、静的ビルド、下書き漏れ検査、PC/モバイル、ローカルDBにつないだ記事管理操作を確認。詳細は [検証記録](VERIFICATION_2026_09.md)。
- **本番DB・Cloudflare・DNS・OAuthは未変更。** 次は [手動反映手順](MANUAL_DEPLOY_2026_09.md)。DB確認 → 0007 → マージ/デプロイ → 本番確認の順。
- 実銘柄の候補拡充は未実施。[調査手順とJSON形式](RESEARCH_WORKFLOW.md)を用意。サンプルを本番へインポートしない。

## 2026-09-29: 改修方針の文書化（PR #9時点の記録）

- 今回の基準は [UPDATE_PLAN_2026_09.md](UPDATE_PLAN_2026_09.md)。下記のMVP完了・旧フェーズ履歴とは区別する。
- 現在のフォントは変更禁止。Googleログイン・本人専用メモ・RLS・お気に入り・本番URLを維持する。
- 追加指示により既存メモ等の内容の消失は許容されるが、機能維持は必須。不要な削除はしない。
- 噂段階の銘柄を記事なしで公開し、記事は独立して複数銘柄に関連付ける。
- チャートは当面非表示、株探へのリンクを優先。OpenAI API・X連携は導入しない。
- **実施済みは文書化のみ。サイトコード、フォントCSS、本番DB、DNS、OAuth、Actionsの設定は未変更。**
- 次の作業: 手順書の段階1（現状・フォント・認証・DB適用状況の確認）。未マージPR #8との重複も確認する。


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

## フェーズ5: 情報収集パイプライン(2026-07-18)

DB変更は `supabase/migrations/0004_inbox.sql` 1本のみで、`inbox_items` の作成と管理者用RLSだけに限定した。既存テーブル・既存ポリシー・公開ページのデータ取得には触れていない。

- `scripts/collect/` に TDnet 系API、EDINET API、Google News RSS の3ソース収集バッチを追加。PostgREST は `requests` で直叩きし、`--dry-run` ではSupabase書き込みとDiscord通知をスキップする。
- 3ソースは順番に独立 `try/except` で実行し、1ソースの失敗が他ソースを止めない構造をユニットテストで確認した。
- URL正規化SHA-256の `dedup_key` とDB unique制約、同一証券コード・タイトル先頭30文字一致のアプリ側チェックで重複候補を抑止する。
- Discord Webhook 通知を追加。通知失敗はログのみでジョブ成功扱いにする。
- 管理画面に「収集候補」タブを追加し、pending 候補から新規案件フォーム、イベントフォームへのプリフィル、破棄を行えるようにした。自動掲載はしない。
- `.env.example`、`docs/SETUP.md`、`docs/ARCHITECTURE.md` に新規Secrets、外部API利用上の注意、収集→inbox→人間承認→掲載の構成を追記した。

### Phase 5 external collection production settings (updated 2026-07-21)

TDnet collection uses Yanoshin TDnet WEB-API by default because it provides unauthenticated JSON/json2 endpoints suitable for this project. `TDNET_API_BASE_URL` is a base path, not a complete fetch URL, unless it already ends in `.json` or `.json2`; the collector builds `/{YYYYmmdd}.json2?limit=300` by default. Yanoshin is an unofficial TDnet-derived service, so operators should confirm its latest terms and switch `TDNET_API_BASE_URL` if a contracted JPX/J-Quants feed is adopted.

EDINET collection uses the official EDINET API v2 endpoint `https://api.edinet-fsa.go.jp/api/v2/documents.json` with `date`, `type=2`, and the `Subscription-Key` request parameter. `EDINET_API_KEY` is required to enable EDINET; when unset, only EDINET is skipped and other sources continue. EDINET inbox URLs intentionally use the official public viewer entry `https://disclosure2.edinet-fsa.go.jp/` rather than API download URLs, and `docID` is preserved under raw metadata.

Manual Supabase tasks: apply `supabase/migrations/0004_inbox.sql` and verify the `inbox_items` table and RLS policies in the dashboard. Codex must not apply this to production.

GitHub Repository Secrets to register manually: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EDINET_API_KEY` (if EDINET enabled), `DISCORD_WEBHOOK_URL` (optional notification). GitHub Repository Variables to register manually: `TDNET_API_BASE_URL`, `TDNET_API_FORMAT`, `TDNET_API_LIMIT`, `EDINET_API_BASE_URL`, `EDINET_VIEWER_URL`, `ADMIN_URL`. Do not put secret values in Variables or logs.
