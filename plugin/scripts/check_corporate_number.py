#!/usr/bin/env python3
"""Corporate number lookup script (NTA Corporate Number Publication Site)

Uses playwright-cli for browser automation to search and outputs candidate results as JSON.
Parses the snapshot command output — no JS files needed.

Usage:
    python3 check_corporate_number.py "SurpassOne株式会社"
    python3 check_corporate_number.py "佐藤"
    python3 check_corporate_number.py --kana "サーパスワンカブシキガイシャ"

Output (stdout): JSON
    {"total": N, "results": [{"number": "...", "name": "...", "reading": "...", "address": "..."}, ...]}
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import unicodedata
from typing import TypedDict

from sales_db import print_json  # pyright: ignore[reportMissingModuleSource]

NTA_URL = "https://www.houjin-bangou.nta.go.jp/"


# ---------------------------------------------------------------------------
# Type definitions
# ---------------------------------------------------------------------------


class SearchResult(TypedDict):
    number: str
    name: str
    reading: str
    address: str


class SearchOutput(TypedDict):
    total: int
    results: list[SearchResult]


# ---------------------------------------------------------------------------
# playwright-cli operations
# ---------------------------------------------------------------------------

def _run_cli(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    """Run a playwright-cli command."""
    return subprocess.run(
        ["playwright-cli", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _close_browser() -> None:
    """Close the browser (ignore failures)."""
    try:
        _run_cli(["close"], timeout=10)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def _is_katakana(text: str) -> bool:
    """Determine whether a string consists entirely of Katakana characters."""
    return all(
        unicodedata.name(c, "").startswith("KATAKANA") or c in "ー・"
        for c in text
    )


def search(company_name: str, kana: bool = False) -> SearchOutput:
    """Search the NTA Corporate Number Publication Site for a corporate number.

    Args:
        company_name: The entity name to search for
        kana: If True, search by phonetic reading (Katakana)

    Returns:
        Search results (total + results array)
    """
    # Launch browser and navigate to the site
    open_result = _run_cli(["open", NTA_URL], timeout=30)
    if open_result.returncode != 0:
        raise RuntimeError(f"playwright-cli open failed: {open_result.stderr.strip()}")

    try:
        # Enable Katakana reading checkbox if searching by kana
        if kana:
            _run_cli(["check", "getByRole('checkbox', { name: '読み仮名で検索' })"])

        # Fill in company name and submit search
        _run_cli(["fill", "getByRole('textbox', { name: '商号又は名称' })", company_name])
        click_result = _run_cli(["click", "getByRole('button', { name: '検索' })"])
        if click_result.returncode != 0:
            raise RuntimeError(f"Failed to click search button: {click_result.stderr.strip()}")

        # Wait for the results page to load
        _wait_for_results()

        # Get page structure via snapshot
        snap_result = _run_cli(["snapshot"], timeout=15)
        if snap_result.returncode != 0:
            raise RuntimeError(f"Failed to get snapshot: {snap_result.stderr.strip()}")

        return _parse_snapshot(snap_result.stdout)

    finally:
        _close_browser()


def _wait_for_results() -> None:
    """Wait for the search results page to load.

    Checks via playwright-cli snapshot whether the URL contains kensaku-kekka.
    Retries up to 5 times (1-second interval each).
    """
    import time
    for _ in range(5):
        time.sleep(1)
        snap = _run_cli(["snapshot"], timeout=10)
        if "kensaku-kekka" in snap.stdout:
            return
    # Even on timeout, attempt to parse (result will just be empty)


def _parse_snapshot(snapshot: str) -> SearchOutput:
    """Parse search results from playwright-cli snapshot output.

    Snapshot row lines look like:
      - row "1011003011668 サーパスワン ＳｕｒｐａｓｓＯｎｅ株式会社 東京都新宿区... 履歴等" [ref=...]:
    Data is extracted from the rowheader and cells within each row.
    """
    results: list[SearchResult] = []
    total = 0

    # Get result count: strong [ref=...]: "3" followed by 件 見つかりました
    total_match = re.search(
        r'strong \[ref=\w+\]: "(\d+)"\s*\n\s*- text: 件 見つかりました',
        snapshot,
    )
    if total_match:
        total = int(total_match.group(1))

    # Parse table rows
    # rowheader contains corporate number, cells contain name (reading+entity name) and address
    lines = snapshot.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Find rowheader "1011003011668" (exclude header row "法人番号")
        rh_match = re.match(r'- rowheader "(\d{13})"', line)
        if rh_match:
            number = rh_match.group(1)
            reading = ""
            name = ""
            address = ""

            # Search subsequent lines for cells
            j = i + 1
            cell_count = 0
            while j < len(lines) and cell_count < 2:
                cline = lines[j].strip()

                # First cell: name (reading + entity name)
                if cell_count == 0:
                    cell_match = re.match(r'- cell "(.+?)"', cline)
                    if cell_match:
                        cell_count += 1
                        cell_full_text = cell_match.group(1)
                        # Inside the cell: generic = reading, text = entity name
                        k = j + 1
                        while k < len(lines):
                            inner = lines[k].strip()
                            if inner.startswith("- generic"):
                                g_match = re.search(r": (.+)$", inner)
                                if g_match:
                                    reading = g_match.group(1).strip()
                            elif inner.startswith("- text:"):
                                t_match = re.search(r"- text: (.+)$", inner)
                                if t_match:
                                    name = t_match.group(1).strip()
                                break
                            elif inner.startswith("- cell"):
                                break
                            k += 1
                        # Fallback: if internal parse didn't yield name,
                        # derive name from cell text by stripping the reading prefix
                        if not name and cell_full_text:
                            if reading and cell_full_text.startswith(reading):
                                name = cell_full_text[len(reading):].strip()
                            if not name:
                                name = cell_full_text
                # Second cell: address
                elif cell_count == 1:
                    cell_match = re.match(r'- cell "(.+?)"', cline)
                    if cell_match:
                        address = cell_match.group(1)
                        # Exclude the "履歴等" (history) cell
                        if address != "履歴等":
                            cell_count += 1
                        else:
                            address = ""

                j += 1

            if number:
                results.append(SearchResult(
                    number=number,
                    name=name or reading,
                    reading=reading,
                    address=address,
                ))

        i += 1

    return SearchOutput(total=total, results=results)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search the NTA Corporate Number Publication Site for a corporate number.",
    )
    _ = parser.add_argument("company_name", help="Entity name to search for")
    _ = parser.add_argument(
        "--kana",
        action="store_true",
        help="Search by phonetic reading (Katakana). If omitted and all characters are Katakana, Kana search is used automatically.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    company_name: str = args.company_name
    kana: bool = args.kana

    # Auto-detect Katakana
    if not kana and _is_katakana(company_name):
        kana = True

    mode = "phonetic reading" if kana else "entity name"
    print(f"Searching for '{company_name}' by {mode}...", file=sys.stderr)

    try:
        result = search(company_name, kana=kana)
    except (RuntimeError, subprocess.TimeoutExpired) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    # Display results (summary to stderr, JSON to stdout)
    total = result["total"]
    results = result["results"]
    shown = len(results)

    if total > shown:
        print(f"{total} results found (showing first {shown})", file=sys.stderr)
    else:
        print(f"{total} results found", file=sys.stderr)

    if results:
        for i, r in enumerate(results, 1):
            print(f"  [{i}] {r['name']}", file=sys.stderr)
            print(f"      Corporate number: {r['number']}", file=sys.stderr)
            print(f"      Reading: {r['reading']}", file=sys.stderr)
            print(f"      Address: {r['address']}", file=sys.stderr)
            print(file=sys.stderr)

    print_json(result)


if __name__ == "__main__":
    main()
