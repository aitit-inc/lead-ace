#!/usr/bin/env python3
"""License management module

Stores global state in ~/.leadace/ and manages free (1 project) vs. paid (unlimited) tiers.

CLI:
    python3 license.py save-key "LEADACE-XXXX-XXXX-XXXX-XXXX"
    python3 license.py is-paid
    python3 license.py check-can-add "/abs/path"
    python3 license.py register "/abs/path"
    python3 license.py unregister "/abs/path"
    python3 license.py check-registered "/abs/path"
    python3 license.py list-projects
"""

import hashlib
import os
import sys
import fcntl
from pathlib import Path

# SHA-512 hash of the valid key (the key itself is not embedded in code)
VALID_KEY_HASH = "44192c18c9d9c4d4195f77a204036fcefe7d3b5a556c5230bdf1c2549e663c523bf2e9fc59a71d75c7b4a6477044c8472a7c2f1b6a9e0201aa048746288650bc"

LEADACE_DIR = Path.home() / ".leadace"
PKEY_FILE = LEADACE_DIR / "pkey"
PROJECTS_FILE = LEADACE_DIR / "projects"


def ensure_leadace_dir():
    """Create ~/.leadace/ directory if it does not exist."""
    LEADACE_DIR.mkdir(parents=True, exist_ok=True)


def save_key(key: str) -> bool:
    """Save the key to ~/.leadace/pkey. Returns True if the key is valid."""
    if not validate_key(key):
        return False
    ensure_leadace_dir()
    with open(PKEY_FILE, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(key.strip())
        fcntl.flock(f, fcntl.LOCK_UN)
    return True


def validate_key(key: str) -> bool:
    """Compare the SHA-512 hash of the key against the hardcoded valid hash."""
    h = hashlib.sha512(key.strip().encode()).hexdigest()
    return h == VALID_KEY_HASH


def is_paid() -> bool:
    """Returns True if ~/.leadace/pkey exists and contains a valid key."""
    if not PKEY_FILE.exists():
        return False
    try:
        with open(PKEY_FILE, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            key = f.read().strip()
            fcntl.flock(f, fcntl.LOCK_UN)
        return validate_key(key)
    except (IOError, OSError):
        return False


def register_project(project_path: str) -> str:
    """Append the absolute project path to ~/.leadace/projects (checks for duplicates and license).
    Returns: "REGISTERED" / "ALREADY_REGISTERED" / "FREE_LIMIT"
    """
    ensure_leadace_dir()
    path = os.path.abspath(project_path)
    # Perform read and write inside the same lock to prevent TOCTOU race conditions
    with open(PROJECTS_FILE, "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        lines = f.readlines()
        projects = [l.strip() for l in lines if l.strip()]
        if path in projects:
            return "ALREADY_REGISTERED"
        if not is_paid() and len(projects) >= 1:
            return "FREE_LIMIT"
        f.write(path + "\n")
    return "REGISTERED"


def unregister_project(project_path: str) -> bool:
    """Remove the absolute project path from ~/.leadace/projects. Returns True on success."""
    if not PROJECTS_FILE.exists():
        return False
    path = os.path.abspath(project_path)
    with open(PROJECTS_FILE, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        lines = f.readlines()
        new_lines = [l for l in lines if l.strip() != path]
        if len(new_lines) == len(lines):
            fcntl.flock(f, fcntl.LOCK_UN)
            return False
        f.seek(0)
        f.truncate()
        f.writelines(new_lines)
        fcntl.flock(f, fcntl.LOCK_UN)
    return True


def list_projects() -> list[str]:
    """Return a list of all project paths from ~/.leadace/projects."""
    if not PROJECTS_FILE.exists():
        return []
    try:
        with open(PROJECTS_FILE, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            lines = f.readlines()
            fcntl.flock(f, fcntl.LOCK_UN)
        return [l.strip() for l in lines if l.strip()]
    except (IOError, OSError):
        return []


def can_add_project(project_path: str) -> str:
    """Determine whether a project can be added.
    Returns: "PAID" / "FREE_OK" / "FREE_LIMIT" / "ALREADY_REGISTERED"
    """
    path = os.path.abspath(project_path)
    projects = list_projects()
    if path in projects:
        return "ALREADY_REGISTERED"
    if is_paid():
        return "PAID"
    if len(projects) == 0:
        return "FREE_OK"
    return "FREE_LIMIT"


def check_project_registered(project_path: str) -> bool:
    """Check whether the given path is registered in ~/.leadace/projects."""
    path = os.path.abspath(project_path)
    return path in list_projects()


# --- CLI ---

def main():
    if len(sys.argv) < 2:
        print("Usage: license.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "save-key":
        if len(sys.argv) < 3:
            print("Usage: license.py save-key <key>", file=sys.stderr)
            sys.exit(1)
        if save_key(sys.argv[2]):
            print("VALID")
        else:
            print("INVALID")

    elif cmd == "is-paid":
        print("PAID" if is_paid() else "FREE")

    elif cmd == "check-can-add":
        if len(sys.argv) < 3:
            print("Usage: license.py check-can-add <path>", file=sys.stderr)
            sys.exit(1)
        print(can_add_project(sys.argv[2]))

    elif cmd == "register":
        if len(sys.argv) < 3:
            print("Usage: license.py register <path>", file=sys.stderr)
            sys.exit(1)
        print(register_project(sys.argv[2]))

    elif cmd == "unregister":
        if len(sys.argv) < 3:
            print("Usage: license.py unregister <path>", file=sys.stderr)
            sys.exit(1)
        if unregister_project(sys.argv[2]):
            print("UNREGISTERED")
        else:
            print("NOT_FOUND")

    elif cmd == "check-registered":
        if len(sys.argv) < 3:
            print("Usage: license.py check-registered <path>", file=sys.stderr)
            sys.exit(1)
        print("OK" if check_project_registered(sys.argv[2]) else "NOT_REGISTERED")

    elif cmd == "list-projects":
        for p in list_projects():
            print(p)

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
