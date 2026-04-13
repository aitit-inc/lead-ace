#!/usr/bin/env python3
"""Script that merges candidate JSON (Phase 1) with contact JSON (Phase 2)

Usage:
  merge_prospects.py <candidates_file> <contacts_file>

Merges the Phase 1 (candidate collection) output with the Phase 2 (contact enrichment) output
by matching on name + website_url domain, and outputs the result in a format suitable for add_prospects.py.

Falls back to name-only matching when the domain does not match
(handles cases where the contact side is missing website_url).
Candidates with no match are output as-is with no contact info (email=null, etc.).

Output (stdout): Merged JSON array
Output (stderr): Merge result summary
"""

from __future__ import annotations

import json
import sys

from sales_db import PROSPECT_CONTACT_FIELDS, error_exit, extract_domain, normalize_name, print_json  # pyright: ignore[reportMissingModuleSource]


def make_key(entry: dict[str, object]) -> str:
    """Generate a match key from normalized name + domain."""
    name = normalize_name(str(entry.get("name", "")))
    raw_url = entry.get("website_url")
    url = str(raw_url) if isinstance(raw_url, str) else ""
    domain = extract_domain(url) if url else ""
    return f"{name}|{domain}"


def name_only_key(entry: dict[str, object]) -> str:
    """Generate a fallback key using only the normalized name."""
    return normalize_name(str(entry.get("name", "")))


# Contact fields (derived from the Prospect TypedDict in sales_db.py)
CONTACT_FIELDS = PROSPECT_CONTACT_FIELDS


def main() -> None:
    if len(sys.argv) < 3:
        error_exit("Usage: merge_prospects.py <candidates_file> <contacts_file>")

    candidates_path = sys.argv[1]
    contacts_path = sys.argv[2]

    try:
        with open(candidates_path, encoding="utf-8") as f:
            candidates: object = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        error_exit(f"Error reading candidates file: {e}")

    try:
        with open(contacts_path, encoding="utf-8") as f:
            contacts: object = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        error_exit(f"Error reading contacts file: {e}")

    if not isinstance(candidates, list) or not isinstance(contacts, list):
        error_exit("Both files must be JSON arrays")

    # Index contacts by key (primary: name+domain, fallback: name only)
    contacts_index: dict[str, dict[str, object]] = {}
    contacts_name_index: dict[str, dict[str, object]] = {}
    for contact in contacts:
        if isinstance(contact, dict):
            key = make_key(contact)
            contacts_index[key] = contact
            nk = name_only_key(contact)
            if nk:
                contacts_name_index[nk] = contact

    merged: list[dict[str, object]] = []
    matched_count = 0
    fallback_matched_count = 0
    unmatched_names: list[str] = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        key = make_key(candidate)
        result: dict[str, object] = dict(candidate)

        contact: dict[str, object] | None = contacts_index.get(key)
        fallback = False
        if contact is None:
            # Fallback: match by name only (handles missing website_url on the contact side)
            nk = name_only_key(candidate)
            contact = contacts_name_index.get(nk) if nk else None
            if contact is not None:
                fallback = True

        if contact is not None:
            for field in CONTACT_FIELDS:
                if field in contact:
                    result[field] = contact[field]
            matched_count += 1
            if fallback:
                fallback_matched_count += 1
        else:
            for field in CONTACT_FIELDS:
                result.setdefault(field, None)
            unmatched_names.append(str(candidate.get("name", "?")))

        merged.append(result)

    print_json(merged)

    summary = (
        f"Merge result: {len(candidates)} candidates, {len(contacts)} contacts"
        f" → {matched_count} matched"
    )
    if fallback_matched_count:
        summary += f" (of which {fallback_matched_count} via name-only fallback)"
    summary += f", {len(unmatched_names)} unmatched"
    print(summary, file=sys.stderr)
    if unmatched_names:
        for name in unmatched_names:
            print(f"  No contact match: {name}", file=sys.stderr)


if __name__ == "__main__":
    main()
