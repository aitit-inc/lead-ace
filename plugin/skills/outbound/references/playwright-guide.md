# playwright-cli Browser Automation Guide

Used for browser operations such as form submission and SNS DMs. All executed as Bash commands.

## Quick start

```bash
# Open browser
playwright-cli open
# Navigate to page
playwright-cli goto https://example.com
# Use snapshot to get page structure (check element refs)
playwright-cli snapshot
# Use refs to interact
playwright-cli click e15
playwright-cli fill e5 "input text"
playwright-cli press Enter
# Close browser
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
# --submit presses Enter after input
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

Use the `--raw` option to get results without page status and snapshot headers.

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
# Specify browser
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox

# Persistent profile (preserves login state)
playwright-cli open --persistent
playwright-cli open --profile=/path/to/profile

# Connect to existing browser
playwright-cli attach --extension

playwright-cli close
playwright-cli delete-data
```

## Snapshots

After each command, a snapshot is automatically returned. Snapshots include element refs (e1, e5, etc.) that are used for interactions.

```bash
> playwright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

Take a snapshot manually:

```bash
playwright-cli snapshot
# Specific element only
playwright-cli snapshot "#main"
# Limit depth (efficient for large pages)
playwright-cli snapshot --depth=4
playwright-cli snapshot e34
```

## Targeting elements

Using snapshot refs is the standard approach:

```bash
playwright-cli snapshot
playwright-cli click e15
```

CSS selectors and Playwright locators also work:

```bash
playwright-cli click "#main > button.submit"
playwright-cli click "getByRole('button', { name: 'Submit' })"
playwright-cli click "getByTestId('submit-button')"
```

## Browser Sessions

```bash
# Named sessions (persistent profiles)
playwright-cli -s=mysession open example.com --persistent
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close

# List sessions
playwright-cli list
# Close all browsers
playwright-cli close-all
playwright-cli kill-all
```
