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

        CREATE TABLE IF NOT EXISTS plants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, name),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            original_filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            date_taken DATE,
            date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            exif_found BOOLEAN DEFAULT 0,
            notes TEXT,
            FOREIGN KEY (plant_id) REFERENCES plants(id),
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

    cursor.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username.strip(), password_hash)
    )
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


# ── Plants ────────────────────────────────────────────────────────────────────

def get_or_create_plant(name: str, user_id: int) -> int:
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id FROM plants WHERE name = ? AND user_id = ?",
        (name.strip().lower(), user_id)
    )
    row = cursor.fetchone()

    if row:
        plant_id = row["id"]
    else:
        cursor.execute(
            "INSERT INTO plants (name, user_id) VALUES (?, ?)",
            (name.strip().lower(), user_id)
        )
        conn.commit()
        plant_id = cursor.lastrowid

    conn.close()
    return plant_id


def get_all_plants(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.id, p.name, COUNT(ph.id) as photo_count
        FROM plants p
        LEFT JOIN photos ph ON ph.plant_id = p.id
        WHERE p.user_id = ?
        GROUP BY p.id
        ORDER BY p.name
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


# ── Photos ────────────────────────────────────────────────────────────────────

def insert_photo(plant_id: int, user_id: int, original_filename: str,
                 stored_filename: str, file_path: str,
                 date_taken, exif_found: bool, notes: str = "") -> int:
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO photos (plant_id, user_id, original_filename, stored_filename,
                            file_path, date_taken, exif_found, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (plant_id, user_id, original_filename, stored_filename, file_path,
          str(date_taken) if date_taken else None, exif_found, notes))

    conn.commit()
    photo_id = cursor.lastrowid
    conn.close()
    return photo_id


def get_photos_by_plant(plant_id: int, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ph.*, p.name as plant_name
        FROM photos ph
        JOIN plants p ON p.id = ph.plant_id
        WHERE ph.plant_id = ? AND ph.user_id = ?
        ORDER BY ph.date_taken DESC
    """, (plant_id, user_id))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_all_photos(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT ph.*, p.name as plant_name
        FROM photos ph
        JOIN plants p ON p.id = ph.plant_id
        WHERE ph.user_id = ?
        ORDER BY ph.date_taken DESC
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def log_action(photo_id: int, action: str, detail: str = ""):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO upload_log (photo_id, action, detail) VALUES (?, ?, ?)",
        (photo_id, action, detail)
    )
    conn.commit()
    conn.close()