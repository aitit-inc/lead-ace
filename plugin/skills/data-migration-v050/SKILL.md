---
name: data-migration-v050
description: "v0.5.0で追加されたorganizationsテーブルへの既存データ移行。organization_idがNULLのprospectsに法人番号を特定・紐づけする。一時スキル（v0.6.0で削除予定）。"
argument-hint: "[--limit N]"
---

## 概要

v0.5.0 で organizations テーブルを追加し、prospects に organization_id（法人番号FK）を必須化した。
このスキルは、**旧データ（organization_id が NULL の prospects）を新スキーマに移行する**ための一時的なスキル。

大量レコード処理のため、サブエージェントによるバッチ並列照合を行う。

## 手順

### 0. プリフライト

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/preflight.py data.db --migrate-only
```

### 1. 候補検索

法人番号候補を検索し、結果をファイルに保存する（メインコンテキスト圧迫を防止）:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/lookup_corporate_numbers.py data.db --limit <N> > /tmp/la_lookup.json 2>/dev/null
```

`--limit` はユーザー引数があればそれを使う。省略時は 5。

件数サマリーだけ取得してユーザーに報告する（JSON 全体を出力しない）:

```bash
python3 -c "import json; d=json.load(open('/tmp/la_lookup.json')); print(f'searched={d[\"searched\"]}, found={d[\"candidates_found\"]}, not_found={d[\"not_found\"]}, errors={d[\"errors\"]}')"
```

### 2. バッチ分割

`candidates_found` と `not_found` の両方を **20件ずつ** のバッチファイルに分割する:

```bash
python3 -c "
import json, math
data = json.load(open('/tmp/la_lookup.json'))
targets = [d for d in data['details'] if d['status'] in ('candidates_found', 'not_found')]
bs = 20
for i in range(0, len(targets), bs):
    with open(f'/tmp/la_batch_{i//bs}.json', 'w') as f:
        json.dump(targets[i:i+bs], f, ensure_ascii=False)
print(f'{len(targets)} prospects -> {math.ceil(len(targets)/bs)} batches')
"
```

### 3. バッチ照合（サブエージェントで並列実行）

各バッチファイルに対して **Agent tool** でサブエージェントを起動する。
**独立したバッチは1つのメッセージ内で複数の Agent tool call を発行し、並列実行すること。**

各サブエージェントのプロンプトとして、以下のテンプレートの `<BATCH_FILE>` を実際のパスに置き換えて渡す:

---

**↓ サブエージェントプロンプトテンプレート ↓**

```
法人番号の照合バッチを処理してください。

## 入力
Read tool で <BATCH_FILE> を読み、JSON 配列を取得する。
各エントリは以下のいずれか:
- candidates_found: {prospect_id, name, website_url, status: "candidates_found", candidates: [{number, name, reading, address}]}
- not_found: {prospect_id, name, website_url, status: "not_found"}

## 処理手順

### A. candidates_found エントリ

#### 自動確定（Web調査不要）
候補が1件のみで、以下を**全て**満たす場合はそのまま確定してよい:
- 候補の法人名と prospect の name が実質同一（全角半角・法人種別の位置違いは許容）
- 法人種別が prospect の業種と矛盾しない（例: 営業先が学校なのに候補が株式会社→矛盾）

#### 要調査
自動確定できない場合、以下で調査する:
1. fetch_url.py で prospect の website を確認:
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py --url "<website_url>" --prompt "この法人の正式名称、業種、所在地を抽出して"
2. 必要に応じて WebSearch で追加調査

#### 判定
- **確定**: 法人名・業種が整合 → confirmed に追加
- **スキップ**: 判断できない or 候補が無関係 → skipped に追加

### B. not_found エントリ

NTA 検索で見つからなかった営業先。以下の順で法人番号の特定を試みる:

1. **WebSearch**: 「<prospect名> 法人番号」や「<prospect名> 会社概要」で検索し、法人番号や正式法人名を探す
2. **fetch_url.py**: prospect の website_url から正式名称を取得し、それで再度 WebSearch
3. 上記で法人番号が判明した場合 → confirmed に追加
4. 特定できない場合 → skipped に追加（reason に試したことを簡潔に記載）

## 出力
処理完了後、以下の JSON 構造を**テキストとして**返すこと:

{
  "confirmed": [
    {
      "prospect_id": 42,
      "corporate_number": "1234567890123",
      "organization_name": "候補の name をそのまま使用",
      "address": "候補の address をそのまま使用"
    }
  ],
  "skipped": [
    {"prospect_id": 99, "status": "not_applicable", "reason": "個人事業主"}
  ]
}

### フィールド補足（confirmed）
- organization_name: 候補の name（国税庁公表サイトの名称）をそのまま使う
- name（省略可）: prospects.name を変更する場合のみ追加。例: organization_name="学校法人○○" で prospect が個別学校の場合 name="○○専門学校"
- department（省略可）: 部署を設定する場合のみ追加

### フィールド補足（skipped）
- status: "not_applicable"（法人番号が存在しない: 個人事業主、法人格なし、海外企業等）or "unresolvable"（検索したが特定できなかった: 同名多数、サイトアクセス不可等）
- reason: スキップ理由（簡潔に）

### 注意
- fetch_url.py は Jina Reader（20 RPM 制限）を使用する。大量にフェッチする場合はエラーハンドリングすること
- 自動確定できるものを先に処理し、要調査を後にまとめることで効率化する
```

**↑ サブエージェントプロンプトテンプレート ↑**

---

### 4. 結果集約・DB更新

全サブエージェントの `confirmed` 配列を結合し、`link_organization.py` で一括更新する:

```bash
echo '<merged_json>' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/link_organization.py data.db
```

### 5. スキップ済みのマーキング

全サブエージェントの `skipped` 配列を結合し、`mark_org_lookup_status.py` で再検索防止の印をつける。

```bash
echo '<skipped_json>' | python3 ${CLAUDE_PLUGIN_ROOT}/scripts/mark_org_lookup_status.py data.db
```

JSON 配列の各オブジェクト:

```json
{"prospect_id": 99, "status": "not_applicable", "reason": "個人事業主のため法人番号なし"}
```

status の使い分け:
- `not_applicable` — 法人番号が存在しない（個人事業主、法人格なし、海外企業等）
- `unresolvable` — 検索したが特定できなかった（同名多数、サイトアクセス不可等。後日リトライ可能）

### 6. 結果報告

ユーザーに報告する:

- 確定・更新した件数
- スキップした件数（not_applicable / unresolvable 内訳）
- 残りの未移行件数:

```bash
python3 -c "import sqlite3; c=sqlite3.connect('data.db'); print(c.execute('SELECT COUNT(*) FROM prospects WHERE organization_id IS NULL').fetchone()[0])"
```
