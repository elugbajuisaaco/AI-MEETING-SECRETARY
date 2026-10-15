"""Move existing audio files into the configured StorageProvider."""

import argparse
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")

from backend.database import connect
from backend.storage import LocalStorageProvider, create_storage_provider


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delete-source", action="store_true", help="Delete a local source file after its copy is stored and recorded")
    args = parser.parse_args()
    storage = create_storage_provider(os.getenv("JWT_SECRET", ""))
    rows = []
    with connect() as db:
        rows = db.execute("SELECT id,audio_path,storage_key,mime_type FROM meetings WHERE audio_path IS NOT NULL OR storage_key IS NOT NULL").fetchall()

    moved = skipped = 0
    for row in rows:
        if row["storage_key"]:
            skipped += 1
            continue
        if not row["audio_path"]:
            continue
        source = Path(row["audio_path"]).resolve()
        if not source.is_file():
            print(f"Skipping {row['id']}: local audio file is missing")
            continue
        key = f"audio/{row['id']}{source.suffix or '.audio'}"
        same_file = isinstance(storage, LocalStorageProvider) and storage.path_for(key) == source
        if not same_file:
            storage.put(key, source.read_bytes(), row["mime_type"] or "application/octet-stream")
        with connect() as db:
            db.execute("UPDATE meetings SET storage_key=?,audio_path=NULL WHERE id=? AND storage_key IS NULL", (key, row["id"]))
        if args.delete_source and not same_file:
            source.unlink(missing_ok=True)
        moved += 1
        print(f"Migrated {row['id']} to {key}")
    print(f"Storage migration finished: {moved} migrated, {skipped} already migrated")


if __name__ == "__main__":
    main()
