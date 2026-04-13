#!/usr/bin/env python3
"""Fetch content from a URL and extract information using Claude Haiku.

Normal mode: Fetches the web page as Markdown via Jina Reader (no API key, 20 RPM), then extracts with Haiku.
Raw mode: Fetches JS-rendered raw HTML via playwright, then extracts with Haiku.
          Use this when you need information that Jina Reader strips out, such as form entry IDs or data attributes.

Usage:
    python3 fetch_url.py --url "https://example.com" --prompt "Extract the representative name and address"
    python3 fetch_url.py --url "https://example.com" --prompt "Extract entry IDs" --raw
    python3 fetch_url.py --url "https://example.com" --prompt "Find email addresses" --timeout 20
"""

from __future__ import annotations

import argparse
import json
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


def fetch_raw_html(url: str, timeout: int) -> str:
    """Fetch JS-rendered raw HTML via playwright-cli.

    Opens via playwright-cli open, evaluates document.documentElement.outerHTML, then closes.
    Falls back to requests if playwright-cli is unavailable.
    """
    try:
        # Open browser and navigate to the page
        open_result = subprocess.run(
            ["playwright-cli", "open", url],
            capture_output=True,
            text=True,
            timeout=timeout + 15,
        )
        if open_result.returncode != 0:
            raise RuntimeError(open_result.stderr.strip())

        # Get JS-rendered HTML
        eval_result = subprocess.run(
            ["playwright-cli", "eval", "document.documentElement.outerHTML"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        # Close browser (ignore failures)
        subprocess.run(
            ["playwright-cli", "close"],
            capture_output=True,
            timeout=10,
        )

        if eval_result.returncode == 0 and eval_result.stdout.strip():
            # Strip markdown headers etc. from playwright-cli output and extract only the HTML part
            html = _extract_html_from_cli_output(eval_result.stdout)
            return html

        raise RuntimeError(eval_result.stderr.strip() or "eval returned empty")

    except (subprocess.TimeoutExpired, FileNotFoundError, RuntimeError) as e:
        print(f"WARNING: playwright-cli unavailable ({e}), falling back to requests", file=sys.stderr)

    resp = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": "Mozilla/5.0 (compatible; LeadAce/1.0)"},
    )
    resp.raise_for_status()
    return resp.text


def _extract_html_from_cli_output(output: str) -> str:
    """Extract the HTML portion from playwright-cli eval output.

    The output may contain a ### Result header and/or a JSON string wrapper.
    """
    # Look for "### Result" and take everything after it
    result_marker = "### Result"
    idx = output.find(result_marker)
    if idx != -1:
        output = output[idx + len(result_marker):].strip()

    # If wrapped as a JSON string (e.g. "<html>..." format), strip the surrounding quotes
    if output.startswith('"') and output.endswith('"'):
        try:
            parsed: object = json.loads(output)
            if isinstance(parsed, str):
                output = parsed
        except json.JSONDecodeError:
            output = output[1:-1]

    return output


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
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Fetch raw HTML (uses playwright). Use when form entry IDs or similar attributes are needed.",
    )
    args = parser.parse_args()

    try:
        if args.raw:
            content = fetch_raw_html(args.url, args.timeout)
        else:
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
