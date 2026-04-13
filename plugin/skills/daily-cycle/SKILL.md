---
name: daily-cycle
description: "This skill should be used when the user asks to \"日次サイクルを回して\", \"今日の営業を実行して\", \"デイリーの営業タスクをやって\", \"daily-cycleを実行して\", or wants to run the daily sales automation cycle. check-results → evaluate → outbound + build-list（必要時）を順次・並行で自動実行する。"
argument-hint: "<project-directory-name> [outbound件数=30]"
allowed-tools:
  - Bash
  - Read
  - Agent
---

# Daily Cycle - 日次営業サイクル実行

1日分の営業活動を自動で実行するスキル。全フェーズをサブエージェントで実行し、メインのコンテキストを軽量に保つ。

**前提:** `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` の規約に従うこと（data.dbの配置・cdしないルール）。サブエージェントへのプロンプトにもこの規約の参照を含めること。

**重要: このスキルは `context: fork` を使わないこと。** サブエージェントのネストは1階層までという制約があるため、daily-cycle自体はメインcontextで動き、各フェーズをAgent toolで起動する必要がある。

**コンテキスト軽量化ルール:**
- サブエージェントは**詳細結果を `$0/.tmp/` 内のファイルに書き出し**、メインには**判断に必要な最小限のサマリー（3行以内）だけ**を返すこと
- 最終レポート・通知・commitは wrap-up サブエージェントが `.tmp/` ファイルを読んで実行する

## 引数

- プロジェクトディレクトリ名: `$0`（必須）
- outbound 件数: `$1`（省略時: 30）

## 実行手順

### 0. Preflight チェック

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

`status` が `error` の場合はエラーメッセージを表示して**即座に中断**する。`migrations_applied` にマイグレーションがあればユーザーに報告する。

### 1. 準備

まず現在の正確な日時・曜日を取得する。以降のステップではこの結果を正とする（システムの日付情報より優先）。

```bash
date '+%Y-%m-%d %H:%M (%A)'
```

`$0` ディレクトリの存在と、DBにプロジェクトが登録済みであることを確認する。

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db project-exists "$0"
```

一時ディレクトリを作成する（サブエージェントの詳細結果保存用）:

```bash
mkdir -p "$0/.tmp"
```

### 2. 前回サイクルレビュー

`$0/DAILY_CYCLE_REPORT.md` が存在する場合、読み込んで以下を把握する:

- 前回の実行日時
- outbound成功率とチャネル内訳（成功率が低かった場合、今回のバッチ戦略に反映）
- build-listの結果（候補不足だった場合、今回は早めにbuild-listを実行する判断材料にする）
- 「次回への申し送り」セクション（システムエラー、中断、要注意事項など）

把握した内容は、以降のステップでサブエージェントに渡すプロンプトに**関連する申し送りがある場合のみ**追記する。例:
- outbound成功率が低かった → ステップ7のサブエージェントに「前回成功率が低かった（XX%）。チャネルYで失敗多発」と伝える
- build-listで候補が少なかった → ステップ8aのサブエージェントに「前回は候補収集でN件しか見つからなかった。SEARCH_NOTES.mdの方向性を変えること」と伝える
- システムエラーがあった → 該当ステップのサブエージェントに警告として伝える

ファイルが存在しない場合（初回実行）はスキップする。

### 3. 開始通知メール

`$0/SALES_STRATEGY.md` の「通知設定」セクションから通知先メールアドレスを、「送信者情報」セクションから送信元メールアドレスを取得する。通知先が「なし」または未設定の場合はスキップ。

本文は追加のDB参照をせず、既に手元にある情報だけで簡潔に組み立てる:
- 実行日時（ステップ1の結果）
- プロジェクト名（`$0`）
- outbound目標件数（`$1`）
- 前回サイクルの結果（ステップ2でDAILY_CYCLE_REPORT.mdから読んだ内容を1〜2行で抜粋。初回は省略）

```bash
gog send --account "<送信元>" --to "<通知先>" --subject "daily-cycle開始: $0" --body "<本文>"
```

送信失敗してもサイクルは続行する（エラーはwrap-upのレポートで報告）。

### 4. check-results（サブエージェント）

Agent toolでサブエージェントを起動し、返信確認を実行する。

プロンプトに以下を含める:
- プロジェクトディレクトリ: `$0`
- `${CLAUDE_PLUGIN_ROOT}/skills/check-results/SKILL.md` を読み込んで、その手順に従うこと
- 詳細結果（反応の内訳、各返信の要約、ドラフト作成結果等）を `$0/.tmp/check-results-summary.md` に書き出すこと
- メインへの返答は **3行以内のサマリーのみ**。例: 「反応3件(positive 2, neutral 1)。ドラフト2件作成。送付NG 0件。」

サブエージェントからサマリーが返ったら、ユーザーに報告する。

### 5. evaluate（サブエージェント、条件付き）

毎サイクル実行する。

プロンプトに以下を含める:
- プロジェクトディレクトリ: `$0`
- `${CLAUDE_PLUGIN_ROOT}/skills/evaluate/SKILL.md` を読み込んで、その手順に従うこと
- 詳細結果（KPI数値、分析結果、適用した改善内容）を `$0/.tmp/evaluate-summary.md` に書き出すこと
- メインへの返答は **3行以内のサマリーのみ**。例: 「反応率4.2%。メッセージング改善を適用。検索キーワード2件追加。」

サブエージェントからサマリーが返ったら、ユーザーに報告する。

### 6. リスト残数を確認し、実行順序を決定

未アプローチ（status = 'new'）の営業先数を確認する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable-by-channel "$0"
```

チャネル別内訳（email / form_only / sns_only）はステップ7のバッチ戦略判断に使う。

**email枯渇チェック:** チャネル別内訳で **email = 0 かつ form_only < 5** の場合、outboundの実効成功率が極めて低い。この場合はoutboundをスキップし、**ステップ8（build-list）を先に実行**してemail保有先を充填する。充填後にステップ6を再実行し、email > 0 になっていればoutboundに進む。build-list後もemail = 0 のままの場合、form_only の件数分だけoutboundを実行する（email枯渇状態であることをユーザーに報告する）。

**実行順序の判定:** リスト残数が outbound 指定件数の **1/3 未満** の場合、outbound より先にステップ8（build-list）を実行してリストを充填する。充填後にステップ7の outbound に戻る。

- email = 0 かつ form_only < 5 → ステップ8（build-list）→ ステップ6を再実行 → ステップ7（outbound）
- リスト残数 ≥ 指定件数の 1/3 → ステップ7（outbound）→ ステップ8（build-list、必要時）
- リスト残数 < 指定件数の 1/3 → ステップ8（build-list）→ ステップ6を再実行 → ステップ7（outbound）
- リスト残数 = 0 かつ build-list 未実行 → ステップ8（build-list）→ ステップ6を再実行 → ステップ7（outbound）

### 7. outbound（サブエージェント × バッチ分割）

**実際のoutbound件数の決定:** `min(指定件数, ステップ6のリスト残数)` を実際のoutbound件数とする。リスト残数が0の場合（ステップ8実行後も0の場合）はoutboundをスキップし、ステップ9に進む。

**フォーム送信の上限:** 1サイクルあたりフォーム送信は**最大5件**とする。フォーム送信はブラウザ操作で1件あたり10〜20ツールコールを消費し、コンテキスト枯渇の主因となるため。ステップ6のチャネル別カウント（`form_only`）が5件を超える場合、超過分は次サイクルに繰り越す。email 有りの営業先には上限を設けない。

outbound件数を **10件ずつのバッチ** に分割し、それぞれ別のサブエージェントとして**直列**で起動する。

例: 30件 → 3回のサブエージェント起動（各10件）

各サブエージェントのプロンプトに以下を含める:

```
あなたは outbound 営業を実行するエージェントです。
営業先リストの各社にメール送信・フォーム入力・SNS DMでアプローチしてください。

## 実行準備（この順番で必ず読み込むこと）

1. まず `$0/SALES_STRATEGY.md` と `$0/BUSINESS.md` を読み込み、以下を把握する:
   - アウトリーチモード（precision / volume）。未設定なら precision
   - 営業チャネルの優先順位・使わないチャネル
   - 件名パターンのバリエーション（A/Bテスト指示がある場合は必ず従う）
   - 本文の構成方針・テンプレート（volume モードではテンプレートを重視）
   - 送信者情報（送信元メールアドレス・署名）
   - SNSメッセージ方針

2. 次に `${CLAUDE_PLUGIN_ROOT}/skills/outbound/SKILL.md` を読み込み、実行手順に従う

3. チャネルに応じて以下も読み込む:
   - メール送信時: `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/email-guidelines.md`
   - フォーム入力時: `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/form-filling.md` と `${CLAUDE_PLUGIN_ROOT}/skills/outbound/references/playwright-guide.md`

## 営業方針の必須ルール

- **件名:** SALES_STRATEGY.md に複数の件名パターンがある場合、バッチ内で均等に使い分けること。毎回同じ件名にしない
- **本文冒頭:** 相手企業の具体的な特徴・業種・取り組みに言及すること。「貴社のウェブサイトを拝見し」等の汎用挨拶だけは不可
- **本文全体:** overview と match_reason から相手固有の情報を複数箇所に散りばめ、テンプレートの差し替えではなく相手に合わせた文脈で書く
[前バッチの件名パターン使用状況があればここに追記]

## タスク

- プロジェクトディレクトリ: $0
- バッチ番号: N
- 処理件数: 10（最終バッチは端数）
- 詳細結果を `$0/.tmp/outbound-batch-N.md` に書き出すこと
- メインへの返答は **成功数・失敗数・unreachable数・失敗の主な理由（あれば）・使用した件名パターン一覧のみ**
  例: 「成功8, 失敗1(フォーム送信エラー), unreachable 1。件名パターン: A×4, B×3, C×3」
```

**前バッチの結果引き継ぎ:** 2バッチ目以降は、前バッチが返した件名パターン使用状況をプロンプトの「前バッチの件名パターン使用状況」部分に追記し、同じパターンへの偏りを防ぐ。例: 「前バッチではパターンAを4回、Bを3回使用。今回はB, Cを多めに使うこと」

**直列にする理由:** 各バッチが同じDBの同じステータスを参照するため、並列実行すると同じ営業先に重複アプローチするリスクがある。

**サブエージェント拒否時のフォールバック:** サブエージェントがブラウザ操作（フォーム送信等）を拒否して処理が進まない場合、そのバッチをメインコンテキストで再実行する。メインでの再実行時はフォーム対象のみ処理し、メール送信済みの営業先は重複しないようDBステータスで判定する。

各バッチのサマリーが返るたびに進捗を報告する（例: 「outbound: 10/30件完了」）。

**バッチ間の成功率チェック:** 各バッチ完了後、成功率（成功数 / 処理数）を確認する。成功率が30%未満の場合、残りバッチの実行を中断し、以下を自律的に判断・実行する:
- 失敗理由が連絡先不足（unreachable多発）→ ステップ8のbuild-listを優先実行し、連絡先付きの営業先を補充する
- 失敗理由がシステム的問題（gog send認証エラー等）→ outbound全体を中断し、完了レポートで問題を報告する
- 失敗理由がフォーム不適合等 → 残りバッチはメールありの営業先のみに絞って継続する

**目標未達時のリトライ:** 全outboundバッチ完了後、各バッチの結果を集計する。成功数合計 < 指定件数 の場合:

1. reachable 残数を再確認する:
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
   ```
2. 残数 > 0 の場合、不足分（指定件数 - 成功数合計）を追加バッチとして実行する（プロンプトは上記と同様）
3. リトライは**1ラウンドのみ**
4. reachable が 0 の場合はリトライせずステップ8に進む

### 8. build-list（必要時のみ、3ステップ構成）

以下のいずれかの場合に実行する:
- ステップ6の判定で outbound より先に build-list を実行すると決定された
- リスト残数（ステップ6の結果 − ステップ7で消費した件数）が outbound件数の3倍未満
- ステップ7でバッチ間成功率チェックにより連絡先補充が必要と判断された

目標件数はoutbound件数と同じ（`$1`、デフォルト30）とする。ただし、登録件数ではなく **reachable 件数** で目標に近づけることを意識する（連絡先なし分を見越して多めに候補収集する）。

build-list スキルはサブエージェント内でさらにサブエージェントを起動する構成のため、daily-cycle からは直接呼び出せない（ネスト制約）。代わりに、build-list の各フェーズを個別のサブエージェントとして実行する:

**8a. 候補収集（サブエージェント）**

ステップ7の最後のoutboundバッチと**並行起動**しても良い（候補収集は新規追加のみなので重複リスクなし）。

プロンプトに以下を含める:
- プロジェクトディレクトリ: `$0`
- 目標件数
- `${CLAUDE_PLUGIN_ROOT}/skills/build-list/SKILL.md` の Phase 1（ステップ1〜5）を読み込んで、その手順に従うこと
- **連絡先（メール・フォーム等）の取得は不要**。候補の名前・法人番号・正式法人名・公式URL・概要・業種・マッチ理由・優先度を収集すること
- 完了後、候補リストをJSON配列で返すこと（各オブジェクト: name, organization_name, corporate_number, website_url, overview, industry, match_reason, priority（1-5の数値。build-list SKILL.mdの定義に従う））
- 探索メモ（`$0/SEARCH_NOTES.md`）の更新も行うこと

**8b. 重複フィルタ（メインコンテキスト）**

8a で返された候補リストから、既にDBに登録済みの営業先を除外する。8a の出力をJSONファイルに保存し、`filter_duplicates.py` に渡す:

```bash
cat <<'EOF' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/filter_duplicates.py data.db "$0"
<8aの出力JSON配列>
EOF
```

スクリプトが name の完全一致と website_url のドメイン一致で重複を自動除外し、新規候補のみをJSON配列で出力する（除外結果のサマリーは stderr に出力される）。出力されたJSON配列を 8c に渡す。

新規候補が0件の場合は 8c・8d をスキップし、完了レポートで報告する。

**8c. 連絡先取得（サブエージェント × バッチ）**

8b で絞り込まれた新規候補を **10件ずつのバッチ** に分割し、それぞれサブエージェントを起動する。

各サブエージェントのプロンプトに以下を含める:
- 担当する候補のリスト（8aの出力から該当分を渡す）
- `${CLAUDE_PLUGIN_ROOT}/skills/build-list/references/enrich-contacts.md` を読み込んで、その手順に従うこと
- 各候補の公式サイトを探索し、メールアドレス・フォームURL・SNSアカウントを取得すること
- 完了後、取得結果をJSON配列で返すこと

**8c2. 連絡先なし候補の再探索（サブエージェント、該当がある場合のみ）**

8c の結果で email / contact_form_url の両方が null の候補がある場合、サブエージェントを起動して公式サイト以外の情報源から補完を試みる。

プロンプトに以下を含める:
- 対象候補のリスト（name, website_url）。最大10件まで
- 各候補について WebSearch で `"{会社名}" メールアドレス` `"{会社名}" 問い合わせ` 等を検索し、業界ディレクトリやプレスリリース配信サイト等から連絡先を探すこと
- 見つかった連絡先（email, contact_form_url, sns_accounts）をJSON配列で返すこと
- 見つからなかった候補は結果に含めなくてよい

サブエージェントの結果を 8c の結果JSONに反映する。

**8d. DB登録（メインコンテキスト）**

8b のフィルタ済み候補（Phase 1情報）と 8c の連絡先取得結果をマージし、`add_prospects.py` で登録する。

まず、8b の出力（候補JSON）と 8c の出力（連絡先JSON）をそれぞれファイルに保存する:
- 8b の出力 → `/tmp/candidates.json`
- 8c の各サブエージェントの出力を1つのJSON配列に結合 → `/tmp/contacts.json`

`merge_prospects.py` で name + ドメインで突き合わせマージし、そのまま `add_prospects.py` に渡す:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/merge_prospects.py /tmp/candidates.json /tmp/contacts.json \
  | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/add_prospects.py data.db "$0"
```

マージ結果のサマリー（未マッチ件数等）は stderr に出力される。

**8e. reachable 再チェック & サマリー書き出し**

build-list 完了後、reachable 件数を再確認する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
```

build-list のサマリー（追加件数、reachable件数、未マッチ件数等）を `$0/.tmp/build-list-summary.md` に書き出す。

ステップ6の判定で build-list を先に実行した場合は、ここからステップ7（outbound）に進む。

### 9. wrap-up（サブエージェント）

**全フェーズ完了後、レポート生成・通知・commitを1つのサブエージェントで実行する。** これにより、メインコンテキストの蓄積に影響されず確実に最終処理を行う。

プロンプトに以下を含める:
- プロジェクトディレクトリ: `$0`
- 実行日時: ステップ1で取得した日時
- evaluate をスキップした場合はその旨
- outbound をスキップした場合はその旨
- build-list をスキップした場合はその旨
- `$0/.tmp/` 内の全ファイルを読み込んで、以下の3つを順に実行すること

**9a. DAILY_CYCLE_REPORT.md の生成**

`$0/.tmp/` 内のサマリーファイルを全て読み込み、以下のフォーマットで `$0/DAILY_CYCLE_REPORT.md` を上書き保存する:

```markdown
# Daily Cycle Report

- 実行日時: YYYY-MM-DD HH:MM
- プロジェクト: $0

## check-results
（反応数、内訳、ドラフト作成数）

## evaluate
（KPI、改善内容、またはスキップ理由）

## outbound
- アプローチ数: X件（成功: Y / 失敗: Z）
- 成功率: XX%
- チャネル別成功率: メール X/Y件(XX%) / フォーム X/Y件(XX%) / SNS X/Y件(XX%)
- unreachable: X件

## build-list
（追加数、またはスキップ理由）

## リスト残数
X件（reachable）

## 次回への申し送り
（問題、注意点、戦略調整の提案など。なければ「特になし」）
```

**9a2. SALES_STRATEGY.md の KPI 実績更新**

`$0/SALES_STRATEGY.md` に「KPI実績」セクションがある場合、以下の基本数値を最新値に更新する:
- 累計送信数（contacted）
- 累計反応数・反応率
- 実行日時

evaluate がスキップされたサイクルでも KPI 実績が陳腐化しないようにする。メッセージング改善・ターゲティング変更等の戦略的な分析は evaluate スキルに任せ、ここでは**数値の更新のみ**行う。

**9b. 完了通知メール**

`$0/SALES_STRATEGY.md` の「通知設定」セクションから通知先メールアドレスを、「送信者情報」セクションから送信元メールアドレスを取得する。通知先が「なし」または未設定の場合はスキップする。

```bash
gog send --account "<送信元メールアドレス>" --to "<通知先メールアドレス>" --subject "daily-cycle完了: $0" --body-file "$0/DAILY_CYCLE_REPORT.md"
```

**9c. 一時ファイルの削除**

```bash
rm -rf "$0/.tmp"
```

**9d. 作業結果のコミット・プッシュ**

作業中に変更されたファイルをコミットしてプッシュする。このステップは他の処理の成否に関わらず**必ず実行する**。

```bash
git add data.db "$0/" && git commit -m "work: :e-mail: $0" && git push
```

サブエージェントのメインへの返答: レポート保存の成否、通知メール送信の成否、commit の成否を簡潔に報告。
