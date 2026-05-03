"""
migrate.py — One-time migration from SQLite to PostgreSQL.

Run this ONCE after setting up PostgreSQL:
    python migrate.py

It reads from archive.db (SQLite) and writes to PostgreSQL.
Safe to run multiple times — skips existing records.
"""
import sqlite3
import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

SQLITE_PATH = os.path.join(os.path.dirname(__file__), "archive.db")
PG_URL = os.environ.get("DATABASE_URL")

if not PG_URL or not PG_URL.startswith("postgresql"):
    print("ERROR: DATABASE_URL must be a PostgreSQL URL in your .env file")
    sys.exit(1)

if not os.path.exists(SQLITE_PATH):
    print("No archive.db found — nothing to migrate. Starting fresh.")
    sys.exit(0)

print(f"Migrating from {SQLITE_PATH} to PostgreSQL...")

sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = sqlite3.Row
sqlite_cur = sqlite_conn.cursor()

pg_engine = create_engine(PG_URL)


def migrate_table(table, rows, insert_sql, row_mapper):
    if not rows:
        print(f"  {table}: no rows to migrate")
        return
    with pg_engine.connect() as conn:
        skipped = inserted = 0
        for row in rows:
            try:
                conn.execute(text(insert_sql), row_mapper(dict(row)))
                inserted += 1
            except Exception as e:
                if "duplicate" in str(e).lower() or "unique" in str(e).lower():
                    skipped += 1
                else:
                    print(f"  WARNING {table}: {e}")
        conn.commit()
    print(f"  {table}: {inserted} inserted, {skipped} skipped")


# ── Users ─────────────────────────────────────────────────────────────────────
sqlite_cur.execute("SELECT * FROM users")
rows = sqlite_cur.fetchall()
migrate_table("users", rows,
    """INSERT INTO users (id, username, password_hash, created_at)
       VALUES (:id, :username, :password_hash, :created_at)
       ON CONFLICT (username) DO NOTHING""",
    lambda r: r
)

# ── Photos ────────────────────────────────────────────────────────────────────
try:
    sqlite_cur.execute("SELECT * FROM photos")
    rows = sqlite_cur.fetchall()
    migrate_table("photos", rows,
        """INSERT INTO photos (id, user_id, original_filename, stored_filename, file_path,
           date_taken, date_added, exif_found, label, variety, season, season_year,
           season_copy_path, plant_copy_path, trashed, trashed_at, notes)
           VALUES (:id, :user_id, :original_filename, :stored_filename, :file_path,
           :date_taken, :date_added, :exif_found, :label, :variety, :season, :season_year,
           :season_copy_path, :plant_copy_path, :trashed, :trashed_at, :notes)
           ON CONFLICT DO NOTHING""",
        lambda r: {**r,
            "exif_found": bool(r.get("exif_found")),
            "trashed": bool(r.get("trashed")),
            "variety": r.get("variety"),
            "season_year": r.get("season_year"),
            "season_copy_path": r.get("season_copy_path"),
            "plant_copy_path": r.get("plant_copy_path"),
            "trashed_at": r.get("trashed_at"),
            "notes": r.get("notes")
        }
    )
except Exception as e:
    print(f"  photos: skipped ({e})")

# ── Upload log ────────────────────────────────────────────────────────────────
try:
    sqlite_cur.execute("SELECT * FROM upload_log")
    rows = sqlite_cur.fetchall()
    migrate_table("upload_log", rows,
        """INSERT INTO upload_log (id, photo_id, action, detail, timestamp)
           VALUES (:id, :photo_id, :action, :detail, :timestamp)
           ON CONFLICT DO NOTHING""",
        lambda r: r
    )
except Exception as e:
    print(f"  upload_log: skipped ({e})")

# ── Tracked plants ─────────────────────────────────────────────────────────────
try:
    sqlite_cur.execute("SELECT * FROM tracked_plants")
    rows = sqlite_cur.fetchall()
    migrate_table("tracked_plants", rows,
        """INSERT INTO tracked_plants (id, user_id, name, plant_type, variety,
           pot_size, location, acquired_date, notes, created_at, updated_at)
           VALUES (:id, :user_id, :name, :plant_type, :variety, :pot_size,
           :location, :acquired_date, :notes, :created_at, :updated_at)
           ON CONFLICT DO NOTHING""",
        lambda r: r
    )
except Exception as e:
    print(f"  tracked_plants: skipped ({e})")

# ── Care logs ─────────────────────────────────────────────────────────────────
try:
    sqlite_cur.execute("SELECT * FROM care_logs")
    rows = sqlite_cur.fetchall()
    migrate_table("care_logs", rows,
        """INSERT INTO care_logs (id, plant_id, user_id, care_type, care_date,
           product, amount, notes, created_at)
           VALUES (:id, :plant_id, :user_id, :care_type, :care_date,
           :product, :amount, :notes, :created_at)
           ON CONFLICT DO NOTHING""",
        lambda r: r
    )
except Exception as e:
    print(f"  care_logs: skipped ({e})")

# ── Plant issues ──────────────────────────────────────────────────────────────
try:
    sqlite_cur.execute("SELECT * FROM plant_issues")
    rows = sqlite_cur.fetchall()
    migrate_table("plant_issues", rows,
        """INSERT INTO plant_issues (id, plant_id, user_id, category, issue_name,
           status, first_seen, resolved_date, notes, created_at)
           VALUES (:id, :plant_id, :user_id, :category, :issue_name,
           :status, :first_seen, :resolved_date, :notes, :created_at)
           ON CONFLICT DO NOTHING""",
        lambda r: r
    )
except Exception as e:
    print(f"  plant_issues: skipped ({e})")

# ── Tracker photos ────────────────────────────────────────────────────────────
try:
    sqlite_cur.execute("SELECT * FROM tracker_photos")
    rows = sqlite_cur.fetchall()
    migrate_table("tracker_photos", rows,
        """INSERT INTO tracker_photos (id, plant_id, user_id, archive_photo_id,
           file_path, stored_filename, caption, taken_date, added_at)
           VALUES (:id, :plant_id, :user_id, :archive_photo_id,
           :file_path, :stored_filename, :caption, :taken_date, :added_at)
           ON CONFLICT DO NOTHING""",
        lambda r: r
    )
except Exception as e:
    print(f"  tracker_photos: skipped ({e})")

# ── Fix sequences (PostgreSQL SERIAL needs sequence reset after bulk insert) ──
print("\nResetting PostgreSQL sequences...")
tables = ["users", "photos", "upload_log", "tracked_plants",
          "care_logs", "plant_issues", "tracker_photos",
          "plant_type_presets", "care_product_presets"]

with pg_engine.connect() as conn:
    for table in tables:
        try:
            conn.execute(text(f"""
                SELECT setval(pg_get_serial_sequence('{table}', 'id'),
                COALESCE((SELECT MAX(id) FROM {table}), 1))
            """))
        except Exception as e:
            print(f"  sequence {table}: {e}")
    conn.commit()

sqlite_conn.close()
print("\nMigration complete!")
print("You can now delete archive.db if everything looks correct.")