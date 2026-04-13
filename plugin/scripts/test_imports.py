#!/usr/bin/env python3
"""全モジュールのインポートテスト

各モジュールを import するだけで、モジュールレベルの assertion（フィールド完全性チェック等）が
実行される。pyright と併用し、コミット前に実行すること:

  cd plugins/lead-ace/scripts && npx pyright && python3 test_imports.py
"""

from __future__ import annotations

import importlib
import sys

MODULES = [
    "sales_db",
    "add_prospects",
    "check_corporate_number",
    "check_duplicate",
    "delete_project",
    "fetch_url",
    "filter_duplicates",
    "lookup_corporate_numbers",
    "init_db",
    "license",
    "link_organization",
    "mark_org_lookup_status",
    "merge_prospects",
    "preflight",
    "query_db",
    "record_evaluation",
    "record_response",
    "sales_queries",
    "send_and_log",
    "update_status",
]


def main() -> None:
    failures: list[str] = []
    for name in MODULES:
        try:
            importlib.import_module(name)
        except Exception as e:
            failures.append(f"  {name}: {e}")

    if failures:
        print(f"FAIL: {len(failures)}/{len(MODULES)} モジュールでエラー", file=sys.stderr)
        for line in failures:
            print(line, file=sys.stderr)
        sys.exit(1)
    else:
        print(f"OK: {len(MODULES)} モジュール全て正常")


if __name__ == "__main__":
    main()
