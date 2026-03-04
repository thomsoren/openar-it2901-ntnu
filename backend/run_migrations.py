#!/usr/bin/env python3
"""Simple migration runner for PostgreSQL migrations."""
import os
import sys
from pathlib import Path

# Load .env before reading env vars so this script works standalone.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

import psycopg

# Get DATABASE_URL from environment
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in environment")
    sys.exit(1)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def get_applied_migrations(conn):
    """Get list of already applied migrations."""
    # Create migrations table if it doesn't exist
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS _migrations (
                filename VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()

        # Get applied migrations
        cur.execute("SELECT filename FROM _migrations ORDER BY filename")
        return {row[0] for row in cur.fetchall()}


def run_migrations():
    """Run all pending SQL migrations in order."""
    if not MIGRATIONS_DIR.exists():
        print(f"ERROR: Migrations directory not found: {MIGRATIONS_DIR}")
        sys.exit(1)

    # Get all .sql files sorted by name
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        print("No migration files found")
        return

    print(f"Found {len(migration_files)} migration files")

    with psycopg.connect(DATABASE_URL) as conn:
        applied = get_applied_migrations(conn)
        pending = [f for f in migration_files if f.name not in applied]

        if not pending:
            print("All migrations already applied ✓")
            return

        print(f"\nApplying {len(pending)} pending migrations:")
        for migration_file in pending:
            print(f"  → {migration_file.name}...", end=" ", flush=True)

            try:
                sql = migration_file.read_text()
                with conn.cursor() as cur:
                    cur.execute(sql)
                    # Record migration as applied
                    cur.execute(
                        "INSERT INTO _migrations (filename) VALUES (%s)",
                        (migration_file.name,)
                    )
                    conn.commit()
                print("✓")
            except Exception as e:
                print(f"✗\nERROR applying {migration_file.name}:")
                print(f"  {e}")
                conn.rollback()
                sys.exit(1)

        print(f"\n✓ Successfully applied {len(pending)} migrations")


if __name__ == "__main__":
    run_migrations()
