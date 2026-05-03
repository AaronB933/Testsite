"""
db.py — Single source of truth for database connection.
Uses SQLAlchemy with PostgreSQL (or SQLite for local dev fallback).
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, scoped_session

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///archive.db")

# PostgreSQL needs pool settings; SQLite doesn't support them
if DATABASE_URL.startswith("postgresql"):
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,       # test connections before using
        pool_recycle=300,         # recycle connections every 5 min
    )
else:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False}
    )

SessionFactory = sessionmaker(bind=engine)
Session = scoped_session(SessionFactory)


def get_db():
    """Get a database session. Always use as context manager or call close()."""
    return Session()


def close_db(session):
    Session.remove()


def execute(sql, params=None):
    """
    Execute a raw SQL statement and return results as list of dicts.
    Use for SELECT queries.
    """
    with engine.connect() as conn:
        result = conn.execute(text(sql), params or {})
        if result.returns_rows:
            keys = result.keys()
            return [dict(zip(keys, row)) for row in result.fetchall()]
        return []


def execute_write(sql, params=None):
    """
    Execute a write SQL statement (INSERT, UPDATE, DELETE).
    Returns lastrowid for INSERT, rowcount for others.
    """
    with engine.connect() as conn:
        result = conn.execute(text(sql), params or {})
        conn.commit()
        try:
            return result.lastrowid
        except Exception:
            return result.rowcount


def execute_write_returning(sql, params=None):
    """
    Execute an INSERT with RETURNING id (PostgreSQL).
    Falls back to lastrowid for SQLite.
    """
    with engine.connect() as conn:
        result = conn.execute(text(sql), params or {})
        conn.commit()
        row = result.fetchone()
        return row[0] if row else None