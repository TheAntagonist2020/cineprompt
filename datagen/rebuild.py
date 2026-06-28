#!/usr/bin/env python3
"""rebuild.py — one-command refresh of Cineprompt's data.json.

Backs up the current data.json (keeps the last 5 backups), then regenerates the
whole recommendation engine in place via build_recommendations.build().

    npm run data:rebuild     # from the project root
    python datagen/rebuild.py [path/to/data.json]
"""
import os
import shutil
import sys
from datetime import datetime, timezone

# make star characters in reasons printable on any console / CI locale
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.normpath(os.path.join(HERE, ".."))
DEFAULT_DATA = os.path.join(PROJECT_ROOT, "client", "public", "data.json")
# keep backups OUT of client/public so they never ship in the static build
BACKUPS_DIR = os.path.join(PROJECT_ROOT, "data-backups")
KEEP_BACKUPS = 5


def backup(path):
    if not os.path.exists(path):
        return
    backups_dir = BACKUPS_DIR
    os.makedirs(backups_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = os.path.join(backups_dir, f"data.{stamp}.json")
    shutil.copy2(path, dest)
    print(f"backup -> {os.path.relpath(dest)}")
    # prune oldest beyond KEEP_BACKUPS
    backups = sorted(
        (os.path.join(backups_dir, f) for f in os.listdir(backups_dir)
         if f.startswith("data.") and f.endswith(".json")),
        key=os.path.getmtime,
    )
    for old in backups[:-KEEP_BACKUPS]:
        os.remove(old)


def main():
    data_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DATA
    backup(data_path)
    # import after backup so a syntax error can't lose the backup step
    from build_recommendations import build
    build(data_path, data_path)


if __name__ == "__main__":
    main()
