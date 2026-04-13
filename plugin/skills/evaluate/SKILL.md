---
name: evaluate
description: "This skill should be used when the user asks to \"結果を分析して\", \"戦略を改善して\", \"PDCAを回して\", \"効果を評価して\", \"反応率を見て\", or wants to evaluate sales performance and improve strategy. 反応率等のデータに基づいて戦略・ターゲティング・メッセージングを自動で分析し改善する。"
argument-hint: "<project-directory-name>"
allowed-tools:
  - Bash
  - Read
  - Write
  - WebSearch
---

# Evaluate - PDCA評価＆改善

営業活動の結果データを分析し、戦略・戦術・ターゲティング・メッセージング等のあらゆる側面を評価して自動改善するスキル。

**前提:** `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` の規約に従うこと（data.dbの配置・cdしないルール）。

## 実行手順

### 0. Preflight チェック

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

`status` が `error` の場合はエラーメッセージを表示して**即座に中断**する。`migrations_applied` にマイグレーションがあればユーザーに報告する。

### 1. データ収集

- プロジェクトディレクトリ名: `$0`（必須）

`sales_queries.py` の `eval-*` コマンドを順次実行し、各結果を分析用に保持する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-total-outreach "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-channel-counts "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-response-counts "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-sentiment-breakdown "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-priority-response-rate "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-status-counts "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-channel-response-rate "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-responded-messages "$0"
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db eval-no-response-sample "$0"
```

### 2. 既存戦略の読み込み

以下を読み込む:
- `$0/BUSINESS.md`
- `$0/SALES_STRATEGY.md`
- `$0/RESULTS_REPORT.md`（存在する場合）
- 過去の `evaluations` テーブルの記録（全件）

過去のevaluationsが存在する場合、各レコードの `evaluation_date`、`findings`、`improvements` を時系列で整理し、これまでに何を試し、何が効果的で、何が効果がなかったかを把握する。この情報はステップ4の改善アクション決定時に使う。

### 3. 多角的分析

`${CLAUDE_PLUGIN_ROOT}/skills/evaluate/references/analysis-frameworks.md` を参照し、以下の観点で分析を行う:

**反応率分析:**
- 全体の反応率
- チャネル別の反応率（メール vs フォーム vs SNS）
- 優先度別の反応率
- 時間帯・曜日別の傾向（送信日時から分析。ただし送信タイミングは daily-cycle の実行スケジュールで決まるため、SALES_STRATEGY.md に送信時間の制約を書かないこと。分析結果はレポートで「推奨実行タイミング」として報告するにとどめる）

**メッセージ分析:**
- 反応があったメールの本文（outreach_logs.body）を全件読み込み、共通点を抽出
- 反応がなかったメールからは数件サンプリングして比較
- 件名の効果
- 本文の長さ・構成の効果

**ターゲット分析:**
- 反応が良い業種・規模
- 反応が悪いセグメント
- 想定外の反応パターン

**チャネル分析:**
- 最も効果的なチャネル
- チャネルごとのコスト対効果

### 4. 改善アクションの決定と自動適用

**データ量の確認（必須）:**

改善アクションを適用する前に、データが十分かどうかを確認する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db data-sufficiency "$0"
```

以下のいずれかに該当する場合、**SALES_STRATEGY.mdへの変更適用・優先度再計算は行わない**。レポート生成（ステップ5・6）のみ実行し、「データ不足のためモニタリング継続」と報告する:
- アプローチ総数（status='sent'）が30件未満
- 最終送信から3営業日未満

データ不足でもevaluationsテーブルへの記録（ステップ5）とレポート生成（ステップ6）は行う。現状把握として有用なため。

---

データが十分な場合、分析結果に基づいて具体的な改善を決定し、**自動で適用する**。

**戦略変更の安定性（必須）:**
evaluateは毎日実行されるが、戦略を頻繁に変えすぎないこと。前回の戦略変更後に十分なデータが蓄積されるまでは、現行戦略を維持してデータ収集を優先する。

何が「十分なデータ」かは文脈に依存する。送信ボリュームが大きいプロジェクトでは数件の反応増減はノイズだが、少量精鋭のアプローチでは1件の反応でも重要なシグナルになり得る。SALES_STRATEGY.md のターゲット規模や送信頻度を踏まえて判断すること。

判断の原則:
- **単発の変動ではなく、繰り返し観測されるパターン**に基づいて変更する
- **前回の戦略変更の効果がまだ測定できていない**段階では、さらなる変更を重ねない
- 迷ったら変えない。データを蓄積する方が、中途半端な根拠で方針を変えるより価値が高い

**過去の改善履歴との照合（必須）:**
改善アクションを決定する前に、ステップ2で整理した過去のevaluations履歴を確認し、以下を守る:
- 過去に実施済みで効果がなかった施策を再採用しない
- 過去に効果があった施策の方向性を継続・深化させる
- 過去と同じ改善を提案する場合は、なぜ今回は異なる結果が期待できるか理由を明記する

**SALES_STRATEGY.md の更新:**
- ターゲットの絞り込みまたは拡大
- メッセージングの改善（件名、本文構成、トーン）
- チャネル優先順位の見直し
- KPI目標の更新

**検索キーワードの更新:**
- 反応が良いセグメントに関連するキーワードの追加
- 効果が低いキーワードの削除

**SEARCH_NOTES.md への反応パターン反映:**
`$0/SEARCH_NOTES.md` が存在する場合、`## evaluate からの探索ヒント` セクションを上書き更新する（セクションがなければ末尾に追加）。build-list が次回実行時にこのセクションを保持して探索方針を調整する。

追記する内容:
- 反応率が全体平均より高い業種・セグメント → 「○○業から反応率X%（全体平均Y%）。同業種を重点的に探索する」
- 反応があった企業と類似した特徴（規模感、事業内容、課題感） → 「○○のような企業が反応しやすい。類似企業・競合を探す」
- 反応が悪かったセグメント → 「○○業は反応率が低い（X%）。優先度を下げる」

SEARCH_NOTES.md が存在しない場合はスキップする（build-list 未実行の状態なので）。

**優先度の再計算:**
- 反応パターンに基づいてprospectsの優先度を更新（ステップ5で一括実行）

### 5. 評価記録の保存

`record_evaluation.py` で評価記録と優先度更新をアトミックに実行する:

```bash
echo "<findings_text>" > /tmp/eval_findings.txt
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/record_evaluation.py data.db \
  --project "$0" \
  --metrics '<metrics_json>' \
  --findings-file /tmp/eval_findings.txt \
  --improvements '<improvements_json>' \
  --priority-updates '[{"industry": "<industry>", "priority": <1-5>}, ...]'
```

`--priority-updates` は省略可能（データ不足で優先度変更なしの場合）。

> **注意:** DB への直接 SQL 実行は禁止。評価記録は必ず `record_evaluation.py` 経由で行うこと。

### 6. 結果レポート

以下を報告する:
- 主要KPI（反応率、ポジティブ率等）
- 前回評価からの変化（あれば）
- 分析で発見した重要な知見
- 適用した改善内容の一覧
- 次に取るべきアクション（`/build-list` で追加探索、`/outbound` で再アプローチ等）

レポートをプロジェクトディレクトリに `EVALUATION_REPORT.md` として保存する（上書き。履歴はDBに保存済み）。
