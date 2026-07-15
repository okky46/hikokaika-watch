# 非公開化ウォッチ 実装指示書（実装AI向け）

対象リポジトリ: `okky46/hikokaika-watch`（PR #1 マージ済みの main を起点とする）

## A. このファイルの使い方（最初に読むこと）

- この指示書が**唯一の仕様書**である。ここに書かれていないことは実装しない。
- 実装は**フェーズ単位**で行う。ユーザーから「フェーズNを実装せよ」と指示された範囲だけを実装し、**次のフェーズの先回り実装は禁止**。
- 各フェーズには「変更してよいファイル」「実装仕様」「禁止事項」「完了チェックリスト」がある。チェックリストを全て満たしてからフェーズ完了を報告する。
- 仕様に曖昧さ・矛盾・技術的に不可能な点を見つけたら、**勝手に解釈して実装せず、作業を止めてユーザーに質問する**。
- 完了報告には「変更ファイル一覧」と「チェックリストとの対照」を含める。

## B. サイトの目的（すべての実装判断の基準）

このサイトは「非公開化・MBO・TOBの**観測報道（リーク）が出たが、まだ正式発表されていない銘柄**の思惑を、案件単位で時系列に整理する公開データベース」である。

- **主役は発表前の案件。** 発表後（TOB発表済み）の案件も扱うが、アーカイブ・答え合わせ用という従の位置付け。
- 入札案件などでは正式発表まで観測報道が第1報、第2報、第3報…と繰り返し出る。**報道の回数が増えるほど案件は「アツく」なる。** この温度感の可視化がUIの核。
- 投資助言サービスではない。売買推奨・主観的評価は載せない。載せるのは客観的事実（報道・開示・株価）と、そこからの機械的計算値のみ。

## C. 絶対ルール（全フェーズ共通・違反は差し戻し）

### 必ず守ること
1. 公開ページの閲覧では Supabase に一切アクセスしない。公開データはビルド時に静的化し Cloudflare Pages から配信する。Supabase に接続するのは「ログインユーザーの操作（認証・お気に入り・メモ）」「管理画面」「GitHub Actions のバッチ」のみ。
2. すべて無料枠で完結させる（Supabase Free / Cloudflare Free / GitHub Actions 無料枠）。
3. 派生値（第N報カウント、heatLevel、プレミアム率、経過日数、dormant判定）は **DBに保存せず**、`src/lib/publicData.ts` のビルド時に計算してビューモデルに持たせる。
4. 状態の表示は色だけに依存しない。**必ず記号（マーク）と数字・ラベルを併記**する。
5. 証券コードは**4桁の英数字**である（例: `130A`, `285A`, `7203`）。数字のみを前提としたパース・数値型キャスト・ゼロ埋めを一切行わない。常に文字列として扱う。DBの `security_code` は text 型を維持。
6. 外部データ取得（株価・TDnet・EDINET・ニュース）は関数として分離し、取得元を差し替え可能にする。
7. 取得失敗はログを出してスキップし、次回cronに任せる。
8. コミットメッセージは日本語で書く。
9. 各フェーズ完了時に `docs/PROGRESS.md` を更新する。新規の環境変数・Secretsは `.env.example` と `docs/SETUP.md` に追記する。
10. サンプルデータ（`data/sample/`）は新機能を網羅するよう拡充し、**環境変数なしで `npm run build` が通る状態を常に維持**する。

### 禁止事項
- 既存テーブルの再設計・リネーム・カラム削除。スキーマ変更は「enum値の追加」「新テーブルの追加」「metadata JSONB の活用」のみ許可。
- 適用済みマイグレーションファイル（`0001_*.sql`, `0002_*.sql`）の編集。変更は新しい番号のファイルで行う。
- 指示にない依存パッケージの追加。各フェーズで許可されたもの以外は追加しない。
- 指示範囲外のリファクタリング・ファイル移動・命名変更・整形。動いているコードは触らない。
- リトライ機構・キュー・死活監視などの堅牢化の作り込み。
- 自動収集した情報の自動掲載。必ず管理者承認を経由する。
- クライアントサイドのチャートライブラリ（Chart.js 等)の導入。チャートはビルド時SVG生成のみ。

---

# フェーズ1: 派生値の導出と表示刷新

**DB変更: なし（migrationを作ってはいけない）**

### 変更してよいファイル
- `src/lib/types.ts`（ビューモデルへのフィールド追加のみ。Raw* 型は変更禁止）
- `src/lib/publicData.ts`
- `src/lib/status.ts`
- 新規: `src/lib/derive.ts`（派生値の計算ロジック。純関数として実装）
- `src/components/StatusBadge.astro`、新規: `src/components/StatusFunnel.astro`
- `src/pages/index.astro`、`src/pages/cases/[slug].astro`
- `src/styles/global.css`
- `data/sample/*.json`（テスト用データ追加）
- 新規: `tests/derive.test.mjs`

## 1-1. 派生値の計算（`src/lib/derive.ts` に純関数で実装）

`CaseListItem` と `CaseDetail` に以下のフィールドを追加する。すべて可視イベント（`is_visible = true`）とロード済み価格から計算する。

```ts
// types.ts に追加するフィールド（CaseListItem に追加。CaseDetail は継承）
reportCount: number;          // observation_report + follow_up_report の件数（= 現在が第何報か）
commentCount: number;         // company_comment + timely_disclosure の件数
heatLevel: 1 | 2 | 3 | 4;    // 下記の式で計算
speculationPremium: number | null;  // (現在値 - 報道前終値) / 報道前終値
tobPremium: number | null;          // (TOB価格 - 報道前終値) / 報道前終値
arbSpread: number | null;           // (TOB価格 - 現在値) / 現在値
daysSinceFirstReport: number | null; // 最初の観測報道から今日までの日数
effectiveStatus: CaseStatus;         // 表示用ステータス（下記）
isPreAnnouncement: boolean;          // effectiveStatus が rumored/commented/denied/ended/dormant なら true
```

計算式（この通りに実装する。独自の改良をしない）:

```
heatLevel:
  base = min(max(reportCount, 1), 4)
  最終可視イベントの occurred_at から今日まで 90日以上経過していれば base = max(base - 1, 1)
  heatLevel = base

speculationPremium:
  preReportClose と currentClose が両方あるときのみ (current - pre) / pre、なければ null

tobPremium:
  status が announced/completed/withdrawn かつ formalOfferPrice と preReportClose があるとき (offer - pre) / pre、なければ null

arbSpread:
  status が announced のとき、formalOfferPrice と currentClose があれば (offer - current) / current、なければ null
  （completed/withdrawn は null でよい）

effectiveStatus:
  DBの status が rumored / commented / denied のいずれか、かつ
  最終可視イベントの occurred_at から今日まで 240日以上経過している場合 → 'dormant'
  それ以外 → DBの status をそのまま返す
  ※ DBの status カラムは絶対に書き換えない。表示レイヤーのみの判定。
```

「今日」はビルド時の日時（既存の `generatedAt` と同一時刻）を使う。日数計算は日単位の切り捨て。

## 1-2. トップページ: 発表前／発表後のセクション分割

- 案件一覧を2つのセクションに分ける。**発表前セクションが上**。
  - 発表前: `effectiveStatus` が `rumored` / `commented` / `denied` / `ended` / `dormant`
  - 発表後: `announced` / `completed` / `withdrawn`
- 発表前セクションのデフォルトソート: **heatLevel 降順 → lastUpdatedAt 降順**。
- 発表後セクションのデフォルトソート: lastUpdatedAt 降順（現状踏襲）。
- 発表前テーブルに追加するカラム:
  1. 報道回数 —「◇3」形式（マーク＋数字）。ツールチップ等で「第3報」
  2. コメントスタンス — 最新の company_comment / timely_disclosure イベントの `comment_stance` をバッジ表示（PR #1 の `COMMENT_STANCE_LABELS` を使用）。コメントイベントが無い案件は「—」
  3. 思惑プレミアム — `speculationPremium` を「+38.2%」形式（小数1桁）。正は暖色文字、負は寒色文字。null は「—」
  4. 経過日数 — `daysSinceFirstReport`（「45日」形式）
- 発表後テーブルに追加するカラム: TOBプレミアム（同書式）、裁定スプレッド。**arbSpread が負（現在値 > TOB価格）の行は行背景をハイライト**し、セルに「▲上振れ」の注記を付ける（価格引き上げ・対抗TOB期待のシグナルであるため）。
- 既存のフィルタ機能（会社名検索・ステータス・媒体・年・正式発表・お気に入り・関心度）はすべて維持し、両セクションに対して機能させる。フィルタのクライアントJSは既存実装の方式を踏襲する。

## 1-3. 色システムの再設計（`global.css`）

設計思想: **発表前 = 暖色系（報道回数で熱くなる）、発表後 = 寒色系（固定）**。発表前と発表後で同系統の色を使わない。

以下のCSS変数をこの値のまま追加する:

```css
/* 発表前: 暖色ヒートスケール（heatLevel 1〜4） */
--heat-1-bg: #fff4e0; --heat-1-fg: #a05e00; --heat-1-line: #f0dcae;
--heat-2-bg: #ffe3c2; --heat-2-fg: #b34700; --heat-2-line: #f0c894;
--heat-3-bg: #ffd0a0; --heat-3-fg: #c23a00; --heat-3-line: #edb37a;
--heat-4-bg: #ffc4b8; --heat-4-fg: #b91c1c; --heat-4-line: #eda396;

/* 発表前の分岐系 */
--pre-denied-bg: #e3e8ef; --pre-denied-fg: #475569; --pre-denied-line: #c7d0dc;
--pre-dormant-bg: #ededed; --pre-dormant-fg: #6b7280; --pre-dormant-line: #d4d4d4;

/* 発表後: 寒色系（固定） */
--post-announced-bg: #dbeafe; --post-announced-fg: #1d4ed8; --post-announced-line: #b6ccf5;
--post-completed-bg: #d1f0e0; --post-completed-fg: #065f46; --post-completed-line: #a8ddc2;
--post-withdrawn-bg: #e9e4f5; --post-withdrawn-fg: #5b4ea8; --post-withdrawn-line: #cfc6e8;
```

バッジの割り当てルール:
- `rumored` / `commented`: heatLevel に応じた `--heat-N-*` を使用。表示は「◇ 観測 第3報」／「◆ コメントあり（2回目）」のようにフェーズ＋回数。commented でもヒート色は reportCount 基準（コメントは熱を上下させない）。◇と◆のマークで区別する。
- `denied`: `--pre-denied-*`、マーク「×」、ラベル「会社が明確に否定」（急冷の青灰）。
- `ended` / `dormant`: `--pre-dormant-*`、マーク「□」。
- `announced` / `completed` / `withdrawn`: `--post-*` の固定色。マークは既存（●■✕）を維持。
- 旧 `--tone-*` 変数は新変数への置き換えが完了したら削除する。ただしバッジのHTML構造（mark span + label）は変更しない。
- イベントタイプバッジ（タイムライン内）は既存の配色調整のみでよい。観測系イベントは heat-1、コメント系は heat-1 と同明度の別暖色、発表系は post-announced に寄せる。

## 1-4. ステータスファネル（`StatusFunnel.astro`・案件詳細ページ）

詳細ページのヘッダー直下に横並びの進捗表示を追加する。ビルド時に静的HTMLで出力し、クライアントJSは使わない。

```
◇ 観測(第3報) → ◆ 会社コメント(2回) → ● 正式発表 → ■ 成立・完了
```

- 本線は4ステップ固定: 観測 → 会社コメント → 正式発表 → 成立・完了。
- 通過済み: 塗り（該当ステップの色）。現在地: 塗り＋太枠＋太字で最も強調。未到達: 淡グレー。
- 観測ステップには reportCount、コメントステップには commentCount を括弧書きで表示（0回のステップは回数表示なし）。
- 分岐系の案件（denied / ended / withdrawn / dormant）は、本線の該当位置の下に「↳ × 会社が明確に否定」のような分岐行を1行追加して現在地とする（denied/ended/dormant は会社コメントの下、withdrawn は正式発表の下）。
- モバイル幅（375px）で横スクロールまたは折り返しで崩れないこと。

## 1-5. フェーズ1 禁止事項

- migration ファイルの作成
- Raw* 型・DBスキーマ・管理画面の変更
- 依存パッケージの追加
- 派生値をJSONファイルやDBへ永続化すること

## 1-6. フェーズ1 完了チェックリスト

- [ ] `data/sample/` に「observation_report 1件 + follow_up_report 2件（=第3報）」の発表前案件を追加し、heat-3 の色・「◇3」表示・ファネルの回数表示が確認できる
- [ ] `data/sample/` に「最終イベントから240日以上前」の rumored 案件を追加し、一覧で dormant 表示になる（DBのstatusは rumored のまま）
- [ ] 発表後セクションに arbSpread が負になる announced 案件をサンプルで用意し、ハイライトが確認できる
- [ ] `npm run build` が環境変数なしで成功する
- [ ] `npm run check`（astro check）が通る
- [ ] `npm test` が通る（`tests/derive.test.mjs` で heatLevel・effectiveStatus・各プレミアムの境界値をテスト: reportCount=0/1/4/5、90日冷却、240日判定、価格欠損時の null）
- [ ] 全バッジに記号＋数字/ラベルが併記されている（色を消しても状態が判別できる）

---

# フェーズ2: スキーマ小拡張と可視化強化

**DB変更: migration 1本のみ（`supabase/migrations/0003_price_event_enums.sql`）**

### 変更してよいファイル
- 新規: `supabase/migrations/0003_price_event_enums.sql`
- `src/lib/types.ts`、`src/lib/status.ts`、`src/lib/publicData.ts`
- 新規: `src/lib/sparkline.ts`、`tests/sparkline.test.mjs`
- 新規: `src/pages/companies/[code].astro`
- `src/pages/index.astro`、`src/pages/cases/[slug].astro`、`src/pages/mypage.astro`
- `src/pages/admin/index.astro`（イベント種別の選択肢追加と大量保有メタデータ入力欄のみ）
- `data/sample/*.json`

## 2-1. migration の内容（この2つだけ）

1. `price_type` に `daily_close` を追加
2. `event_type` に `large_shareholding_report` を追加

既存の値・テーブル・RLSは一切変更しない。

## 2-2. `daily_close` と `current_close` の関係

- `daily_close` は日次終値の時系列（1案件×1日につき1行）。
- ビルド時ルール: **その案件に daily_close が1件以上あれば、最新の daily_close を「現在株価」として使う。無ければ従来どおり手動登録の current_close を使う。** このルールを `publicData.ts` にコメントで明記する。

## 2-3. SVGスパークライン（`src/lib/sparkline.ts`）

- 純関数 `renderSparkline(input): string`（SVG文字列を返す）として実装し、ユニットテストを付ける。
- 入力: `{ points: {date: string, price: number}[], markers: {date: string, kind: 'report'|'comment'|'announce'}[], offerPrice?: number, width: number, height: number }`
- 仕様:
  - 折れ線1本。欠損日はスキップして線を繋ぐ（補間しない）
  - markers の日付位置に縦線。kind別の色: report=`var(--heat-3-fg)`、comment=`var(--heat-1-fg)`、announce=`var(--post-announced-fg)`
  - offerPrice があれば水平点線
  - 色は必ずCSS変数参照で出力（ハードコード禁止）
  - `<title>` 要素で代替テキストを含める（アクセシビリティ）
- 配置:
  - 詳細ページ: 幅いっぱい（height 120px 目安）。株価情報セクション内
  - 一覧: 各行に 100×24px。daily_close が2点未満の案件は出力しない（空セル）

## 2-4. 大量保有報告イベント

- `EVENT_TYPE` に追加: ラベル「大量保有報告」、マーク「▲」、トーンは暖色系（発表前の強シグナルであるため）。
- **発表前・発表後どちらの案件にも登録できる。発表後限定にしない。**
- `metadata` JSONB の格納形式（管理画面の入力欄もこの項目で作る）:
  ```json
  { "holder_name": "○○投資組合", "ratio": 5.12, "previous_ratio": null, "filing_date": "2026-07-10", "change_type": "new" }
  ```
  `change_type` は `new` | `increase` | `decrease` | `exit` の4値。
- タイムラインのイベントカードで holder_name と ratio（「保有 5.12%」）を強調表示する。

## 2-5. 企業単位ページ `/companies/[code]/`

- **現状このページは存在しない。新規作成である。**（`companies` テーブルは既存）
- パスパラメータは `security_code`（英数字。ルール C-5 を厳守）。
- 内容: 企業基本情報（コード・社名・市場・業種）＋ その企業の**全案件一覧**（過去案件含む、時系列降順、各案件のステータスバッジ付き）。目的は「一度終息した後に再度観測が出る（再燃）」ケースを束ねること。
- 案件が1件しかない企業のページも生成する（将来の再燃に備えURLを固定するため）。
- 案件詳細ページのヘッダーの社名部分から企業ページへリンクを張る。
- SEO: title/description を既存ページの流儀に合わせる。sitemap に追加する。

## 2-6. 個人メモの構造化テンプレート

- `user_notes` テーブルは**変更しない**。既存の text カラムに以下のJSON文字列で保存する:
  ```json
  { "v": 1, "scenario": "", "targetPrice": "", "exitCondition": "", "nextCheckDate": "2026-08-01", "freeText": "" }
  ```
- 読み込み時に `JSON.parse` が失敗した場合（既存の自由記述メモ）は、全文を `freeText` として扱い、保存時にJSON形式へ移行する。**既存メモを壊さないこと。**
- UI（詳細ページのメモ欄＋マイページ）: 「想定シナリオ」「目標価格」「撤退条件」「次のチェック日（date input）」「自由メモ」の5項目。
- マイページに「次のチェック日」昇順ソートを追加し、期日到来（今日以前）の案件を上部で強調する。

## 2-7. フェーズ2 完了チェックリスト

- [ ] migration が1本のみで、enum追加以外の変更を含まない
- [ ] サンプルデータに daily_close 時系列（20点程度）と large_shareholding_report イベントを追加し、スパークライン・マーカー・イベントカードが表示される
- [ ] daily_close がある案件で「現在株価」が最新 daily_close になる／無い案件で current_close が使われる
- [ ] `/companies/[code]/` がサンプルの全企業分生成され、sitemap に含まれる
- [ ] 旧形式（プレーンテキスト）のメモが壊れず表示・再保存できる
- [ ] `npm run build` / `npm run check` / `npm test` が通る（sparkline のテスト含む）

---

# フェーズ3: 広告収益化とアクセス統計

**DB変更: なし**

### 変更してよいファイル
- `src/components/AdSlot.astro`、`src/layouts/Base.astro`
- `src/pages/index.astro`、`src/pages/cases/[slug].astro`、`src/pages/privacy.astro`、`src/pages/admin/index.astro`
- 新規: `public/ads.txt`（プレースホルダ）、`functions/api/analytics.ts`（Cloudflare Pages Function）
- `.env.example`、`docs/SETUP.md`

## 3-1. Google AdSense

- `AdSlot.astro` を AdSense 対応にする。環境変数 `PUBLIC_ADSENSE_CLIENT`（ca-pub-…）が未設定なら**何も出力しない**（現在のプレースホルダ動作は環境変数があるときのみ開発表示）。
- スロット配置は次の2箇所のみ:
  1. トップ: 発表前セクションと発表後セクションの間
  2. 案件詳細: タイムラインのイベント3件ごとに1枠、**上限2枠**
- **禁止: 発表前案件のテーブル内部・バッジ近傍への広告配置。** 思惑情報と広告が視覚的に混ざるとサイトの信頼を毀損する。
- `public/ads.txt` を追加（中身はSETUP.mdに記載する手順でユーザーが差し替える）。
- `privacy.astro` にパーソナライズ広告・Cookie・第三者配信に関する節を追加。
- `docs/SETUP.md` に追記: 「AdSense審査はサンプルデータ状態では通らない。実案件データを数十件投入し、免責・プライバシーポリシー・問い合わせ導線を整えてから申請する」。

## 3-2. Cloudflare Web Analytics + 管理ダッシュボード

- `Base.astro` に Cloudflare Web Analytics のビーコンを追加。トークンは `PUBLIC_CF_ANALYTICS_TOKEN`、未設定なら出力しない。Cookieレスのため同意バナーは不要。
- `/admin` に「アクセス統計」タブを追加:
  - Cloudflare GraphQL Analytics API から「直近7日/30日のPV・訪問数」「URL別PVランキング上位20（=案件別注目度）」を取得して表示。
  - **APIトークンをクライアントに埋め込むことは禁止。** `functions/api/analytics.ts`（Cloudflare Pages Function、Cloudflare Access の保護配下に置く）で中継し、トークンは Pages の環境変数（サーバー側）に置く。
  - Pages Function の実装が環境要因で難しい場合は、作業を止めてユーザーに相談する（勝手に代替実装へ切り替えない）。

## 3-3. フェーズ3 完了チェックリスト

- [ ] 環境変数なしのビルドで広告・アナリティクスのタグが一切出力されない
- [ ] 環境変数を設定したビルドで、指定2箇所（＋詳細ページ上限2枠）にのみスロットが出る
- [ ] privacy ページに広告関連の記載が追加されている
- [ ] `/admin` のアクセス統計タブが Function 経由でデータ表示する（トークンがクライアントに露出しない）

---

# フェーズ4: 株価取得の自動化

**DB変更: なし**

### 変更してよいファイル
- 新規: `scripts/fetch_prices/`（Python。`fetch_prices.py` + `sources.py` + `requirements.txt`）
- 新規: `.github/workflows/fetch-prices.yml`
- `docs/SETUP.md`、`.env.example`

## 4-1. 仕様

- GitHub Actions cron: `30 7 * * 1-5`（UTC。= 平日 16:30 JST）。`workflow_dispatch` も付ける。
- 処理フロー:
  1. Supabase から対象案件を取得: `cases.is_visible = true` かつ status が `rumored / commented / denied / announced` の案件と、その企業の `security_code`
  2. `sources.py` の `fetch_close(security_code: str, date) -> Decimal | None` で当日終値を取得。第一実装は yfinance（ティッカーは `f"{security_code}.T"`。**コードは文字列のまま連結。** 例: `130A.T`）
  3. `price_snapshots` に `daily_close` として upsert（case_id × price_type × price_date で一意。既存行は上書き）
  4. 1件以上更新があった場合のみ、Cloudflare Pages の Deploy Hook（Secret: `CLOUDFLARE_DEPLOY_HOOK_URL`）を POST
- Supabase への書き込みは `SUPABASE_SERVICE_ROLE_KEY`（GitHub Secrets）。**このキーはワークフローとFunctions以外のどこにも書かない。**
- 取得失敗銘柄は標準出力にログしてスキップ。リトライ禁止（ルール C-7）。
- **取得元の差し替えは `sources.py` の関数1つの差し替えで済む構造にする**（将来、証券会社APIへ移行するため）。

## 4-2. フェーズ4 完了チェックリスト

- [ ] ワークフローが cron + workflow_dispatch で定義されている
- [ ] ローカルで `python scripts/fetch_prices/fetch_prices.py --dry-run` が動作する（dry-run オプションを実装し、Supabase書き込みとDeploy Hookをスキップしてログのみ出す）
- [ ] 英字入りコード（`130A` 等）がエラーなく処理される（dry-runのテストケースに含める）
- [ ] 必要な Secrets が `docs/SETUP.md` に列挙されている

---

# フェーズ5: 情報収集パイプライン（TDnet / EDINET / ニュース + Discord通知 + 承認フロー）

**DB変更: migration 1本のみ（`supabase/migrations/0004_inbox.sql`）**

### 変更してよいファイル
- 新規: `supabase/migrations/0004_inbox.sql`
- 新規: `scripts/collect/`（Python。`collect.py` + `sources/tdnet.py` + `sources/edinet.py` + `sources/news.py` + `notify_discord.py` + `queries.json` + `requirements.txt`）
- 新規: `.github/workflows/collect.yml`
- `src/pages/admin/index.astro`（「収集候補」タブの追加）
- `src/lib/types.ts`（inbox の型追加）
- `docs/SETUP.md`、`.env.example`、`docs/ARCHITECTURE.md`

## 5-1. inbox テーブル（migration はこの定義に従う）

```sql
create table inbox_items (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('tdnet','edinet','news')),
  title text not null,
  url text not null,
  published_at timestamptz,
  security_code text,                          -- 推定証券コード（4桁英数字・null許容）
  matched_case_id uuid references cases(id),
  suggested_event_type text,
  suggested_comment_tags text[],
  raw jsonb,
  dedup_key text unique not null,              -- sha256(正規化URL)
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
```

- RLS: 匿名・一般ログインユーザーは読み書き不可。管理者（既存 `admin_users` の仕組み）と service_role のみアクセス可。**公開ページはこのテーブルを一切参照しない。**

## 5-2. 収集ジョブ（`.github/workflows/collect.yml`）

- cron 2本: `0 23 * * 0-4`（= 平日 8:00 JST）と `0 3,10 * * 1-5`（= 平日 12:00 / 19:00 JST）。`workflow_dispatch` 付き。
- `collect.py` が3ソースを**順番に、それぞれ独立の try/except で**実行する。1ソースの失敗が他を止めないこと。

**ソース1: TDnet（`sources/tdnet.py`・最優先）**
- 開示タイトルを以下の正規表現でフィルタ:
  ```
  一部報道|本日の(一部)?報道|報道に関する|非公開化|マネジメント・バイアウト|ＭＢＯ|MBO|公開買付|株式併合|株式の非公開化|買収提案
  ```
- 背景知識: 観測報道が出ると対象企業は当日〜翌営業日に「本日の一部報道について」等のほぼ定型タイトルで適時開示を出す。これが最も確実な検知手段であり、**会社コメントは必ずこの経路でDBに入れる運用**になる。開示には証券コードが付随するため企業紐付けも確実。
- TDnetに公式APIはない。非公式のTDnet系Web API（例: やのしん適時開示API）を第一候補とし、取得部分は関数分離してソース変更に耐える構造にする。利用するAPIのURL・利用条件は実装時に確認し、`docs/SETUP.md` に記載する。
- `suggested_event_type` の推定ルール（単純な文字列マッチでよい）:
  - タイトルに「一部報道」「報道に関する」→ `company_comment`
  - 「公開買付けの開始」「公開買付開始」→ `formal_announcement`
  - 「公開買付けの結果」→ `tender_offer_result`
  - 「買付条件」+「変更」→ `price_revision`
  - それ以外 → `timely_disclosure`
- company_comment と推定した場合、タイトル・本文冒頭から PR #1 の COMMENT_TAGS に対応する `suggested_comment_tags` を推定する（例: 「決定した事実はありません」→ `no_decision`、「当社が発表したものではありません」→ `not_company_announcement`。マッチしなければ空配列）。

**ソース2: EDINET（`sources/edinet.py`）**
- EDINET API（公式・無料）で大量保有報告書・変更報告書の提出を監視。
- ウォッチ中案件（5-2 冒頭で取得する進行中 cases の security_code 集合）に合致するものだけを inbox に入れる。`suggested_event_type = 'large_shareholding_report'`。提出者名・保有割合を raw から抽出し、フェーズ2の metadata 形式のドラフトを `raw.metadata_draft` に入れる。

**ソース3: Google News RSS（`sources/news.py`）**
- `https://news.google.com/rss/search?q=<URLエンコード済みクエリ>&hl=ja&gl=JP&ceid=JP:ja` を巡回。**個別メディア（株探・日経・Bloomberg等）の直接スクレイピングは規約リスクのため禁止。**
- クエリは `scripts/collect/queries.json` に外出しし、コード変更なしで追加・修正できるようにする。初期値:
  ```json
  ["非公開化 検討", "非公開化を検討", "MBO 検討", "TOB 観測", "買収提案 受領",
   "非公開化 関係者", "マージャーマーケット",
   "site:kabutan.jp 非公開化", "site:kabutan.jp MBO"]
  ```
  （「マージャーマーケット」は Mergermarket のリークを日本語媒体が社名込みで報じる際の高精度クエリ）
- タイトル・スニペットから証券コードの抽出を試みる。正規表現は `[0-9][0-9A-Z]{3}`（社名との併記文脈で使う。単独の4桁数値の誤検知に注意し、「（1234）」「＜1234＞」「(130A)」のような括弧付きパターンを優先）。抽出できなければ `security_code = null` でよい（承認時に人間が紐付ける）。

**共通処理（`collect.py`）**
- 重複排除: `dedup_key = sha256(正規化URL)`（クエリパラメータ除去・小文字化）。unique 制約違反は既出としてスキップ。加えて、同一 security_code でタイトルの類似度が高い（先頭30文字一致で足りる）ものは二重登録しない。
- 案件マッチ: security_code が取れた場合、進行中の案件（effectiveStatus 相当ではなく、DBの status が rumored/commented/denied/announced）と突合して `matched_case_id` を設定。

## 5-3. Discord 通知（`notify_discord.py`）

- cron 実行の最後に、その回で新規 insert された inbox_items をまとめて Discord Webhook（Secret: `DISCORD_WEBHOOK_URL`）へ embed 形式で POST する。
- embed 1件につき: タイトル / ソース種別 / 媒体または提出者 / URL / 推定証券コード / 既存案件マッチの有無 / 管理画面URLへのリンク。
- embed の色分け（この値を使う）:
  - 既存ウォッチ中案件の続報: 赤 `0xE74C3C`（最もアツい）
  - 完全新規の銘柄: 青 `0x3498DB`
  - 大量保有報告: 黄 `0xF1C40F`
- 通知失敗はログのみでジョブ自体は成功扱い。

## 5-4. 管理画面: 「収集候補」タブ

- `/admin` に pending の inbox_items を新着順で一覧表示。
- 各候補のアクション（3つ）:
  1. **新規案件として起票** — 会社選択（無ければ新規作成）＋ケース作成フォームへ候補内容をプリフィル
  2. **既存案件のイベントとして追加** — `matched_case_id` があれば案件をプリセット。イベントフォームに `suggested_event_type` / `suggested_comment_tags` / metadata ドラフトをプリフィル
  3. **破棄** — status = 'rejected'、reviewed_at 記録
- 承認・起票は既存の管理フロー（監査ログ等）に乗せ、完了後は既存の再ビルド導線（Deploy Hook）と同じ挙動にする。
- **自動掲載は実装しない**（ルール C 禁止事項）。

## 5-5. フェーズ5 完了チェックリスト

- [ ] migration が inbox_items の作成とRLSのみで、既存テーブルに触れていない
- [ ] 3ソースのうち1つを例外で落としても他の2つが動く（テストで確認）
- [ ] 重複URLの二重登録がunique制約で防がれる
- [ ] `--dry-run` で Supabase 書き込み・Discord 通知をスキップしてログ出力のみできる
- [ ] 英字入り証券コード（130A等）の抽出・照合テストがある
- [ ] 管理画面から「新規起票」「イベント追加」「破棄」の3操作が完結する
- [ ] 公開ページのビルドが inbox_items に依存していない

---

# 将来構想（実装禁止・ただし妨げる設計もしない）

以下はMVPの対象外。**実装してはならない**が、将来の追加を不可能にする変更もしないこと。

- ベースレート統計ページ（媒体別の観測報道的中率、コメントスタンス別の帰結、報道→発表までの日数分布）。必要なデータ（初報媒体・comment_stance・イベント日付）はフェーズ1〜5で自然に蓄積される。
- 証券会社API（kabuステーションAPI等）への株価取得差し替え（フェーズ4の `sources.py` 分離で対応済み）。
- 課金機能。
