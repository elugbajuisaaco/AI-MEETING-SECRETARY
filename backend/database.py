"""SQLAlchemy engine and small SQLAlchemy 2.0 connection adapter."""

import re
from contextlib import contextmanager
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")


def database_url() -> URL:
    value = __import__("os").getenv("DATABASE_URL")
    if not value:
        return URL.create("sqlite", database=str(ROOT / "data" / "meetings.sqlite3"))
    url = make_url(value)
    if url.get_backend_name() == "sqlite" and url.database not in (None, ":memory:"):
        path = Path(url.database)
        if not path.is_absolute():
            url = url.set(database=str((ROOT / path).resolve()))
    return url


class Base(DeclarativeBase):
    pass


engine = create_engine(
    database_url(),
    pool_pre_ping=True,
    connect_args={"check_same_thread": False, "timeout": 15} if database_url().get_backend_name() == "sqlite" else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class ResultAdapter:
    def __init__(self, result):
        self.result = result
        self.rowcount = result.rowcount

    def fetchone(self):
        row = self.result.fetchone()
        return row._mapping if row is not None else None

    def fetchall(self):
        return [row._mapping for row in self.result.fetchall()]


class ConnectionAdapter:
    """Accept legacy qmark SQL while executing through SQLAlchemy 2.0."""

    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=()):
        if statement.lstrip().upper().startswith("INSERT OR IGNORE INTO"):
            statement = re.sub(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", statement, flags=re.I)
            statement = statement.rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
        bound = {}
        def bind(_match):
            key = f"p{len(bound)}"
            bound[key] = parameters[len(bound)]
            return f":{key}"
        statement = re.sub(r"\?", bind, statement)
        if isinstance(parameters, dict):
            bound = parameters
        return ResultAdapter(self.connection.execute(text(statement), bound))


@contextmanager
def connect():
    """Transactional connection retained for small, reviewable endpoint diffs."""
    with engine.begin() as connection:
        yield ConnectionAdapter(connection)
