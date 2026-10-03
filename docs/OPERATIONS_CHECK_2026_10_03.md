# 保存機能・Access・復旧手段の確認（2026-10-03）

## 本番と今回の作業

GitHubのmainは `aa831879df5d26028488331724853c7425cbc5da`。PR #33のナビ整理・依頼ページとPR #35の双方向試算・0013は本番反映済み。開始時のProductionは `2607bec2-5c54-4fdc-8487-ead6a35db468`、16:41:46 JSTに公開されていた。公開結果の文書PR #34・#36は未マージで、未反映の機能として数えない。

今回は本人メモとお気に入りを実操作で確認し、Pagesの別URLにAccess制限を追加した。同じmainを再公開し、Production `90b13b56-04d8-40bd-9973-24d17929223a` が17:35:58 JSTに成功した。ログで146テスト成功・0失敗、型検査0エラー・0警告、DB更新履歴11件を確認。サイトコード・SQL・財務データ・公開記事は変更していない。ニュース収集とDiscord通知の停止方針を維持した。

元作業コピーの未コミット変更と他チャットのworktreeを保持し、最新mainから `codex-residual-followup` を作成した。今回の文書はこのブランチへ記録する。GitHub PR #36のマージ開始は、明示的なマージ承認がないとの理由で自動承認レビューに拒否された。マージは実行していない。

## 本人メモとお気に入り

本番Googleログイン済みの本人アカウントで、開始時に全体メモ・案件メモ・お気に入りが空であることを確認した。全体メモの保存・再読込・編集、案件 `9072-001` の検討内容・目標株価・撤退条件・再確認日・本文の保存と再読込、お気に入りの追加と強さ3を確認した。

ログアウト後は本人向け内容が表示されず、Googleで再ログインすると保存内容とお気に入りが保持されていた。案件メモ本文の編集・再保存も確認した。最後に既存フォームで各メモ欄を空に戻して保存し、お気に入りを解除。再読込後の空欄と登録解除、マイページのメモなし・お気に入りなしを確認した。空の保存行は物理削除していない。別ユーザーからの本番RLS確認は未実施。

## Cloudflare Access

開始時の「非公開化ウォッチ管理画面」は `hikokaika.com/admin`、`hikokaika.com/admin/*`、`hikokaika.com/api/analytics` の3宛先。既存の管理者限定ポリシーはメール2件、セッション24時間、MFAはオフだった。`hikokaika-watch.pages.dev/admin/` はAccessへ転送されず、Supabaseのログイン前画面を表示した。この観測は管理者操作やDB読取が認可なしで可能という意味ではない。

既存アプリへの別URLの追加だけでは転送を確認できなかったため、その追加6宛先は外し、既存3宛先を保持した。Pages設定の「プレビューを制限」から生成したアプリに、`hikokaika-watch.pages.dev` と `*.hikokaika-watch.pages.dev` を設定した。許可には既存の「管理者本人のみ許可」ポリシーを使い、生成された「Allow Members - Cloudflare Pages」の関連付けを外した。既存の許可メールは変更していない。

生成アプリは `57ad713c-5fba-409a-928b-0377a07c6847`。別URLでは公開ページも含めてAccessの対象になる。通常の公開URL `https://hikokaika.com/` は引き続き閲覧でき、同URLの管理画面でも管理者確認済みのセッションを維持した。

設定と再公開後、次のURLでCloudflare Accessのログイン画面への転送を確認した。Pages用のログインコードは送信していないため、そのアプリでの許可利用者の認証完了は未確認。

| 対象 | 確認結果 |
|---|---|
| `hikokaika-watch.pages.dev/admin/` | Accessログインへ転送 |
| `hikokaika-watch.pages.dev/api/analytics` | Accessログインへ転送 |
| 新しい本番別URL `90b13b56.hikokaika-watch.pages.dev/admin/` | Accessログインへ転送 |
| 既存プレビュー `0b2cec01.hikokaika-watch.pages.dev/admin/` | Accessログインへ転送 |

全過去デプロイURLを列挙した監査はしていない。手順の根拠は[Cloudflare公式のPages Access案内](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)。設定保存だけで完了とせず、各URLの転送まで確認する。

## MFAとバックアップの残作業

本番管理画面の本人アカウントはTOTP未登録。Cloudflareの管理画面用Accessアプリと管理者限定ポリシーではMFAがオフで、アカウント側もMFA未有効との表示だった。既存のGoogleアカウント自体のMFA設定は今回確認していない。

MFAは、まず管理者本人の端末へTOTPを登録し、再ログインでコード入力と管理者操作を確認する。その後にDBのaal2必須化を判断する。登録前に必須化すると管理者が締め出されるため、[SETUPのMFA復旧手順](SETUP.md#supabase-mfa-aal2-運用と復旧)と代替のログイン手段を確認してから進める。今回TOTP発行や必須化はしていない。

SupabaseのBackups画面でFreeプランにはプロジェクトバックアップが含まれないとの表示を確認した。外部で保存されたバックアップの有無は未確認で、復元も未実施。DB自動更新履歴はバックアップの代わりにならない。

無料での次の手順は、本人メモと認証情報を含む保存先・閲覧権限を決め、[公式CLIのバックアップ・復元手順](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)に従ってロール・スキーマ・データを取得し、隔離した検証DBへ復元する。既存の接続手段を確認し、取得のためだけに本番DBパスワードを変更しない。件数・既存ID・RPC・RLS・MFAの定義と、認証設定の復旧手順を照合する。実データを公開Git・チャット画像へ保存しない。

Supabaseの[バックアップ案内](https://supabase.com/docs/guides/platform/backups)はFreeプランにCLIの定期エクスポートと外部保存を推奨している。DBバックアップにはStorageの実ファイルが含まれないため、Storageを使用している場合は別に保全する。取得と隔離環境での復元を確認するまで、復旧手段が完成したとは扱わない。課金や本番への復元は今回行っていない。

## 次に進める順序

実在銘柄の財務・過去TOB事例は未登録。原資料・単位・基準日・公開利用条件を確認し、下書き保存・再読込・公開承認・本番反映を進める。無料取得と公開再配信の許諾は分けて確認する。MFA登録とバックアップ保存先の確定、別利用者の本番RLS確認も残る。

保留資料と過去12か月の探索は継続課題。DB更新鍵は記録上2026-12-28、統計読取鍵は2027-10-03までに更新する。広告と実銘柄の濃淡設定は任意。今回の確認画像はローカルの `outputs/memo-restored-20261003.jpg` と `outputs/pages-access-protected-20261003.jpg` に保存し、Gitへ含めない。
