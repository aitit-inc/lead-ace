#!/usr/bin/env python3
"""Fetch content from a URL and extract information using Claude Haiku.

Fetches the web page as Markdown via Jina Reader (no API key, 20 RPM), then extracts with Haiku.

Usage:
    python3 fetch_url.py --url "https://example.com" --prompt "Extract the representative name and address"
    python3 fetch_url.py --url "https://example.com" --prompt "Find email addresses" --timeout 20

For raw HTML or JS-rendered content (e.g. Google Forms entry IDs), use claude-in-chrome MCP's
javascript_tool with `document.documentElement.outerHTML` or direct DOM inspection instead.
"""

from __future__ import annotations

import argparse
import subprocess
import sys

import requests


JINA_BASE_URL = "https://r.jina.ai/"
HAIKU_TIMEOUT_SEC = 60


def fetch_via_jina(url: str, timeout: int) -> str:
    """Fetch the Markdown representation of a URL via Jina Reader."""
    jina_url = f"{JINA_BASE_URL}{url}"
    headers = {
        "Accept": "text/markdown",
        "X-Timeout": str(timeout),
        "x-remove-all-images": "true",
    }
    resp = requests.get(jina_url, headers=headers, timeout=timeout + 5)
    resp.raise_for_status()
    return resp.text


def extract_with_haiku(content: str, prompt: str) -> str:
    """Extract information using the Claude Haiku CLI."""
    full_prompt = (
        "Extract information from the web page. "
        "For items not found, write 'Not listed'. "
        "Return only the extracted results.\n\n"
        f"## What to extract\n{prompt}\n\n"
        f"## Web page content\n{content}"
    )
    result = subprocess.run(
        ["claude", "--model", "haiku", "-p", full_prompt],
        capture_output=True,
        text=True,
        timeout=HAIKU_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        print(f"ERROR: Claude CLI failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch URL + extract information with Claude Haiku")
    parser.add_argument("--url", required=True, help="URL to fetch")
    parser.add_argument("--prompt", required=True, help="Extraction instructions for Haiku")
    parser.add_argument(
        "--timeout",
        type=int,
        default=15,
        help="Timeout in seconds (default: 15)",
    )
    args = parser.parse_args()

    try:
        content = fetch_via_jina(args.url, args.timeout)
    except requests.Timeout:
        print(
            f"TIMEOUT: {args.url} did not respond within {args.timeout} seconds",
            file=sys.stderr,
        )
        sys.exit(1)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else "unknown"
        print(f"HTTP_ERROR: {args.url} → {status}", file=sys.stderr)
        sys.exit(1)
    except requests.RequestException as e:
        print(f"FETCH_ERROR: {args.url} → {e}", file=sys.stderr)
        sys.exit(1)

    result = extract_with_haiku(content, args.prompt)
    print(result)


if __name__ == "__main__":
    main()
