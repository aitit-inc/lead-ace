---
name: check-results
description: "This skill should be used when the user asks to \"返信を確認して\", \"反応をチェックして\", \"結果を見て\", \"メールの返事があるか確認して\", or wants to check outbound outreach responses. メールの返信やSNSの反応を自動チェックしDBに記録する。"
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__claude_ai_Gmail__search_threads
  - mcp__claude_ai_Gmail__get_thread
  - mcp__claude_in_chrome__tabs_context_mcp
  - mcp__claude_in_chrome__tabs_create_mcp
  - mcp__claude_in_chrome__navigate
  - mcp__claude_in_chrome__read_page
  - mcp__claude_in_chrome__get_page_text
  - mcp__claude_ai_Gmail__create_draft
---

# Check Results - 結果収集

アウトバウンド営業の反応を自動チェックし、データベースに記録するスキル。

**前提:** `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` の規約に従うこと（data.dbの配置・cdしないルール）。

## 実行手順

### 0. Preflight チェック

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

`status` が `error` の場合はエラーメッセージを表示して**即座に中断**する。`migrations_applied` にマイグレーションがあればユーザーに報告する。

### 1. 準備

- プロジェクトディレクトリ名: `$0`（必須）

`$0/SALES_STRATEGY.md` を読み込み、「反応の定義」セクションから以下を把握する:
- 何を「反応」とみなすか
- 使用中の日程調整サービスと通知元メールアドレス
- その他の反応シグナル

### 2. 直近のアプローチ情報を取得

直近4営業日以内に送信したアプローチのメタデータを取得する（本文は不要）:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db recent-outreach "$0"
```

### 3. 受信メールの確認

Gmail MCPを使い、以下の検索を行う:

**3a. 直接返信の検索**

各アプローチ済み営業先について、送信先メールアドレスの**ドメイン**で検索する（同じ組織の別の人から返信が来るケースに対応）:

1. `mcp__claude_ai_Gmail__search_threads` で `from:@<domain> newer_than:4d` を検索
2. ヒットがあれば `mcp__claude_ai_Gmail__get_thread` で内容を確認
3. 内容がアプローチに対する反応かどうかを判定する

**3b. 日程調整通知の検索**

SALES_STRATEGY.mdに日程調整サービスが記載されている場合、その通知元アドレスからのメールを検索する:

1. `mcp__claude_ai_Gmail__search_threads` で `from:<通知元アドレス> newer_than:1d` を検索
2. ヒットがあれば内容を読み、通知本文に含まれる名前・メールアドレス・組織名をアプローチ済みリストと突き合わせる

**3c. バウンスメールの検索**

送信失敗（宛先不明、ドメイン不在等）を検出する:

1. `mcp__claude_ai_Gmail__search_threads` で `from:mailer-daemon OR from:postmaster newer_than:4d` を検索
2. ヒットがあれば `mcp__claude_ai_Gmail__get_thread` で内容を確認
3. バウンスしたメールアドレスをアプローチ済みリストと照合し、該当する営業先を特定する

**3d. 突き合わせ（マッチング）**

受信メールをアプローチ済み営業先と紐づける。以下の優先順位で照合する:
1. **送信先アドレス完全一致**: 送った相手からの直接返信
2. **ドメイン一致**: 同じ組織の別の人からの返信（例: `contact@co.jp` に送信 → `tanaka@co.jp` から受信）
3. **組織名一致**: メール本文や送信者名にアプローチ済み営業先の `name` が含まれる（グループ会社や法人事務局からの返信に対応）
4. **日程調整通知**: 通知メール本文にアプローチ済み営業先の名前またはメールアドレスが含まれる

マッチの確信度が低い場合はレポートに「要確認」と記載し、ユーザーの判断に委ねる。

### 4. SNS反応の確認

**前提チェック:** ステップ2の `recent-outreach` 結果に SNS チャネル（`sns_twitter` / `sns_linkedin`）のアプローチが**1件もない場合、このステップ全体をスキップ**する。

SNSでDMを送った営業先について、claude-in-chromeで返信を確認する。対象プラットフォーム: **X（Twitter）** および **LinkedIn**。

**X（Twitter）の場合:**
1. X のDM画面（https://x.com/messages）を開く
2. アプローチ済みの相手からの返信を確認
3. 返信があれば内容を取得

**LinkedIn の場合:**
1. LinkedIn のメッセージ画面（https://www.linkedin.com/messaging/）を開く
2. アプローチ済みの相手からの返信を確認
3. 返信があれば内容を取得

**ブラウザ拡張が未接続の場合:** SNS確認はスキップするが、SNS経由でアプローチした営業先のうち未確認の件数をカウントしておく。結果レポート（ステップ5）で「**未確認SNS DM: N件**」として必ず報告する。

### 5. データベース更新

反応があった場合、`record_response.py` で返信記録・ステータス更新・送付NG設定を1コマンドでアトミックに実行する。**同一 outreach_log_id + response_type の重複記録は自動スキップされる**ので、既に記録済みかどうかの事前チェック SQL は不要（スクリプトに任せてよい）:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/record_response.py data.db \
  --project "$0" --prospect-id <prospect_id> \
  --outreach-log-id <outreach_id> --channel <channel> \
  --content "<返信内容>" \
  --sentiment <positive|neutral|negative> \
  --response-type <type> \
  [--new-status <responded|rejected|inactive>] \
  [--do-not-contact --dnc-reason "送付NG: <理由の要約>"]
```

反応に応じて `--new-status` を指定する:
- ポジティブな返信 → `--new-status responded`
- ミーティング依頼/日程調整完了通知 → `--new-status responded`
- 明確な拒否 → `--new-status rejected`
- バウンス → `--new-status inactive`
- 自動返信のみ → `--new-status` を省略（`contacted` のまま）

**response_type の種別:**
`reply` / `auto_reply` / `bounce` / `meeting_request` / `scheduling_confirmation` / `rejection` 等

**送付NGの判定**: 返信内容に「今後の連絡は不要」「配信停止」「連絡しないでください」等のオプトアウトの意思が含まれている場合、`--do-not-contact --dnc-reason "送付NG: <理由>"` を追加する。これは全プロジェクト共通で適用される。

単にこのプロジェクトの提案を断っただけ（「今回は見送ります」等）の場合は `--new-status rejected` のみで、`--do-not-contact` は付けない。

> **注意:** DB への直接 SQL 実行は禁止。返信記録は必ず `record_response.py` 経由で行うこと。

### 6. 返信ドラフト作成

ステップ5でポジティブな返信（`responded`）を記録した営業先がある場合、Gmail MCPを使って返信ドラフトを自動作成する。

**対象:** sentiment が positive または neutral で、response_type が `reply` または `meeting_request` の返信のみ。バウンス・自動返信・拒否は対象外。

**ドラフト作成手順:**

1. `$0/SALES_STRATEGY.md` の「送信者情報」「メッセージング」セクションを参照する
2. 返信内容に応じて適切なドラフトを作成する:
   - **ポジティブな返信（興味あり）** → 御礼 + 日程調整リンク or 日程候補3つ提示
   - **資料請求** → 御礼 + 資料送付の旨（※資料自体の添付はドラフト後にユーザーが行う）
   - **質問・問い合わせ** → 質問への回答案 + 次のステップ提案
   - **日程調整完了通知** → 確認の御礼 + 当日の案内
3. `mcp__claude_ai_Gmail__create_draft` でドラフトを作成する。件名は元メールへの返信形式（`Re: {元の件名}`）にする
4. 作成したドラフト数を結果レポートに含める

**注意:** 自動送信は行わない。ドラフト作成のみで、送信はユーザーが内容を確認してから手動で行う。ドラフトが作成できなかった場合（Gmail MCP未接続等）はスキップし、レポートで報告する。

### 7. 結果レポート

以下を報告する:
- チェックした営業先数
- 反応があった営業先数と内訳（ポジティブ/ニュートラル/ネガティブ）
- 反応率（反応数 / アプローチ数）
- 反応の種別内訳（直接返信 / 日程調整完了 / 等）
- マッチ確度が低い反応があれば「要確認」として一覧表示
- **未確認SNS DM: N件**（SNS確認がスキップされた場合。0件でも明示する）
- **作成した返信ドラフト: N件**（ステップ6で作成した数。0件でも明示する。ドラフトがある場合は Gmail の下書きを確認するよう案内する）
- 注目すべき返信の要約
- 次のステップとして `/evaluate` の実行を案内する

レポートをプロジェクトディレクトリに `RESULTS_REPORT.md` として保存する（追記モード）。

**追記フォーマット:** 各回の結果を `---` セパレータと日付ヘッダで区切る:

```markdown
---
## YYYY-MM-DD HH:MM
（上記レポート内容）
```

**ローテーション:** 追記前にファイルの行数を確認し、500行を超えている場合は古い方から半分を削除してから追記する。
