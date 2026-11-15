"""Migriert die lokale SQLite-Datenbank (src/database.db) nach Supabase PostgreSQL.

Verwendung (aus dem Projektroot):
    python src/migrate_to_supabase.py

Voraussetzungen: SUPABASE_URL, SUPABASE_SERVICE_KEY und SUPABASE_DB_URL in .env.
Das Skript ist idempotent: bereits vorhandene Zeilen werden übersprungen.
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import psycopg
from dotenv import load_dotenv

from database import create_database

load_dotenv()

SQLITE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database.db")

TABLES = ["users", "friendships", "friend_invites", "games", "auth_tokens"]


def sqlite_rows(conn, table):
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM {table}")
    columns = [d[0] for d in cur.description]
    rows = cur.fetchall()
    return columns, rows


def postgres_columns(cur, table):
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = %s ORDER BY ordinal_position
    """, (table,))
    return [r[0] for r in cur.fetchall()]


def migrate():
    if not os.getenv("SUPABASE_DB_URL"):
        print("FEHLER: SUPABASE_DB_URL nicht gesetzt.")
        return 1
    if not os.path.exists(SQLITE_PATH):
        print(f"FEHLER: {SQLITE_PATH} nicht gefunden.")
        return 1

    create_database()

    sqlite = sqlite3.connect(SQLITE_PATH)
    pg = psycopg.connect(os.environ["SUPABASE_DB_URL"], connect_timeout=10)

    totals = {}
    try:
        with pg.cursor() as cur:
            for table in TABLES:
                columns, rows = sqlite_rows(sqlite, table)
                if not rows:
                    totals[table] = 0
                    continue
                pg_columns = postgres_columns(cur, table)
                use_columns = [c for c in columns if c in pg_columns]
                placeholders = ", ".join(["%s"] * len(use_columns))
                col_list = ", ".join(use_columns)
                conflict = ""
                if table == "users":
                    # Bestands-User werden als 'legacy' importiert; Discord-Konten
                    # behalten ihren Marker und brauchen weiterhin keinen Supabase-Login.
                    use_columns = use_columns + ["auth_provider"]
                    col_list = ", ".join(use_columns)
                    placeholders = ", ".join(["%s"] * len(use_columns))
                    conflict = """
                        ON CONFLICT (id) DO NOTHING
                    """
                elif table in ("friendships", "games", "auth_tokens"):
                    conflict = "ON CONFLICT DO NOTHING"
                elif table == "friend_invites":
                    conflict = "ON CONFLICT (id) DO NOTHING"

                inserted = 0
                for row in rows:
                    values = [row[columns.index(c)] for c in use_columns if c != "auth_provider"]
                    if "auth_provider" in use_columns:
                        third_party = row[columns.index("third_party")] if "third_party" in columns else 0
                        provider = row[columns.index("provider")] if "provider" in columns else 0
                        password = row[columns.index("password")] if "password" in columns else None
                        is_discord = (third_party == 1 or provider == 1 or password == "DISCORD_LOGIN")
                        values.append("discord" if is_discord else "legacy")
                    cur.execute(
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) {conflict}",
                        values,
                    )
                    inserted += 1
                totals[table] = inserted
        pg.commit()
    finally:
        sqlite.close()
        pg.close()

    print("Migration abgeschlossen (Duplikate wurde uebersprungen):")
    for table, count in totals.items():
        print(f"  {table}: {count} Zeilen verarbeitet")
    print("Hinweis: Legacy-Konten werden bei der ersten Anmeldung automatisch nach Supabase Auth migriert.")
    return 0


if __name__ == "__main__":
    sys.exit(migrate())
