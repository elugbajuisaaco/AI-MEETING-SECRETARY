"""Copy the existing local SQLite records into the DATABASE_URL database.

Run after `alembic upgrade head`. Existing target rows are left untouched.
"""

import argparse
import sqlite3
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from backend.database import engine
from backend.models import Meeting, Usage, User

TABLES = (User.__table__, Meeting.__table__, Usage.__table__)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "meetings.sqlite3", help="Existing SQLite database file")
    args = parser.parse_args()
    source_path = args.source.resolve()
    if not source_path.exists():
        raise SystemExit(f"Source SQLite database does not exist: {source_path}")
    if engine.dialect.name == "sqlite" and Path(engine.url.database).resolve() == source_path:
        raise SystemExit("Source and DATABASE_URL point to the same database; choose a different target first.")
    existing = set(inspect(engine).get_table_names())
    if not {"users", "meetings", "usage", "alembic_version"}.issubset(existing):
        raise SystemExit("Target schema is missing. Run `alembic upgrade head` from the backend folder first.")

    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    copied = {}
    try:
        with engine.begin() as destination:
            for table in TABLES:
                if table.name not in {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}: 
                    copied[table.name] = 0
                    continue
                source_columns = {row[1] for row in source.execute(f"PRAGMA table_info({table.name})")}
                target_columns = {column.name for column in table.columns}
                columns = [column.name for column in table.columns if column.name in source_columns and column.name in target_columns]
                rows = [dict(row) for row in source.execute(f"SELECT {','.join(columns)} FROM {table.name}")]
                if rows:
                    statement = (sqlite_insert(table) if engine.dialect.name == "sqlite" else pg_insert(table)).values(rows).on_conflict_do_nothing()
                    destination.execute(statement)
                copied[table.name] = len(rows)
    finally:
        source.close()
    print("Copied existing rows (conflicting IDs/emails were skipped):")
    for table, count in copied.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
