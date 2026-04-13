#!/usr/bin/env python3
"""ライセンス管理モジュール

~/.leadace/ にグローバル状態を保存し、無料（1プロジェクト）と有料（無制限）を管理する。

CLI:
    python3 license.py save-key "LEADACE-XXXX-XXXX-XXXX-XXXX"
    python3 license.py is-paid
    python3 license.py check-can-add "/abs/path"
    python3 license.py register "/abs/path"
    python3 license.py unregister "/abs/path"
    python3 license.py check-registered "/abs/path"
    python3 license.py list-projects
"""

import hashlib
import os
import sys
import fcntl
from pathlib import Path

# SHA-512ハッシュ（正解キーのハッシュ。キー自体はコードに含めない）
VALID_KEY_HASH = "44192c18c9d9c4d4195f77a204036fcefe7d3b5a556c5230bdf1c2549e663c523bf2e9fc59a71d75c7b4a6477044c8472a7c2f1b6a9e0201aa048746288650bc"

LEADACE_DIR = Path.home() / ".leadace"
PKEY_FILE = LEADACE_DIR / "pkey"
PROJECTS_FILE = LEADACE_DIR / "projects"


def ensure_leadace_dir():
    """~/.leadace/ ディレクトリがなければ作成"""
    LEADACE_DIR.mkdir(parents=True, exist_ok=True)


def save_key(key: str) -> bool:
    """キーを ~/.leadace/pkey に保存。有効ならTrue"""
    if not validate_key(key):
        return False
    ensure_leadace_dir()
    with open(PKEY_FILE, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(key.strip())
        fcntl.flock(f, fcntl.LOCK_UN)
    return True


def validate_key(key: str) -> bool:
    """キーのSHA-512ハッシュをハードコードされた正解ハッシュと比較"""
    h = hashlib.sha512(key.strip().encode()).hexdigest()
    return h == VALID_KEY_HASH


def is_paid() -> bool:
    """~/.leadace/pkey が存在し、中身のキーが有効ならTrue"""
    if not PKEY_FILE.exists():
        return False
    try:
        with open(PKEY_FILE, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            key = f.read().strip()
            fcntl.flock(f, fcntl.LOCK_UN)
        return validate_key(key)
    except (IOError, OSError):
        return False


def register_project(project_path: str) -> str:
    """プロジェクトの絶対パスを ~/.leadace/projects に追記（重複・ライセンスチェックあり）
    Returns: "REGISTERED" / "ALREADY_REGISTERED" / "FREE_LIMIT"
    """
    ensure_leadace_dir()
    path = os.path.abspath(project_path)
    # 読み取りと書き込みを同一ロック内で行い、TOCTOU競合を防ぐ
    with open(PROJECTS_FILE, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        lines = f.readlines()
        projects = [l.strip() for l in lines if l.strip()]
        if path in projects:
            return "ALREADY_REGISTERED"
        if not is_paid() and len(projects) >= 1:
            return "FREE_LIMIT"
        f.write(path + "\n")
    return "REGISTERED"


def unregister_project(project_path: str) -> bool:
    """プロジェクトの絶対パスを ~/.leadace/projects から削除。成功したらTrue"""
    if not PROJECTS_FILE.exists():
        return False
    path = os.path.abspath(project_path)
    with open(PROJECTS_FILE, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        lines = f.readlines()
        new_lines = [l for l in lines if l.strip() != path]
        if len(new_lines) == len(lines):
            fcntl.flock(f, fcntl.LOCK_UN)
            return False
        f.seek(0)
        f.truncate()
        f.writelines(new_lines)
        fcntl.flock(f, fcntl.LOCK_UN)
    return True


def list_projects() -> list[str]:
    """~/.leadace/projects から全プロジェクトパスをリストで返す"""
    if not PROJECTS_FILE.exists():
        return []
    try:
        with open(PROJECTS_FILE, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            lines = f.readlines()
            fcntl.flock(f, fcntl.LOCK_UN)
        return [l.strip() for l in lines if l.strip()]
    except (IOError, OSError):
        return []


def can_add_project(project_path: str) -> str:
    """プロジェクト追加可否を判定
    Returns: "PAID" / "FREE_OK" / "FREE_LIMIT" / "ALREADY_REGISTERED"
    """
    path = os.path.abspath(project_path)
    projects = list_projects()
    if path in projects:
        return "ALREADY_REGISTERED"
    if is_paid():
        return "PAID"
    if len(projects) == 0:
        return "FREE_OK"
    return "FREE_LIMIT"


def check_project_registered(project_path: str) -> bool:
    """指定パスが ~/.leadace/projects に登録済みかどうか"""
    path = os.path.abspath(project_path)
    return path in list_projects()


# --- CLI ---

def main():
    if len(sys.argv) < 2:
        print("Usage: license.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "save-key":
        if len(sys.argv) < 3:
            print("Usage: license.py save-key <key>", file=sys.stderr)
            sys.exit(1)
        if save_key(sys.argv[2]):
            print("VALID")
        else:
            print("INVALID")

    elif cmd == "is-paid":
        print("PAID" if is_paid() else "FREE")

    elif cmd == "check-can-add":
        if len(sys.argv) < 3:
            print("Usage: license.py check-can-add <path>", file=sys.stderr)
            sys.exit(1)
        print(can_add_project(sys.argv[2]))

    elif cmd == "register":
        if len(sys.argv) < 3:
            print("Usage: license.py register <path>", file=sys.stderr)
            sys.exit(1)
        print(register_project(sys.argv[2]))

    elif cmd == "unregister":
        if len(sys.argv) < 3:
            print("Usage: license.py unregister <path>", file=sys.stderr)
            sys.exit(1)
        if unregister_project(sys.argv[2]):
            print("UNREGISTERED")
        else:
            print("NOT_FOUND")

    elif cmd == "check-registered":
        if len(sys.argv) < 3:
            print("Usage: license.py check-registered <path>", file=sys.stderr)
            sys.exit(1)
        print("OK" if check_project_registered(sys.argv[2]) else "NOT_REGISTERED")

    elif cmd == "list-projects":
        for p in list_projects():
            print(p)

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
