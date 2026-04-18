#!/bin/bash
# ============================================================
# LeadAce セットアップスクリプト
# macOS 環境に必要なツールを一括インストールします
# ============================================================
set -e

# --- カラー出力 ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✔${NC}  $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}✖${NC}  $1"; }
header()  { echo -e "\n${BOLD}── $1 ──${NC}"; }

# --- Homebrew ---
header "Homebrew"
if command -v brew &>/dev/null; then
  success "Homebrew は既にインストール済みです ($(brew --version | head -1))"
else
  info "Homebrew をインストールします..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon の場合 PATH に追加
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
  success "Homebrew をインストールしました"
fi

# --- Git ---
header "Git"
if command -v git &>/dev/null; then
  success "Git は既にインストール済みです ($(git --version))"
else
  info "Git をインストールします..."
  brew install git
  success "Git をインストールしました"
fi

# --- Python3 ---
header "Python3"
if command -v python3 &>/dev/null; then
  success "Python3 は既にインストール済みです ($(python3 --version))"
else
  info "Python3 をインストールします..."
  brew install python3
  success "Python3 をインストールしました"
fi

# --- SQLite3 ---
header "SQLite3"
if command -v sqlite3 &>/dev/null; then
  success "SQLite3 は既にインストール済みです ($(sqlite3 --version | head -1))"
else
  info "SQLite3 をインストールします..."
  brew install sqlite
  success "SQLite3 をインストールしました"
fi

# --- gog CLI ---
header "gog CLI (Google API ツール)"
if command -v gog &>/dev/null; then
  success "gog は既にインストール済みです ($(gog --version 2>/dev/null || echo 'version unknown'))"
else
  info "gog をインストールします..."
  brew install gogcli
  success "gog をインストールしました"
fi

# --- Claude Code CLI (オプション) ---
header "Claude Code CLI"
if command -v claude &>/dev/null; then
  success "Claude Code CLI は既にインストール済みです ($(claude --version 2>/dev/null || echo 'version unknown'))"
else
  info "Claude Code CLI をインストールします..."
  brew install claude-code
  success "Claude Code CLI をインストールしました"
fi

# --- GitHub CLI (推奨) ---
header "GitHub CLI（データのクラウドバックアップ用・推奨）"
if command -v gh &>/dev/null; then
  success "GitHub CLI は既にインストール済みです ($(gh --version | head -1))"
else
  info "GitHub CLI をインストールします..."
  brew install gh
  success "GitHub CLI をインストールしました"
fi

# --- GitHub SSH 接続（推奨） ---
header "GitHub SSH 接続（推奨）"
if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  success "GitHub に SSH 接続済みです"
else
  SSH_KEY="$HOME/.ssh/id_ed25519_leadace_github"

  # SSH キー生成
  if [[ -f "$SSH_KEY" ]]; then
    success "SSH キーは既に存在します ($SSH_KEY)"
  else
    info "SSH キーを生成します..."
    echo ""
    read -p "  GitHub に登録しているメールアドレスを入力してください: " GH_EMAIL < /dev/tty
    if [[ -z "$GH_EMAIL" ]]; then
      warn "メールアドレスが未入力のため、GitHub 連携をスキップします"
    else
      mkdir -p "$HOME/.ssh"
      ssh-keygen -t ed25519 -C "$GH_EMAIL" -f "$SSH_KEY" -N ""
      eval "$(ssh-agent -s)" &>/dev/null
      ssh-add "$SSH_KEY" 2>/dev/null
      if ! grep -q "id_ed25519_leadace_github" "$HOME/.ssh/config" 2>/dev/null; then
        echo "" >> "$HOME/.ssh/config"
        echo "Host github.com" >> "$HOME/.ssh/config"
        echo "  IdentityFile $SSH_KEY" >> "$HOME/.ssh/config"
        echo "  AddKeysToAgent yes" >> "$HOME/.ssh/config"
      fi
      success "SSH キーを生成しました"
    fi
  fi

  # GitHub CLI でログイン & SSH キー登録
  if command -v gh &>/dev/null && [[ -f "${SSH_KEY}.pub" ]]; then
    if ! gh auth status &>/dev/null 2>&1; then
      echo ""
      info "GitHub にログインします（ブラウザが開きます）..."
      gh auth login -p ssh -w < /dev/tty
    fi

    # admin:public_key スコープが必要 — なければ取得
    if ! gh ssh-key list &>/dev/null; then
      info "SSH キー登録のための権限を追加します（ブラウザが開きます）..."
      gh auth refresh -h github.com -s admin:public_key < /dev/tty
    fi

    KEY_FINGERPRINT=$(ssh-keygen -lf "${SSH_KEY}.pub" | awk '{print $2}')
    if gh ssh-key list 2>/dev/null | grep -q "$KEY_FINGERPRINT"; then
      success "SSH キーは既に GitHub に登録済みです"
    else
      info "SSH 公開鍵を GitHub に登録します..."
      gh ssh-key add "${SSH_KEY}.pub" -t "LeadAce-$(hostname -s)"
      success "SSH キーを GitHub に登録しました"
    fi
  fi
fi

# --- 完了 ---
echo ""
echo -e "${BOLD}============================================${NC}"
echo -e "${GREEN}${BOLD}  ツールのインストールが完了しました！${NC}"
echo -e "${BOLD}============================================${NC}"
echo ""
echo "次のステップ:"
echo "  1. Cursor をインストール（まだの場合）"
echo "  2. Google Cloud Console で OAuth 設定"
echo "  3. gog auth credentials <JSONファイル>"
echo "  4. gog auth add <メールアドレス>"
echo "  5. Claude.ai で Gmail Connector を接続"
echo "  6. Chrome に Claude 拡張をインストール"
echo "  7. Claude Code でプラグインをインストール"
echo ""
echo "詳しくは setup-guide.html を参照してください。"
