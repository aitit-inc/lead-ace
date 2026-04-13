#!/usr/bin/env python3
"""Lead Ace DB initialization script

Usage:
  init_db.py [db_path] [--register-project <project_id>]

Initializes the DB schema and optionally registers a project.

Output (when --register-project is specified): JSON
  {"project_registered": true|false, "project_id": "..."}
"""

from __future__ import annotations

import argparse

from sales_db import error_exit, get_db_path, get_connection, get_schema_path, print_json


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Initialize the Lead Ace DB. Optionally register a project.",
    )
    _ = parser.add_argument("db_path", nargs="?", default=None, help="Path to the SQLite database (default: ./data.db)")
    _ = parser.add_argument("--register-project", help="Register a project after initialization")
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
