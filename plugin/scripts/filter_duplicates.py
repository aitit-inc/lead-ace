#!/usr/bin/env python3
"""Filter script that removes DB-existing records from a candidate JSON list

Usage:
  echo '<json_array>' | filter_duplicates.py <db_path> <project_id>

Reads a JSON array of candidates from stdin, removes prospects already registered
in the DB, and outputs only new candidates to stdout.

Match criteria (fastest first):
  1. organizations.domain match (O(1) PK lookup)
  2. Normalized match on prospects.name

Output (stdout): Filtered JSON array
Output (stderr): Filter result summary
"""

from __future__ import annotations

import json
import sys

from sales_db import error_exit, extract_domain, get_connection, normalize_name, print_json  # pyright: ignore[reportMissingModuleSource]


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: filter_duplicates.py <db_path> <project_id>")

    db_path = sys.argv[1]
    project_id = sys.argv[2]

    try:
        candidates: object = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        error_exit(f"JSON parse error: {e}")

    if not isinstance(candidates, list):
        error_exit("Input must be a JSON array")

    conn = get_connection(db_path)
    try:
        # Fetch domains from organizations for fast PK lookup
        org_domains: set[str] = set()
        for row in conn.execute("SELECT domain FROM organizations"):
            org_domains.add(str(row["domain"]))

        # Fetch prospect names for fallback matching
        cursor = conn.execute(
            "SELECT p.name, p.website_url"
            " FROM prospects p"
            " JOIN project_prospects pp ON p.id = pp.prospect_id"
            " WHERE pp.project_id = ?",
            (project_id,),
        )
        existing_names: set[str] = set()
        existing_domains: set[str] = set()
        for row in cursor:
            if row["name"]:
                existing_names.add(normalize_name(str(row["name"])))
            if row["website_url"]:
                existing_domains.add(extract_domain(str(row["website_url"])))
    finally:
        conn.close()

    new_candidates: list[object] = []
    duplicates: list[dict[str, str]] = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        raw_name = candidate.get("name", "")
        url = candidate.get("website_url", "")
        domain = extract_domain(url) if url else ""

        # 1. Domain check against organizations (O(1) PK lookup)
        if domain and domain in org_domains:
            duplicates.append({"name": raw_name, "reason": f"Domain match (org): {domain}"})
        # 2. Domain check against project prospects
        elif domain and domain in existing_domains:
            duplicates.append({"name": raw_name, "reason": f"Domain match: {domain}"})
        # 3. Name check
        elif normalize_name(raw_name) in existing_names:
            duplicates.append({"name": raw_name, "reason": "Name match"})
        else:
            new_candidates.append(candidate)

    print_json(new_candidates)

    print(
        f"Filter result: {len(candidates)} input → {len(new_candidates)} new, {len(duplicates)} duplicates removed",
        file=sys.stderr,
    )
    if duplicates:
        for d in duplicates:
            print(f"  Excluded: {d['name']} ({d['reason']})", file=sys.stderr)


if __name__ == "__main__":
    main()
