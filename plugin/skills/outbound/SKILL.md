---
name: outbound
description: "This skill should be used when the user asks to \"メールを送って\", \"営業をかけて\", \"アプローチして\", \"営業先に連絡して\", \"アウトバウンドを実行して\", or wants to execute outbound sales. 営業リストの営業先に対してメール送付・フォーム入力・SNS DMを自動で行う。件数指定も可能。"
argument-hint: "<project-directory-name> [件数]"
allowed-tools:
  - Bash
  - Read
  - Write
  # SNS DM 用（ログインセッションが必要なため claude-in-chrome を使用）
  - mcp__claude_in_chrome__tabs_context_mcp
  - mcp__claude_in_chrome__tabs_create_mcp
  - mcp__claude_in_chrome__navigate
  - mcp__claude_in_chrome__read_page
  - mcp__claude_in_chrome__get_page_text
  - mcp__claude_in_chrome__form_input
  - mcp__claude_in_chrome__computer
---

# Outbound - アウトバウンド営業実行

営業リストの営業先に対して、メール・問い合わせフォーム・SNS DMで順次アプローチするスキル。

各営業先について、利用可能なチャネルでメッセージを送信し、送信結果をDBに記録する。全件処理後に結果をまとめてレポートする。

**前提:** `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` の規約に従うこと（data.dbの配置・cdしないルール）。

## 実行手順

### 0. Preflight チェック

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

`status` が `error` の場合はエラーメッセージを表示して**即座に中断**する。`migrations_applied` にマイグレーションがあればユーザーに報告する。

### 1. 準備

- プロジェクトディレクトリ名: `$0`（必須）
- アプローチ件数: `$1`（省略時: 30）

`$0/BUSINESS.md` と `$0/SALES_STRATEGY.md` を読み込み、以下のセクションを特に注意して把握する:
- **アウトリーチモード**: `precision`（深いパーソナライズ）か `volume`（テンプレベースのセミパーソナライズ）か。未設定なら `precision`
- **営業チャネル**: チャネルの優先順位、使わないチャネル
- **メッセージング**: 件名パターン、本文の構成方針、A/Bテストの指示があればそれに従う
- **送信者情報**: 送信元メールアドレス、署名
- **メールテンプレート**: テンプレートが定義されている場合はベースとして使用する（volume モードでは特に重要）
- **SNSメッセージ**: SNS DM用のメッセージ方針

**重要:** SALES_STRATEGY.md に件名パターンのバリエーション・A/Bテスト等の具体的な指示がある場合、それに必ず従うこと。指示を無視してデフォルト動作に戻ってはならない。
**注意:** 送信タイミング（曜日・時間帯）はこのスキルでは制御しない。

未アプローチの営業先リストをDBから取得する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db list-reachable "$0" "$1"
```

件数の指定がない場合はデフォルトの30件を対象とする。

### 2. 各営業先へのアプローチ

SALES_STRATEGY.mdの「営業チャネル」セクションに記載されたチャネルと優先順位に従う。使わないチャネルが指定されている場合はスキップする。

「営業チャネル」セクションに特に制限がない場合のデフォルト優先順位:

1. **メール** — メールアドレスがある場合
2. **問い合わせフォーム** — フォームURLがある場合
3. **SNS DM** — SNSアカウントがある場合（X/Twitter のみ対応。相手のDM設定により送信不可の場合あり）

1つの営業先につき、利用可能なチャネル全てでアプローチする必要はない。最も効果的な1チャネルで十分。

**1社あたりの試行上限:** 1社に対する送信試行は**最大2回**（メインチャネル + フォールバック1回）とする。2回失敗したら理由を問わず即スキップし、次の営業先に進む。1社に長時間かけてコンテキストとツールコールを浪費してはならない。

**SNS DMの注意:** SNS DM は到達率が低い（相手のDM開放設定に依存）。SALES_STRATEGY.mdの「営業チャネル」セクションで優先順位が指定されている場合はそれに従う。SNSが無効化されている場合はスキップする。

**ブラウザツールが利用できない場合:** playwright-cli が未インストールの場合はフォーム入力不可、claude-in-chrome が未接続の場合は SNS DM 不可。メールアドレスがある営業先のみを対象とし、該当チャネル不可の営業先はスキップする。スキップした件数は結果レポートで「ブラウザ未接続によりスキップ: N件」として報告する。

### 3. メール送信

`references/email-guidelines.md` のガイドラインに従ってメールを作成する。SALES_STRATEGY.mdの「送信者情報」セクションから送信元メールアドレスと署名を取得する。

**件名のバリエーション:** SALES_STRATEGY.md に件名パターンが複数定義されている場合、営業先ごとに異なるパターンを使い分けること。全件同じ件名にしてはならない。A/Bテスト指示がある場合はパターンを均等に配分する。

**本文の個別化（アウトリーチモードに応じて深さを変える）:**

- **precision モード**: 各営業先の `overview` と `match_reason` を参照し、冒頭だけでなく本文全体を相手に合わせて書く。相手企業の具体的な数値・実績・取り組みに言及し、テンプレートの単純な差し替えにしない。「貴社のウェブサイトを拝見し」等の汎用的な書き出しだけでは不十分
- **volume モード**: SALES_STRATEGY.md のメールテンプレートをベースに、冒頭（なぜ連絡したか）と課題提起の2箇所を `overview` / `match_reason` に基づいて営業先ごとに調整する。解決策〜CTA はテンプレートの構成をそのまま使ってよい

`send_and_log.py` でメール送信+ログ記録+ステータス更新を一括で行う:

```bash
echo "<本文（署名含む）>" > /tmp/email_body.txt
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
  --project "$0" \
  --prospect-id <prospect_id> \
  --account "<送信元メールアドレス>" \
  --to "<宛先>" \
  --subject "<件名>" \
  --body-file /tmp/email_body.txt
```

本文が短い場合は `--body-file` の代わりに `--body "<本文>"` も可。

**スクリプトの動作:**
- メールを送信し、結果をDBに記録する（送信+ログ+ステータス更新がアトミック）
- 成功時: outreach_logs (status='sent') に記録し、project_prospects を 'contacted' に更新
- 失敗時: outreach_logs (status='failed', error_message) に記録。ステータスは 'new' のまま維持
- 出力: `{"status": "sent"|"failed", "outreach_log_id": N, "error_message": null|"..."}`

**注意:**
- **メール送信は必ず `send_and_log.py` 経由で行うこと。** gog コマンドを直接叩かない（DBにログが残らなくなるため）
- `--body` / `--body-file` に渡す本文は署名を含めた完全な内容にする
- Gmail MCP（`gmail_create_draft`）はドラフト作成のみで送信不可
- 送信元エイリアスを指定する場合は `--from "<エイリアス>"` を追加

### 4. 問い合わせフォーム入力

`references/playwright-guide.md` と `references/form-filling.md` を読み込んで、その手順に従う。

`form_type` フィールドに応じて処理方法を分岐する:

| form_type | 処理 |
|---|---|
| `google_forms` | `references/form-filling.md` の「Google Forms の場合」に従い、`formResponse` POST で送信（ブラウザ不要） |
| `native_html` / `wordpress_cf7` / null | playwright-cli でブラウザ操作。`references/form-filling.md` の基本フローに従う |
| `iframe_embed` | スキップ。`status = 'failed'`, `error_message = 'iframe埋め込みフォームのためスキップ'` でログ記録 |
| `with_captcha` | スキップ。`references/form-filling.md` の「reCAPTCHA / hCaptcha 等がある場合」に従う |

`form_type` が null（未判定）の場合は playwright-cli でフォーム構造を確認してから判断する。**ただし、null の場合は1回の試行で失敗したら即スキップする**（iframe_embed や with_captcha だった場合のツールコール浪費を防ぐため）。

**送信本文の検証:** outreach_logs に記録する前に、フォームに入力した本文（body）が空でないことを確認する。空の場合は送信失敗として `status = 'failed'`, `error_message = 'body empty'` で記録し、ステータスは `new` のまま維持する。

**送信完了の判定とログ記録:** `references/form-filling.md` の「送信完了の判定」に従い、snapshot と network で確認してからログ記録する。

### 5. SNS DM

claude-in-chrome を使用してSNSでDMを送る（ログインセッションが必要なため）。対応プラットフォーム: **X（Twitter）** および **LinkedIn**。

**メッセージ:** SNS用に短く簡潔にする。SALES_STRATEGY.mdの「SNSメッセージ」セクションを参考に。

**共通手順:**
1. prospects.sns_accounts（JSON）からアカウント情報を取得
2. ブラウザでSNSプロフィールページに移動
3. DMまたはメッセージ機能を使ってメッセージを送る

**X（Twitter）の場合:**
- プロフィールページからDMアイコン（メッセージ）をクリック
- 相手のDM受信設定が閉じている場合は送信不可 → `unreachable` にする
- channel: `sns_twitter`

**LinkedIn の場合:**
- プロフィールページから「メッセージ」ボタンをクリック
- コネクション済みの相手のみDM送信可能。未コネクションの場合は送信不可 → `unreachable` にする
- InMail（有料機能）は使用しない
- channel: `sns_linkedin`

送信後、`send_and_log.py --log-only` でログ記録+ステータス更新をアトミックに実行する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
  --project "$0" --prospect-id <prospect_id> --log-only \
  --channel <sns_twitter|sns_linkedin> --subject "" --body "<body>"
```

### 6. アプローチ不可の営業先の処理

アプローチに失敗した営業先のうち、**構造的な理由**で今後もアプローチ不可能と判断できる場合は `unreachable` に更新する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/update_status.py data.db \
  --project "$0" --prospect-id <prospect_id> --status unreachable
```

営業お断りの場合は `--do-not-contact` を追加して全プロジェクトで除外する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/update_status.py data.db \
  --project "$0" --prospect-id <prospect_id> --status unreachable \
  --do-not-contact --dnc-reason "営業お断りの記載あり"
```

> **注意:** DB への直接 SQL 実行は禁止。ステータス更新は必ず専用スクリプト経由で行うこと（`contacted` → `send_and_log.py`、`responded`/`rejected` → `record_response.py`、`unreachable`/`inactive` → `update_status.py`）。

**`unreachable` にすべきケース:**
- メールアドレスが不正でバウンスした（恒久的なエラー）
- SNSのDMが開放されていない
- フォームがB2B問い合わせ用途でなかった
- そもそも利用可能な連絡手段がなかった

**`unreachable` にしないケース（`new` のまま維持）:**
- 一時的なネットワークエラーやタイムアウト
- gog send の認証エラーなどシステム側の問題

### 7. 目標未達時の追加アプローチ

全営業先の処理が完了した後、成功数（sent）が目標件数に満たない場合:

1. 不足数 = 目標件数 - 成功数
2. `list-reachable` で追加の営業先を取得する（不足数分）:
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db list-reachable "$0" <不足数>
   ```
3. 取得できた営業先に対してステップ2〜6を繰り返す
4. リトライは**1ラウンドのみ**。reachable が 0 になった場合もリトライを終了する
5. 最終的な目標達成状況をレポートに含める（例: 「目標5件中3件成功（リスト枯渇のため終了）」）

### 8. 結果レポート

以下を報告する:
- アプローチした営業先数
- チャネル別の試行数・成功数・成功率（メール: 成功X/試行Y件(XX%)、フォーム: 成功X/試行Y件(XX%)、SNS: 成功X/試行Y件(XX%)）
- 失敗した件数と理由
- 次のステップとして `/check-results` の実行を案内する
