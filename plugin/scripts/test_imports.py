#!/usr/bin/env python3
"""Import test for all modules

Importing each module triggers module-level assertions (field completeness checks, etc.).
Run this together with pyright before committing:

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
        print(f"FAIL: errors in {len(failures)}/{len(MODULES)} modules", file=sys.stderr)
        for line in failures:
            print(line, file=sys.stderr)
        sys.exit(1)
    else:
        print(f"OK: all {len(MODULES)} modules loaded successfully")


if __name__ == "__main__":
    main()
