# LeadAce 対応環境

最終更新: 2026-04-28 / プラグイン版 0.5.38

LeadAce は Claude Code 向けプラグイン (slash commands + bundled remote MCP) として
開発・配布している。本書は他の AI エージェント環境からの利用可能性を、各社の公式
ドキュメント調査ベースで整理したもの。

## サマリ

| 環境 | プラグイン形式 | MCP 単体接続 | ローカル CLI ツール | 推奨度 |
|---|---|---|---|---|
| Claude Code | Yes | Yes | Yes | プライマリ |
| Claude Cowork | Yes (同一形式) | Yes | 不明（要検証） | セカンダリ（実機検証要） |
| ChatGPT デスクトップ | No (別形式) | 限定的 (Web 経由) | No | MCP のみ補助用途 |
| Codex CLI | No (別形式) | Yes | Yes | MCP は確実、skill 移植は別途 |

「ローカル CLI ツール」とは `fetch_url.py`（Web 取得、ローカル `python3` + `requests`）
など、ホスト OS 上の補助ツールを指す。
メール送信は SaaS（`mcp.leadace.ai` 経由 Gmail API）、フォーム送信と SNS DM は
`claude-in-chrome` MCP、返信確認は Gmail MCP（claude.ai 内蔵）に統合されている。
0.5.37 以前は `gog` と `playwright-cli` というローカル CLI に依存していたが、
それぞれ Gmail SaaS と claude-in-chrome に移行済み。

---

## 1. Claude Code（プライマリ環境）

公式に対応している一次ターゲット。

### インストール
```
/plugin marketplace add aitit-inc/lead-ace
/plugin install lead-ace@lead-ace
```

### MCP 接続
プラグイン同梱の `.mcp.json` で `https://mcp.leadace.ai/mcp` を自動登録。プラグイン
インストール時に MCP サーバーが自動的に有効化される。SaaS 利用者は環境変数設定不要。
セルフホスト勢は `LEADACE_MCP_URL` を export して上書き。

### 初回認証
最初に LeadAce ツール（例: `/setup`）を呼ぶと、ブラウザが開いて Supabase Auth で
OAuth サインイン。トークンはローカルにキャッシュされ、以降の呼び出しでは再認証不要。

### 提供スラッシュコマンド
`/setup`, `/strategy`, `/build-list`, `/outbound`, `/check-results`, `/evaluate`,
`/daily-cycle`, `/delete-project`

### ローカル依存
- `fetch_url.py`（Web 取得、Jina Reader + Haiku）— `/build-list`, `/strategy` で使用。
  実依存は `python3` + `requests` + `claude` CLI
- `claude-in-chrome` MCP（フォーム送信 + SNS DM）— `/outbound`, `/check-results`
- Gmail MCP（claude.ai 内蔵、返信確認）— `/check-results`

メール送信は SaaS 化済み（`mcp.leadace.ai` 経由）でローカル CLI 不要。

### 参考
- [README.md](../README.md) — ユーザー向け導入手順
- [plugin/README.md](../plugin/README.md) — プラグイン詳細
- [docs/self-host.md](./self-host.md) — セルフホスト手順

---

## 2. Claude Cowork（セカンダリ・実機検証要）

Anthropic が 2026-01 に研究プレビュー、2026-02 に GA した「knowledge work 向け
Claude Code」相当のデスクトップエージェント製品。Claude の有料プラン全般で利用可能。

### プラグイン形式
**Claude Code と同一のプラグインシステム**を採用。`.claude-plugin/plugin.json` +
`.mcp.json` + `skills/` のディレクトリ構造がそのまま機能する旨が公式ヘルプに明記
されている。LeadAce プラグインを別途リパッケージする必要はない見込み。

### MCP 接続
公式ヘルプによれば、Customize → Connectors から URL + OAuth Client ID/Secret で
リモート HTTP MCP サーバーを追加可能。`mcp.leadace.ai` のような公開エンドポイントは
そのまま使える。

### スラッシュコマンド UX
Cowork composer の `/` キーまたは `+` ボタンから、プラグイン内の skill を呼び出し
可能。Claude Code の `/build-list myproj` 体験と直接対応する。

### 制約と未確認事項
- Cowork のリモート MCP コネクタは Anthropic クラウドから接続するモデル。
  `mcp.leadace.ai` は公開エンドポイントなので問題ないが、もしユーザーがローカル
  バックエンドに向けたい場合は別ルートが必要。
- **ローカル CLI ツール（`fetch_url.py`）と `claude-in-chrome` MCP が Cowork
  デスクトップ環境で実行できるかは公式に明記なし**。Cowork が Claude Code 同等の
  Bash 実行モデルと Chrome 拡張連携を採用していれば動作する可能性が高いが、要実機検証。
- OAuth 2.1 / Dynamic Client Registration の詳細仕様は公式ヘルプに明示されておらず、
  `mcp.leadace.ai` 側の OAuth 実装と完全互換かは要動作確認。

### 参考
- [Use plugins in Claude Cowork](https://support.claude.com/en/articles/13837440-use-plugins-in-claude-cowork)
- [Custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [anthropic.com/product/claude-cowork](https://www.anthropic.com/product/claude-cowork)

---

## 3. ChatGPT デスクトップアプリ（MCP 部分のみ条件付き）

OpenAI の Apps SDK は MCP プロトコルをベースとしており、ChatGPT は MCP クライアント
として外部 MCP サーバーに接続できる。**ただし Claude Code 形式のプラグイン自体は
動作せず**、利用できるのは MCP 接続部分に限られる。

### プラグイン形式
**No.** Claude Code の plugin manifest や skill 形式は ChatGPT では認識されない。
Apps SDK は OpenAI 独自仕様。LeadAce を ChatGPT で使うには、Apps SDK ベースの
別パッケージを作る必要がある（現状未実施）。

### MCP 接続（Developer Mode 経由）
- Settings → Apps & Connectors → Advanced settings → **Developer mode** を有効化
  すると、任意の公開 HTTPS MCP エンドポイントを「Create」で登録可能
- 対応 transport: **Streamable HTTP（推奨）/ SSE**
- **OAuth 2.1 + Dynamic Client Registration 準拠** — `mcp.leadace.ai` の OAuth
  フローと互換性が見込める

### プラン制約
- Developer Mode: **Pro / Plus / Business / Enterprise / Edu** のベータ対象。Free 不可
- Team / Enterprise: ワークスペース管理者が Developer Mode を許可している必要あり
- 自分用接続は OpenAI 審査不要、公開アプリディレクトリ掲載は別途審査が必要

### デスクトップアプリでの動作
**「ChatGPT デスクトップアプリ」での Developer Mode UI 提供は公式ドキュメントに
明記なし**。公式ドキュメントは Web/Mobile クライアントのみ言及している。Web で
接続したコネクタが各クライアントへ反映される可能性はあるが、デスクトップで安定的
に使えるかは要動作確認。Web 経由が確実。

### スラッシュコマンドの代替
ChatGPT は LeadAce の skill (`/build-list` 等) を直接実行する仕組みを持たない。
MCP サーバーが公開する tool（`setup_project`, `record_outreach` 等）を ChatGPT が
チャット内で適宜呼び出す形になる。Claude Code/Cowork の「skill に複数ステップの
作業フローを記述しておく」構造は失われる。

### ローカル CLI ツール
**No.** ChatGPT のサンドボックス（および OpenAI クラウド）で実行されるため、ユーザー
ローカルの `fetch_url.py` や `claude-in-chrome` MCP は呼び出せない。メール送信は
SaaS 化されているので MCP 経由なら可能だが、「フォーム送信」「SNS DM」「Web ページ
取得」は事実上利用不可。

### 実用面での位置づけ
DB 操作・データ閲覧・テンプレート取得は MCP 経由で動くが、アウトバウンド実行ループ
は構成できない。Claude Code/Cowork で運用しつつ、補助的に「最近の outreach 状況を
見せて」「prospect 一覧を要約して」程度の問い合わせを ChatGPT で行う用途が現実的。

### 参考
- [Introducing apps in ChatGPT and the new Apps SDK](https://openai.com/index/introducing-apps-in-chatgpt/)
- [Connect from ChatGPT — Apps SDK](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
- [Developer mode, apps and full MCP connectors in ChatGPT (beta)](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)
- [MCP — Apps SDK](https://developers.openai.com/apps-sdk/concepts/mcp-server)

---

## 4. Codex CLI（MCP 接続は確実・skill 移植は別途）

OpenAI の TUI コーディングエージェント `openai/codex`（v0.125.0 ベース、2026-04-24）。
MCP クライアントとして HTTP / stdio の両 transport にネイティブ対応している。

### プラグイン形式
**No (別形式).** Codex は独自のプラグイン/skill システムを持つため、Claude Code 形式
の plugin は使えない。LeadAce の skill 群を Codex で動かすには、Codex 形式
（`~/.agents/skills/<name>/SKILL.md` 等）への移植が必要。

### MCP 接続（推奨パス: ネイティブ HTTP）
`~/.codex/config.toml` に以下のように記述:

```toml
[mcp_servers.leadace]
url = "https://mcp.leadace.ai/mcp"
scopes = ["read", "write"]                  # ← LeadAce MCP 側の scope に合わせる
oauth_resource = "https://mcp.leadace.ai"   # RFC 8707 resource indicator
```

- v0.125.0 以降で `url`, `scopes`, `oauth_resource`, `bearer_token_env_var`,
  `http_headers` フィールドが利用可能
- ただし MCP-spec の OAuth discovery dance (`/.well-known/oauth-protected-resource`,
  RFC 7591 Dynamic Client Registration, PKCE) を完全実装しているかは公式に
  明記なし。実機検証推奨

### MCP 接続（フォールバック: stdio プロキシ）
ネイティブ OAuth が不安定な場合、`mcp-remote` で stdio に変換して接続:

```toml
[mcp_servers.leadace]
command = "npx"
args = ["-y", "mcp-remote", "https://mcp.leadace.ai/mcp"]
```

`mcp-remote` がクライアント側で OAuth 2.1 discovery + PKCE を処理する。

### スラッシュコマンドの代替
- Codex には built-in slash commands（`/mcp`, `/model`, `/review`, `/compact`,
  `/fork` 等）はあるが、**ユーザー定義のカスタムスラッシュコマンドは公式ドキュメント
  で未確認**
- Codex skill 機能（`.agents/skills/`, `~/.agents/skills/`, `/etc/codex/skills/` の
  ディレクトリに `SKILL.md` を配置）は Claude Code skill と類似。LeadAce skill を
  この形式に書き換えれば再現可能性あり
- AGENTS.md を CLAUDE.md 相当として併用できる

### ローカル CLI ツール
**Yes（部分的）.** Codex はローカル shell 実行が可能なので `fetch_url.py` は問題
なく利用可能。`claude-in-chrome` MCP は Chrome 拡張に依存するため、Codex CLI から
は使えない（フォーム送信 / SNS DM はカバー外）。メール送信は SaaS 化されているので
MCP 経由なら問題なし。

### 実用面での位置づけ
MCP 接続と shell 実行が両方できるので、機能的には Claude Code に最も近い。skill
の Codex 形式への移植コストさえ払えば、ほぼ同等の運用が可能。Claude Code 既存
ユーザーが Codex に乗り換える場合の現実的な移行先候補。

### 参考
- [openai/codex GitHub](https://github.com/openai/codex)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
- [Codex skills](https://developers.openai.com/codex/skills)
- [Codex slash commands](https://developers.openai.com/codex/cli/slash-commands)

---

## 結論と方針

LeadAce のターゲットは **Claude Code が一次、Claude Cowork が二次**。Cowork は同じ
プラグインフォーマットを採用しているため、Claude Code 向けに保守するコードがその
まま流用できる見込み。実機検証で「ローカル CLI ツールが動くか」を確認する作業は
別途必要。

**ChatGPT デスクトップ / Codex CLI** は MCP サーバーを共通インターフェースとして
「サブクライアント」化できる余地はあるが、skill / slash command 体験を再現するに
は各プラットフォーム固有の作業が必要になる。当面は公式サポートの優先度を下げ、
ユーザー需要が顕在化した段階で対応を検討する。

セルフホスト/エンタープライズ用途で別クライアントを使いたい場合は、`mcp.leadace.ai`
（または各自の自前デプロイ）の MCP サーバーが OAuth 2.1 + Streamable HTTP に
準拠している点が共通の出発点となる。

### 関連ドキュメント
- [docs/self-host.md](./self-host.md) — セルフホスト手順
- [docs/deploy.md](./deploy.md) — 本番デプロイ runbook
- [CLAUDE.md](../CLAUDE.md) — プラグイン規約・データ分離・プラン階層
