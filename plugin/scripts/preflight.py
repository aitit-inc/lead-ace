#!/usr/bin/env python3
"""Preflight チェック — 全スキル実行前に呼び出す共通前処理

1. プロジェクト登録チェック (license.py の check-registered 相当)
2. DBマイグレーション適用 (migrations/ 内の未適用スクリプトを順に実行)

CLI:
    python3 preflight.py <db_path> <project_id>

出力 (JSON):
    成功: {"status": "ok", "migrations_applied": ["001_xxx", ...]}
    失敗: {"status": "error", "error": "...", "message": "..."}
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sqlite3
import sys
from pathlib import Path

from license import check_project_registered
from sales_db import get_connection, print_json


MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


# ---------------------------------------------------------------------------
# マイグレーション
# ---------------------------------------------------------------------------

def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    """applied_migrations テーブルがなければ作成する。"""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS applied_migrations ("
        "  id TEXT PRIMARY KEY,"
        "  applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        ")"
    )
    conn.commit()


def _get_applied_ids(conn: sqlite3.Connection) -> set[str]:
    """適用済みマイグレーション ID のセットを返す。"""
    rows = conn.execute("SELECT id FROM applied_migrations").fetchall()
    return {str(row[0]) for row in rows}


def _discover_migrations() -> list[tuple[str, Path]]:
    """migrations/ から NNN_*.py を番号順で返す。"""
    if not MIGRATIONS_DIR.is_dir():
        return []
    return [
        (f.stem, f)
        for f in sorted(MIGRATIONS_DIR.iterdir())
        if f.suffix == ".py" and f.name[0].isdigit()
    ]


def _run_one(conn: sqlite3.Connection, migration_id: str, file_path: Path) -> None:
    """マイグレーション 1 件を実行し applied_migrations に記録する。

    各マイグレーションは冪等に書くこと（IF NOT EXISTS 等を使用）。
    失敗時は例外を投げ、applied_migrations には記録されない。
    """
    spec = importlib.util.spec_from_file_location(migration_id, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"マイグレーション {file_path} の読み込みに失敗")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    up_fn = getattr(module, "up", None)
    if not callable(up_fn):
        raise AttributeError(
            f"マイグレーション {migration_id} に callable な up() がありません"
        )
    up_fn(conn)

    conn.execute("INSERT INTO applied_migrations (id) VALUES (?)", (migration_id,))
    conn.commit()


def apply_pending(conn: sqlite3.Connection) -> list[str]:
    """未適用マイグレーションを順に実行し、適用した ID リストを返す。"""
    _ensure_migrations_table(conn)
    applied = _get_applied_ids(conn)
    applied_now: list[str] = []
    for mid, path in _discover_migrations():
        if mid not in applied:
            _run_one(conn, mid, path)
            applied_now.append(mid)
    return applied_now


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight チェック")
    parser.add_argument("db_path", help="SQLite データベースのパス")
    parser.add_argument("project_id", nargs="?", default=None, help="プロジェクト ID（--migrate-only 時は不要）")
    parser.add_argument("--migrate-only", action="store_true", help="マイグレーションのみ実行（プロジェクト登録チェックをスキップ）")
    args = parser.parse_args()

    db_path: str = args.db_path
    project_id: str | None = args.project_id

    if not args.migrate_only:
        if not project_id:
            print_json({
                "status": "error",
                "error": "MISSING_PROJECT_ID",
                "message": "project_id を指定してください（または --migrate-only を使用）。",
            })
            sys.exit(1)

        # 1. プロジェクト登録チェック
        project_path = os.path.join(os.getcwd(), project_id)
        if not check_project_registered(project_path):
            print_json({
                "status": "error",
                "error": "NOT_REGISTERED",
                "message": f"このプロジェクトはセットアップされていません。"
                           f"先に /setup {project_id} を実行してください。",
            })
            sys.exit(1)

    # 2. DB 存在チェック
    if not os.path.exists(db_path):
        print_json({
            "status": "error",
            "error": "DB_NOT_FOUND",
            "message": f"データベース {db_path} が見つかりません。",
        })
        sys.exit(1)

    # 3. マイグレーション適用
    conn = get_connection(db_path)
    applied: list[str] = []
    try:
        applied = apply_pending(conn)
    except Exception as e:
        print_json({
            "status": "error",
            "error": "MIGRATION_FAILED",
            "message": str(e),
        })
        sys.exit(1)
    finally:
        conn.close()

    print_json({
        "status": "ok",
        "migrations_applied": applied,
    })


if __name__ == "__main__":
    main()
