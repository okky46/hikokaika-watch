# マイグレーション適用順

ファイル番号順に適用する。

PR1を新規適用する環境では `0005_case_event_classification.sql`、続けて
`0006_pr1_review_fixes.sql` を実行する。旧版の `0005` を適用済みの環境では、
修正版 `0005` を再実行せず `0006` だけを実行する。

`0006` は、重複初報の安全な降格、制約・互換トリガー・要確認経路・タグ監査の
修正版を冪等に適用する。適用後の要確認データは service role から
`case_event_migration_review` を参照するか、管理者として
`admin_case_event_migration_review()` を呼び出して確認する。一般ユーザーには
ビューの権限を付与しない。
