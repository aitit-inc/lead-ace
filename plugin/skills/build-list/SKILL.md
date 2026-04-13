---
name: build-list
description: "This skill should be used when the user asks to \"営業先リストを作って\", \"営業先を探して\", \"見込み客を集めて\", \"ターゲットを探索して\", or wants to build a prospect list. BUSINESS.mdとSALES_STRATEGY.mdに基づきWeb探索で営業先候補を収集しDBに登録する。"
argument-hint: "<project-directory-name> [目標件数=30]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
  - WebSearch
---

# Build List - 営業先リスト作成

BUSINESS.mdとSALES_STRATEGY.mdの情報に基づいて、Web探索で営業先候補を収集し、連絡先情報を取得した上でデータベースに登録するスキル。

**前提:** `${CLAUDE_PLUGIN_ROOT}/references/workspace-conventions.md` の規約に従うこと（data.dbの配置・cdしないルール）。

**2フェーズ構成:**
- **Phase 1（候補収集）:** Web検索で営業先候補を幅広く見つける（名前・公式URL・概要）
- **Phase 2（連絡先取得）:** サブエージェントで各候補の公式サイトを探索し、メールアドレス・フォームURLを取得する

## Phase 0: 前提チェック

### 0. Preflight チェック

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db "$0"
```

`status` が `error` の場合はエラーメッセージを表示して**即座に中断**する。`migrations_applied` にマイグレーションがあればユーザーに報告する。

## Phase 1: 候補収集

### 1. 準備

- プロジェクトディレクトリ名: `$0`（必須）
- 目標件数: `$1`（省略時: 30。厳密でなく「だいたいN件」で良い）

以下を読み込む:
- `$0/BUSINESS.md`
- `$0/SALES_STRATEGY.md`

存在しない場合は `/strategy` の実行を案内する。

### 2. 既存リストと探索メモの確認

探索を始める前に、以下の2つを確認する:

**2a. 登録済み営業先の取得（重複回避用）:**

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db all-prospect-identifiers "$0"
```

この結果（name + website_url の一覧）を保持する。Phase 1 の候補収集で、ここに含まれる営業先は **候補に入れない**。名称完全一致またはwebsite_urlのドメイン一致で判定する。

**2b. 探索メモ:**

`$0/SEARCH_NOTES.md` が存在すれば読み込む。ここには前回までの探索で得られた知見が記録されている:
- 有用な情報源サイト（まだ掘り切れていないもの）
- 前回使ったキーワードと探索アングル
- 次回に試すべき方向性

これらを踏まえて、今回の探索を前回の続きから始められるようにする。

### 3. 検索戦略の策定

SALES_STRATEGY.mdの「検索キーワード」「ターゲット」セクションを基に、複数の検索クエリを策定する。

検索クエリの種類（ターゲットの種別に応じて適切なものを選ぶ）:
- ターゲット業種 + 地域での検索
- 業界団体・協会・連盟のメンバーリスト
- 業界メディア・ニュースサイトでの営業先収集
- 展示会・イベントの出展者リスト
- 競合のクライアント事例
- 求人サイトでのターゲット探索
- 学校・法人の一覧サイトや公的データベース

### 4. Web探索の実行

WebSearch と `fetch_url.py`（Jina Reader + Claude Haiku）を組み合わせて、営業先候補を幅広く収集する。

**ページ取得には `fetch_url.py` を使う（WebFetch は使わない）:**
```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "https://example.com" --prompt "企業一覧を抽出" --timeout 15
```
タイムアウト制御があるため、応答しないサイトでもフリーズしない。SPA サイトにも対応。

このフェーズでは**候補の発見**に集中する。各候補の連絡先（メール・フォーム等）の取得は Phase 2 で行うので、ここでは以下の情報だけ集める:

**必須（これがないと候補にしない）:**
- 名称（企業名、学校名、法人名等）
- 法人番号（13桁）— 後述の法人番号検索で取得する
- 事業概要（何をしている組織か。公式サイトから1-2文で要約）
- 公式サイトURL

**取得できれば:**
- 業種・分野
- 部署名・拠点名（学校法人なら学校名、大企業なら営業対象部署）
- 検索中にたまたま見つかったメールアドレスやSNS（わざわざ探さなくてよい）

公式サイトURLと事業概要が取得できない営業先はスキップする。

**法人番号の検索（候補ごとに必ず実施）:**

candidates を収集した後、法人番号が未取得の候補については以下で取得する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/check_corporate_number.py "{会社名}"
```

stdout に JSON が出力される。`results` 配列から `number`（法人番号）と `name`（正式法人名）を取得する。
- 1件ヒット → `number` を `corporate_number`、`name` を `organization_name` として採用
- 複数ヒット → 住所や公式サイト情報と照合して正しい候補を特定する。確信が持てない場合は WebSearch + fetch_url.py で確認
- 0件 → 法人格を除去した名前や読み仮名（`--kana`）で再検索を試みる

法人番号が見つからない候補はリストに含めない（organizations テーブルは法人番号が PK のため登録不可）。

**注意:** `organization_name` は NTA で確認した正式法人名（例: 「学校法人片柳学園」）であり、営業先名（`name`、例: 「日本工学院専門学校」）とは異なる場合がある。

**探索のコツ:**
- 1つの検索クエリで見つかる営業先は限られるので、多角的にクエリを変えて探索する
- ポータルサイトや一覧ページを活用すると一度に多くの候補が見つかる
- 目標件数（`$1`、デフォルト30）に達したら探索を終了する。重複で弾かれた件数はカウントしない（新規登録できた件数でカウント）
- このフェーズでは個別の公式サイトを深掘りする必要はない。候補の「数」を確保することに注力する

**重複が多い場合の探索の深掘り:**

リストが蓄積されてくると、検索上位に出る有名な営業先は既に登録済みで重複が増えてくる。その場合は**ターゲットや戦略自体を変えるのではなく**、同じターゲット内でより深く探索する:

- 検索結果の上位だけでなく、2ページ目・3ページ目以降まで見る
- キーワードに地域名を付加して絞る（例: 「SaaS企業」→「SaaS企業 福岡」「SaaS企業 名古屋」）
- 類義語や関連語でキーワードを変える（例: 「学習塾」→「進学塾」「個別指導」「予備校」）
- 業界特化のポータルサイト・ディレクトリを探して、そこに掲載されている営業先を辿る
- 一覧ページの中で見落としていた営業先を拾う
- 既に登録済みの営業先の「競合」「類似サービス」を検索して芋づる式に見つける

重複で弾かれたら、それを「もうこの方面は掘り尽くした」というシグナルとして、**探索のアングルを変える**（ターゲットを変えるのではなく、探し方を変える）。

### 5. 優先度・マッチ理由の判定

各営業先について、SALES_STRATEGY.mdの基準でマッチ理由（なぜターゲットとして適切か、相手の課題・ニーズを含む）と優先度（1-5）を付与する:
- 1: 最有力（ターゲットに完全合致、ニーズが明確）
- 2: 有力（ターゲットに概ね合致）
- 3: 通常（ターゲット範囲内）
- 4: やや外れる（一部条件のみ合致）
- 5: 要検討（間接的な可能性）

**email取得容易性の加味:** 探索中に以下のシグナルが見つかった場合、同じマッチ度なら優先度を1段階上げる（email保有先が多いほどoutbound成功率が上がるため）:
- PR TIMES にプレスリリースがある（広報メール記載率が高い）
- スタートアップDB・業界ディレクトリに掲載されている（公開情報が多い）
- 公式サイトにinfo@等のメールが明示されていた（探索中にたまたま発見）

## Phase 2: 連絡先取得

### 6. サブエージェントによる連絡先の取得

Phase 1 で収集した候補を **5件ずつのバッチ** に分割し、バッチごとにサブエージェントを起動して連絡先情報を取得する。

各サブエージェントのプロンプトに以下を含める:
- 担当する候補のリスト（name, organization_name, corporate_number, website_url, overview, industry, department, match_reason, priority）
- `${CLAUDE_PLUGIN_ROOT}/skills/build-list/references/enrich-contacts.md` を読み込んで、その手順に従うこと
- 各候補の公式サイトを探索し、メールアドレス・フォームURLを取得すること
- ページ取得には `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url <URL> --prompt <指示>` を使うこと（WebFetch は使わない）
- 完了後、取得結果をJSON配列で返すこと

サブエージェントの allowed-tools: `Bash`, `WebSearch`, `Read`

サブエージェントが返すJSON配列の各オブジェクトには、Phase 1 の情報（name, organization_name, corporate_number, overview, website_url, industry, department, match_reason, priority）に加えて、取得した連絡先（email, contact_form_url, sns_accounts）が含まれる。

### 6b. 連絡先なし候補の再探索（該当がある場合のみ）

Phase 2 の結果で email / contact_form_url の両方が null の候補がある場合、**公式サイト以外の情報源** から連絡先を補完する。

対象候補ごとに WebSearch で以下を検索する:
- `"{会社名}" メールアドレス`
- `"{会社名}" 問い合わせ`

業界ディレクトリ、プレスリリース配信サイト、イベント登壇者情報等から拾えることがある。見つかった場合は候補のJSON に反映する。

**上限:** 再探索は連絡先なし候補 **最大10件** まで。残りは連絡先なしのまま登録する（outbound時にスキップされる）。

## Phase 3: 登録

### 7. データベース登録

Phase 1 の候補情報と Phase 2 の連絡先情報を `merge_prospects.py` でマージし、`add_prospects.py` でDB登録する。

まず、Phase 1 の候補リスト（連絡先なし）と Phase 2 の全バッチ結果（連絡先あり）をそれぞれJSONファイルに保存する:
- Phase 1 の候補 → `/tmp/candidates.json`
- Phase 2 の全バッチ結果を1つのJSON配列に結合 → `/tmp/contacts.json`

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/merge_prospects.py /tmp/candidates.json /tmp/contacts.json \
  | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/add_prospects.py data.db "$0"
```

マージは name + website_url のドメインで突き合わせる。連絡先が見つからなかった候補も（email=null等のまま）登録される。マージの未マッチ件数は stderr に出力される。

**サブエージェントの出力がそのまま add_prospects.py に渡せる形式の場合**（Phase 1 の全フィールド + 連絡先を含む完全なJSON）は、マージスクリプトを省略してそのまま渡してもよい:

```bash
cat <<'EOF' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/add_prospects.py data.db "$0"
[
  {
    "name": "営業先名（学校名・会社名等）",
    "organization_name": "正式法人名（check_corporate_number.pyの結果）",
    "corporate_number": "1234567890123",
    "department": null,
    "overview": "事業概要（1-2文）",
    "website_url": "https://example.com",
    "industry": "業種",
    "email": "info@example.com",
    "contact_form_url": null,
    "sns_accounts": {"x": "@account"},
    "match_reason": "ターゲットとして適切な理由（課題・ニーズ含む）",
    "priority": 3
  }
]
EOF
```

**organizations と prospects の役割の違い:**
- `organizations` = **法人**単位（法人番号が PK）。`check_corporate_number.py` で確認した正式法人名が自動登録される
- `prospects` = **営業先**単位。`name` には実際の営業先名を入れる。`department` は営業先の中の部署（あれば）

小さい会社の場合: org.name = pros.name（1対1、department は null）
学校法人の場合: org.name = 「学校法人片柳学園」、pros.name = 「日本工学院専門学校」（1対多もあり得る）
大企業の部署宛: org.name = 「株式会社○○」、pros.name = 「株式会社○○」、department = 「営業企画部」

```json
{
  "name": "日本工学院専門学校",
  "organization_name": "学校法人片柳学園",
  "corporate_number": "9010805001803",
  "department": null,
  ...
}
```

**各フィールド:**
- 必須: `name`（営業先名）, `organization_name`（正式法人名）, `corporate_number`（法人番号）, `overview`, `website_url`, `match_reason`
- 省略可: `department`, `industry`, `email`, `contact_form_url`, `sns_accounts`
- `priority`: 省略時デフォルト3

**スクリプトの動作:**
- 各エントリについて自動で重複チェックを行う（法人番号→email→フォームURL→SNS→名称→ドメインの順）
- corporate_number は必須。organizations テーブルに自動 upsert される
- email / contact_form_url はグローバル UNIQUE 制約で二重送信を防止
- `EXACT_MATCH`: 既存prospect_idを使い、project_prospectsへの紐付けのみ行う
- `POSSIBLE_MATCH`（ドメイン一致等）: 新規登録するが、出力に `possible_matches` として報告する
- マッチなし: 新規登録する
- 全件を1トランザクションで処理。個別エントリのバリデーションエラーは処理を継続するが、DB例外が発生した場合は全件ロールバックされる

**既存のprospectを別プロジェクトに紐付けるだけの場合:**

`existing_prospect_id` を指定すると、prospect新規登録をスキップして紐付けのみ行う:
```json
{"existing_prospect_id": 42, "match_reason": "理由", "priority": 2}
```

### 8. 結果レポート

DB登録後に reachable 件数を確認する:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/sales_queries.py data.db count-reachable "$0"
```

以下を報告する:
- 新規登録した営業先数 / 目標件数
- **reachable 内訳**（今回登録分のうち: email有 N件、form有 N件、SNSのみ N件、連絡先なし N件）
- 優先度別の内訳
- 重複で弾かれた件数（多かった場合、どのように探索アングルを変えたか簡潔に記載）
- プロジェクト全体の reachable 残数（count-reachable の結果）
- 次のステップとして `/outbound` の実行を案内する

### 9. 探索メモの更新

`$0/SEARCH_NOTES.md` を上書き更新する。以下の構成で、次回の探索に役立つ情報を簡潔に記録する:

```markdown
# 探索メモ
最終更新: YYYY-MM-DD

## 有用な情報源
- （まだ掘り切れていないポータルサイト・一覧ページのURL等）

## 前回の探索で使ったキーワード・アングル
- （今回使った主な検索キーワードとアプローチ）

## 次回に試すべき方向性
- （今回手が回らなかった探索方法、まだ見ていない地域・切り口等）

## 所感
- （重複が多かった方面、意外と見つかった方面など、次回に活かせる気づき）
```

上書き更新するが、`## evaluate からの探索ヒント` セクションが既に存在する場合はその内容を保持し、新しい SEARCH_NOTES.md の末尾に引き継ぐこと（evaluate が追記した反応パターン情報を消さないため）。
