# playwright-cli ブラウザ操作ガイド

フォーム送信・SNS DM等のブラウザ操作に使用する。全て Bash コマンドとして実行する。

## Quick start

```bash
# ブラウザを開く
playwright-cli open
# ページに移動
playwright-cli goto https://example.com
# snapshot でページ構造を取得（要素の ref を確認）
playwright-cli snapshot
# ref を使って操作
playwright-cli click e15
playwright-cli fill e5 "入力テキスト"
playwright-cli press Enter
# ブラウザを閉じる
playwright-cli close
```

## Commands

### Core

```bash
playwright-cli open
playwright-cli open https://example.com/
playwright-cli goto https://example.com
playwright-cli type "search query"
playwright-cli click e3
playwright-cli dblclick e7
# --submit は入力後に Enter を押す
playwright-cli fill e5 "user@example.com" --submit
playwright-cli drag e2 e8
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli upload ./document.pdf
playwright-cli check e12
playwright-cli uncheck e12
playwright-cli snapshot
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
playwright-cli eval "el => el.id" e5
playwright-cli eval "el => el.getAttribute('data-testid')" e5
playwright-cli dialog-accept
playwright-cli dialog-accept "confirmation text"
playwright-cli dialog-dismiss
playwright-cli resize 1920 1080
playwright-cli close
```

### Navigation

```bash
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
```

### Keyboard

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli keydown Shift
playwright-cli keyup Shift
```

### Mouse

```bash
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mouseup
playwright-cli mousewheel 0 100
```

### Screenshot

```bash
playwright-cli screenshot
playwright-cli screenshot e5
playwright-cli screenshot --filename=page.png
```

### Tabs

```bash
playwright-cli tab-list
playwright-cli tab-new
playwright-cli tab-new https://example.com/page
playwright-cli tab-close
playwright-cli tab-select 0
```

### Storage

```bash
playwright-cli state-save
playwright-cli state-save auth.json
playwright-cli state-load auth.json

# Cookies
playwright-cli cookie-list
playwright-cli cookie-list --domain=example.com
playwright-cli cookie-get session_id
playwright-cli cookie-set session_id abc123
playwright-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
playwright-cli cookie-delete session_id
playwright-cli cookie-clear

# LocalStorage
playwright-cli localstorage-list
playwright-cli localstorage-get theme
playwright-cli localstorage-set theme dark
playwright-cli localstorage-delete theme
playwright-cli localstorage-clear

# SessionStorage
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get step
playwright-cli sessionstorage-set step 3
playwright-cli sessionstorage-delete step
playwright-cli sessionstorage-clear
```

### DevTools

```bash
playwright-cli console
playwright-cli console warning
playwright-cli network
```

## Raw output

`--raw` オプションでページステータス・snapshot を除いた結果のみ取得する。

```bash
playwright-cli --raw eval "JSON.stringify(performance.timing)" | jq '.loadEventEnd - .navigationStart'
playwright-cli --raw eval "JSON.stringify([...document.querySelectorAll('a')].map(a => a.href))" > links.json
playwright-cli --raw snapshot > before.yml
playwright-cli click e5
playwright-cli --raw snapshot > after.yml
diff before.yml after.yml
```

## Open parameters

```bash
# ブラウザ指定
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox

# 永続プロファイル（ログイン状態を保持）
playwright-cli open --persistent
playwright-cli open --profile=/path/to/profile

# 既存ブラウザに接続
playwright-cli attach --extension

playwright-cli close
playwright-cli delete-data
```

## Snapshots

各コマンド実行後に自動で snapshot が返る。snapshot には要素の ref（e1, e5 等）が含まれ、これを使って操作する。

```bash
> playwright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

手動で snapshot を取得:

```bash
playwright-cli snapshot
# 特定要素のみ
playwright-cli snapshot "#main"
# 深さ制限（大きいページで効率化）
playwright-cli snapshot --depth=4
playwright-cli snapshot e34
```

## Targeting elements

snapshot の ref を使うのが基本:

```bash
playwright-cli snapshot
playwright-cli click e15
```

CSS セレクタや Playwright locator も使用可:

```bash
playwright-cli click "#main > button.submit"
playwright-cli click "getByRole('button', { name: 'Submit' })"
playwright-cli click "getByTestId('submit-button')"
```

## Browser Sessions

```bash
# 名前付きセッション（永続プロファイル）
playwright-cli -s=mysession open example.com --persistent
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close

# セッション一覧
playwright-cli list
# 全ブラウザを閉じる
playwright-cli close-all
playwright-cli kill-all
```
