#!/usr/bin/env python3
"""Lead Ace DB 初期化スクリプト

Usage:
  init_db.py [db_path] [--register-project <project_id>]

DBスキーマを初期化し、オプションでプロジェクトを登録する。

Output (--register-project 指定時): JSON
  {"project_registered": true|false, "project_id": "..."}
"""

from __future__ import annotations

import argparse

from sales_db import error_exit, get_db_path, get_connection, get_schema_path, print_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Lead Ace DB 初期化。オプションでプロジェクト登録も行う。",
    )
    _ = parser.add_argument("db_path", nargs="?", default=None, help="SQLite データベースのパス（デフォルト: ./data.db）")
    _ = parser.add_argument("--register-project", help="初期化後にプロジェクトを登録する")
    return parser


def main() -> None:
    args = build_parser().parse_args()

    db_path = get_db_path(args.db_path)
    schema_path = get_schema_path()

    try:
        with open(schema_path) as f:
            schema_sql = f.read()
    except FileNotFoundError:
        error_exit(f"Schema file not found: {schema_path}")

    conn = get_connection(db_path)
    try:
        conn.executescript(schema_sql)

        project_id: str | None = args.register_project
        if project_id is not None:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO projects (id) VALUES (?)",
                (project_id,),
            )
            conn.commit()
            registered = cursor.rowcount > 0
            print_json({"project_registered": registered, "project_id": project_id})
        else:
            print(f"Database initialized: {db_path}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
