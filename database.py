import sqlite3
import os
import bcrypt

DB_PATH = os.path.join(os.path.dirname(__file__), "archive.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            original_filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            date_taken DATE,
            date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            exif_found BOOLEAN DEFAULT 0,
            label TEXT DEFAULT NULL,
            season TEXT DEFAULT NULL,
            season_copy_path TEXT DEFAULT NULL,
            notes TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS upload_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            photo_id INTEGER,
            action TEXT NOT NULL,
            detail TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (photo_id) REFERENCES photos(id)
        );
    """)
    conn.commit()
    conn.close()
    print("Database initialized.")


# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(username: str, password: str) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (username.strip(),))
    if cursor.fetchone():
        conn.close()
        return {"error": "Username already taken"}
    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)",
                   (username.strip(), password_hash))
    conn.commit()
    user_id = cursor.lastrowid
    conn.close()
    return {"id": user_id, "username": username.strip()}


def verify_user(username: str, password: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username.strip(),))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    if bcrypt.checkpw(password.encode("utf-8"), row["password_hash"].encode("utf-8")):
        return {"id": row["id"], "username": row["username"]}
    return None


# ── Photos ────────────────────────────────────────────────────────────────────

def insert_photo(user_id: int, original_filename: str, stored_filename: str,
                 file_path: str, date_taken, exif_found: bool) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO photos (user_id, original_filename, stored_filename, file_path,
                            date_taken, exif_found)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (user_id, original_filename, stored_filename, file_path,
          str(date_taken) if date_taken else None, exif_found))
    conn.commit()
    photo_id = cursor.lastrowid
    conn.close()
    return photo_id


def get_all_photos(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM photos WHERE user_id = ?
        ORDER BY date_taken DESC
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_photos_by_label(user_id: int, label: str):
    conn = get_connection()
    cursor = conn.cursor()
    if label == "inbox":
        cursor.execute("""
            SELECT * FROM photos WHERE user_id = ? AND (label IS NULL OR label = '')
            ORDER BY date_taken DESC
        """, (user_id,))
    else:
        cursor.execute("""
            SELECT * FROM photos WHERE user_id = ? AND label = ?
            ORDER BY date_taken DESC
        """, (user_id, label))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_photos_by_season(user_id: int, season: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM photos WHERE user_id = ? AND season = ?
        ORDER BY date_taken DESC
    """, (user_id, season))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_all_labels(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT label, COUNT(*) as count FROM photos
        WHERE user_id = ? AND label IS NOT NULL AND label != ''
        GROUP BY label ORDER BY label
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    # also count inbox
    cursor.execute("""
        SELECT COUNT(*) as count FROM photos
        WHERE user_id = ? AND (label IS NULL OR label = '')
    """, (user_id,))
    inbox_count = cursor.fetchone()["count"]
    conn.close()
    return {"labels": rows, "inbox_count": inbox_count}


def set_labels(photo_ids: list, label: str, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(photo_ids))
    cursor.execute(f"""
        UPDATE photos SET label = ?
        WHERE id IN ({placeholders}) AND user_id = ?
    """, [label] + photo_ids + [user_id])
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected


def set_season(photo_id: int, season: str, season_copy_path: str, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE photos SET season = ?, season_copy_path = ?
        WHERE id = ? AND user_id = ?
    """, (season, season_copy_path, photo_id, user_id))
    conn.commit()
    conn.close()


def get_stats(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total FROM photos WHERE user_id = ?", (user_id,))
    total = cursor.fetchone()["total"]
    cursor.execute("""
        SELECT COUNT(DISTINCT label) as count FROM photos
        WHERE user_id = ? AND label IS NOT NULL AND label != ''
    """, (user_id,))
    label_count = cursor.fetchone()["count"]
    cursor.execute("""
        SELECT COUNT(*) as count FROM photos
        WHERE user_id = ? AND (label IS NULL OR label = '')
    """, (user_id,))
    inbox_count = cursor.fetchone()["count"]
    cursor.execute("""
        SELECT season, COUNT(*) as count FROM photos
        WHERE user_id = ? AND season IS NOT NULL
        GROUP BY season
    """, (user_id,))
    seasons = {r["season"]: r["count"] for r in cursor.fetchall()}
    cursor.execute("""
        SELECT date_added FROM photos WHERE user_id = ?
        ORDER BY date_added DESC LIMIT 5
    """, (user_id,))
    recent = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"total": total, "label_count": label_count,
            "inbox_count": inbox_count, "seasons": seasons, "recent": recent}


def log_action(photo_id: int, action: str, detail: str = ""):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO upload_log (photo_id, action, detail) VALUES (?, ?, ?)",
                   (photo_id, action, detail))
    conn.commit()
    conn.close()