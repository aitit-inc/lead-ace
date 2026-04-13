# 問い合わせフォーム入力手順

playwright-cli を使ってフォーム入力・送信を行い、結果をログに記録する。

**重要: フォーム送信は1回のみ。** 送信ボタンのクリック後、いかなる理由でもリトライしない。network コマンドで送信成否を確認する。

## 基本フロー

```bash
# 1. ブラウザを開いてフォームに移動
playwright-cli open <フォームURL>

# 2. snapshot でフォーム構造を把握
playwright-cli snapshot

# 3. 各フィールドに入力（ref を使用）
playwright-cli fill e5 "株式会社〇〇"
playwright-cli fill e8 "山田太郎"
playwright-cli fill e12 "info@example.com"
playwright-cli select e15 "サービスのご提案"
playwright-cli fill e20 "<本文>"

# 4. 送信ボタンをクリック
playwright-cli click e25

# 5. 送信完了を確認（後述の「送信完了の判定」を参照）

# 6. ブラウザを閉じる
playwright-cli close
```

## 営業お断りチェック（セーフティネット）

フォームページの snapshot を取得した際に、ページ内に「営業お断り」「営業目的のお問い合わせはご遠慮ください」「セールスお断り」等の記載がないか確認する。**発見した場合はフォーム送信を中止**し、以下を実行して次の営業先に進む:

```bash
playwright-cli close

python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
  --project "$PROJECT_ID" --prospect-id $PROSPECT_ID --log-only \
  --channel form --subject "" --body "" \
  --status failed --error-message "営業お断りの記載あり"

python3 ${CLAUDE_PLUGIN_ROOT}/scripts/update_status.py data.db \
  --project "$PROJECT_ID" --prospect-id $PROSPECT_ID --status unreachable \
  --do-not-contact --dnc-reason "営業お断りの記載あり（フォームページ）"
```

## フォーム入力の方針

- フォームの項目に合わせてメッセージを適切に分割する
- 「お問い合わせ種別」がある場合は「サービスのご提案」「業務提携のご相談」等を選択
- 組織名・氏名・メールアドレス・電話番号等の基本情報は BUSINESS.md から取得
- 自由記述欄にはメールと同様の方針でカスタマイズしたメッセージを入力（ただしフォーム用に簡潔に）
- チェックボックス（プライバシーポリシー同意等）は `playwright-cli check <ref>` で操作

## 送信完了の判定（必須）

送信ボタンクリック後、以下の順序で送信完了を判定する。**判定完了まで再送信は絶対にしない。**

### ステップ1: snapshot でページ変化を確認

```bash
playwright-cli snapshot
```

以下のいずれかが確認できれば **送信成功**:
- サンクスページ（「お問い合わせありがとうございます」等）が表示されている
- URL がサンクスページに遷移している（`/thanks`, `/complete` 等）
- フォームが消えて完了メッセージが表示されている
- 「送信しました」等の成功メッセージが表示されている

### ステップ2: snapshot で判断できない場合、network を確認

```bash
playwright-cli network
```

network の出力で POST リクエストを探す:
- フォームURLまたは関連エンドポイントへの POST がある → **送信成功**（サーバーに到達済み）
- POST のステータスが 200 / 302 → **送信成功**
- POST が見つからない → **送信失敗**（ボタンクリックがフォーム送信をトリガーしなかった可能性）

### 判定結果に応じた処理

**送信成功の場合:**

```bash
playwright-cli close

python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
  --project "$PROJECT_ID" --prospect-id $PROSPECT_ID --log-only \
  --channel form --subject "<件名>" --body "<本文>"
```

**送信失敗の場合（POST が確認できない場合のみ）:**

```bash
playwright-cli close

python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
  --project "$PROJECT_ID" --prospect-id $PROSPECT_ID --log-only \
  --channel form --subject "<件名>" --body "<本文>" \
  --status failed --error-message "<理由>"
```

**重要:** 失敗の場合でもそのフォームへの再送信は行わない。次の営業先に進む。

## エラーハンドリング

- **フォームが見つからない場合:** snapshot でフォーム要素がない → `status = 'failed'`, `error_message` を記録
- **入力バリデーションエラー:** snapshot でエラーメッセージを確認し、修正して再送信を **1回だけ** 試みる。修正送信も network で確認する
- **ページ読み込みタイムアウト:** `status = 'failed'` で記録し次へ

### reCAPTCHA / hCaptcha 等がある場合

フォームに reCAPTCHA、hCaptcha、Turnstile 等の CAPTCHA が設置されている場合（snapshot で検出）、フォーム送信はスキップする:

```bash
playwright-cli close

python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
  --project "$PROJECT_ID" --prospect-id $PROSPECT_ID --log-only \
  --channel form --subject "" --body "" \
  --status failed --error-message "reCAPTCHAによりスキップ"
```

- `project_prospects.status` は **`new` のまま維持**する（フォーム改修で CAPTCHA が外れる可能性があるため）
- 他チャネル（メール・SNS）が利用可能ならそちらを試す

### Google Forms の場合

Google Forms はブラウザ UI 操作ではなく、`formResponse` エンドポイントへの直接 POST で送信する。成功率が高く（UI 操作不要・CAPTCHA なし）、コンテキスト消費も最小限。ブラウザを開く必要はない。

**検出方法:**
- URL に `docs.google.com/forms` を含む
- ページソースに `FB_PUBLIC_LOAD_DATA_` が存在する

**送信手順:**

1. **フォームページの生 HTML を取得し、フォーム ID と entry ID を抽出する**

   `--raw` フラグで生 HTML を取得する（Jina Reader 経由だとフォームデータが除去されるため）:

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/fetch_url.py \
     --url "https://docs.google.com/forms/d/{FORM_ID}/viewform" \
     --prompt "このGoogle Formsのentry IDを全て抽出してください。FB_PUBLIC_LOAD_DATA_ 内のフィールド定義から、各フィールドのラベルとentry.XXXXXXX形式のIDを対応付けて返してください。選択式になっている項目については選択肢一覧と選択するためのIDもつけてください。" \
     --raw --timeout 20
   ```

   - フォーム ID: URL の `/forms/d/{FORM_ID}/` 部分から取得
   - entry ID: `--raw` により生 HTML が Haiku に渡され、`FB_PUBLIC_LOAD_DATA_` からフィールドラベルと entry ID の対応を抽出

3. **formResponse エンドポイントに POST する**

   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     -X POST "https://docs.google.com/forms/d/{FORM_ID}/formResponse" \
     -d "entry.XXXXXXX=値1&entry.YYYYYYY=値2&entry.ZZZZZZZ=値3"
   ```

   - HTTP 200 が返れば送信成功
   - リダイレクト（302 → 確認ページ）も成功

4. **ログ記録**

   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/send_and_log.py data.db \
     --project "$PROJECT_ID" --prospect-id $PROSPECT_ID --log-only \
     --channel form --subject "<件名>" --body "<本文>"
   ```

**注意:**
- Google Forms はフィールドの並び順と entry ID の対応が自明でないことがある。ページソースのフィールド定義（ラベルテキスト）と照合して正しい entry ID にマッピングすること
- `emailAddress` パラメータが必要なフォーム（メール収集が有効化されている場合）もある
