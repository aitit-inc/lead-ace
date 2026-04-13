#!/usr/bin/env python3
"""Preflight check — common pre-processing called before all skill execution

1. Project registration check (equivalent to license.py check-registered)
2. DB migration application (run pending scripts in migrations/ in order)

CLI:
    python3 preflight.py <db_path> <project_id>

Output (JSON):
    Success: {"status": "ok", "migrations_applied": ["001_xxx", ...]}
    Failure: {"status": "error", "error": "...", "message": "..."}
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
# Migrations
# ---------------------------------------------------------------------------

def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    """Create the applied_migrations table if it does not exist."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS applied_migrations ("
        "  id TEXT PRIMARY KEY,"
        "  applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))"
        ")"
    )
    conn.commit()


def _get_applied_ids(conn: sqlite3.Connection) -> set[str]:
    """Return the set of already-applied migration IDs."""
    rows = conn.execute("SELECT id FROM applied_migrations").fetchall()
    return {str(row[0]) for row in rows}


def _discover_migrations() -> list[tuple[str, Path]]:
    """Return NNN_*.py files from migrations/ sorted by number."""
    if not MIGRATIONS_DIR.is_dir():
        return []
    return [
        (f.stem, f)
        for f in sorted(MIGRATIONS_DIR.iterdir())
        if f.suffix == ".py" and f.name[0].isdigit()
    ]


def _run_one(conn: sqlite3.Connection, migration_id: str, file_path: Path) -> None:
    """Run one migration and record it in applied_migrations.

    Each migration must be written idempotently (use IF NOT EXISTS, etc.).
    On failure, raise an exception; the migration will not be recorded in applied_migrations.
    """
    spec = importlib.util.spec_from_file_location(migration_id, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Failed to load migration {file_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    up_fn = getattr(module, "up", None)
    if not callable(up_fn):
        raise AttributeError(
            f"Migration {migration_id} does not have a callable up()"
        )
    up_fn(conn)

    conn.execute("INSERT INTO applied_migrations (id) VALUES (?)", (migration_id,))
    conn.commit()


def apply_pending(conn: sqlite3.Connection) -> list[str]:
    """Run all pending migrations in order and return the list of applied IDs."""
    _ensure_migrations_table(conn)
    applied = _get_applied_ids(conn)
    applied_now: list[str] = []
    for mid, path in _discover_migrations():
        if mid not in applied:
            _run_one(conn, mid, path)
            applied_now.append(mid)
    return applied_now


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight check")
    parser.add_argument("db_path", help="Path to the SQLite database")
    parser.add_argument("project_id", nargs="?", default=None, help="Project ID (not required when using --migrate-only)")
    parser.add_argument("--migrate-only", action="store_true", help="Run migrations only (skip project registration check)")
    args = parser.parse_args()

    db_path: str = args.db_path
    project_id: str | None = args.project_id

    if not args.migrate_only:
        if not project_id:
            print_json({
                "status": "error",
                "error": "MISSING_PROJECT_ID",
                "message": "Please specify project_id (or use --migrate-only).",
            })
            sys.exit(1)

        # 1. Project registration check
        project_path = os.path.join(os.getcwd(), project_id)
        if not check_project_registered(project_path):
            print_json({
                "status": "error",
                "error": "NOT_REGISTERED",
                "message": f"This project has not been set up. "
                           f"Please run /setup {project_id} first.",
            })
            sys.exit(1)

    # 2. DB existence check
    if not os.path.exists(db_path):
        print_json({
            "status": "error",
            "error": "DB_NOT_FOUND",
            "message": f"Database {db_path} not found.",
        })
        sys.exit(1)

    # 3. Apply migrations
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
