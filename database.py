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
            variety TEXT DEFAULT NULL,
            season TEXT DEFAULT NULL,
            season_year INTEGER DEFAULT NULL,
            season_copy_path TEXT DEFAULT NULL,
            plant_copy_path TEXT DEFAULT NULL,
            trashed BOOLEAN DEFAULT 0,
            trashed_at TIMESTAMP DEFAULT NULL,
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
    init_tracker_tables()


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
        SELECT * FROM photos WHERE user_id = ? AND trashed = 0
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
            SELECT * FROM photos WHERE user_id = ? AND trashed = 0
            AND (label IS NULL OR label = '')
            ORDER BY date_taken DESC
        """, (user_id,))
    else:
        cursor.execute("""
            SELECT * FROM photos WHERE user_id = ? AND trashed = 0 AND label = ?
            ORDER BY date_taken DESC
        """, (user_id, label))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_photos_by_label_variety(user_id: int, label: str, variety: str):
    """Get photos by label + variety. variety='no-variety' means variety IS NULL."""
    conn = get_connection()
    cursor = conn.cursor()
    if variety == "no-variety":
        cursor.execute("""
            SELECT * FROM photos WHERE user_id = ? AND trashed = 0
            AND label = ? AND (variety IS NULL OR variety = '')
            ORDER BY date_taken DESC
        """, (user_id, label))
    else:
        cursor.execute("""
            SELECT * FROM photos WHERE user_id = ? AND trashed = 0
            AND label = ? AND variety = ?
            ORDER BY date_taken DESC
        """, (user_id, label, variety))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_photos_by_year_season(user_id: int, year: int, season: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM photos
        WHERE user_id = ? AND trashed = 0 AND season_year = ? AND season = ?
        ORDER BY date_taken DESC
    """, (user_id, year, season))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_photos_by_year(user_id: int, year: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM photos
        WHERE user_id = ? AND trashed = 0 AND season_year = ?
        ORDER BY date_taken DESC
    """, (user_id, year))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_all_labels(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT label, COUNT(*) as count FROM photos
        WHERE user_id = ? AND trashed = 0 AND label IS NOT NULL AND label != ''
        GROUP BY label ORDER BY label
    """, (user_id,))
    labels = [dict(r) for r in cursor.fetchall()]
    cursor.execute("""
        SELECT COUNT(*) as count FROM photos
        WHERE user_id = ? AND trashed = 0 AND (label IS NULL OR label = '')
    """, (user_id,))
    inbox_count = cursor.fetchone()["count"]
    conn.close()
    return {"labels": labels, "inbox_count": inbox_count}


def get_plant_tree(user_id: int):
    """Returns {label: {variety_or_no-variety: count}}"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT label,
               COALESCE(NULLIF(variety,''), 'no-variety') as var,
               COUNT(*) as count
        FROM photos
        WHERE user_id = ? AND trashed = 0
          AND label IS NOT NULL AND label != ''
        GROUP BY label, var
        ORDER BY label, var
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    tree = {}
    for row in rows:
        lb = row["label"]
        var = row["var"]
        if lb not in tree:
            tree[lb] = {}
        tree[lb][var] = row["count"]
    return tree


def get_year_season_tree(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT season_year, season, COUNT(*) as count
        FROM photos
        WHERE user_id = ? AND trashed = 0
          AND season IS NOT NULL AND season_year IS NOT NULL
        GROUP BY season_year, season
        ORDER BY season_year DESC, season
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    tree = {}
    for row in rows:
        y = row["season_year"]
        s = row["season"]
        if y not in tree:
            tree[y] = {}
        tree[y][s] = row["count"]
    return tree


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


def set_variety(photo_ids: list, variety: str, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(photo_ids))
    cursor.execute(f"""
        UPDATE photos SET variety = ?
        WHERE id IN ({placeholders}) AND user_id = ?
    """, [variety] + photo_ids + [user_id])
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected


def set_season(photo_id: int, season: str, season_year: int,
               season_copy_path: str, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE photos SET season = ?, season_year = ?, season_copy_path = ?
        WHERE id = ? AND user_id = ?
    """, (season, season_year, season_copy_path, photo_id, user_id))
    conn.commit()
    conn.close()


def set_plant_copy_path(photo_id: int, plant_copy_path: str, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE photos SET plant_copy_path = ?
        WHERE id = ? AND user_id = ?
    """, (plant_copy_path, photo_id, user_id))
    conn.commit()
    conn.close()


def get_stats(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total FROM photos WHERE user_id = ? AND trashed = 0", (user_id,))
    total = cursor.fetchone()["total"]
    cursor.execute("""
        SELECT COUNT(DISTINCT label) as count FROM photos
        WHERE user_id = ? AND trashed = 0 AND label IS NOT NULL AND label != ''
    """, (user_id,))
    label_count = cursor.fetchone()["count"]
    cursor.execute("""
        SELECT COUNT(*) as count FROM photos
        WHERE user_id = ? AND trashed = 0 AND (label IS NULL OR label = '')
    """, (user_id,))
    inbox_count = cursor.fetchone()["count"]
    cursor.execute("""
        SELECT COUNT(*) as count FROM photos
        WHERE user_id = ? AND trashed = 0 AND season IS NOT NULL
    """, (user_id,))
    organized_count = cursor.fetchone()["count"]
    tree = get_year_season_tree(user_id)
    conn.close()
    return {
        "total": total,
        "label_count": label_count,
        "inbox_count": inbox_count,
        "organized_count": organized_count,
        "year_tree": tree
    }


# ── Trash ─────────────────────────────────────────────────────────────────────

def trash_photos(photo_ids: list, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(photo_ids))
    cursor.execute(f"""
        UPDATE photos SET trashed = 1, trashed_at = CURRENT_TIMESTAMP
        WHERE id IN ({placeholders}) AND user_id = ?
    """, photo_ids + [user_id])
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected


def restore_photos(photo_ids: list, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(photo_ids))
    cursor.execute(f"""
        UPDATE photos SET trashed = 0, trashed_at = NULL
        WHERE id IN ({placeholders}) AND user_id = ?
    """, photo_ids + [user_id])
    conn.commit()
    affected = cursor.rowcount
    conn.close()
    return affected


def permanently_delete_photos(photo_ids: list, user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(photo_ids))
    cursor.execute(f"""
        SELECT file_path, season_copy_path, plant_copy_path FROM photos
        WHERE id IN ({placeholders}) AND user_id = ?
    """, photo_ids + [user_id])
    paths = [(r["file_path"], r["season_copy_path"], r["plant_copy_path"])
             for r in cursor.fetchall()]
    cursor.execute(f"""
        DELETE FROM photos WHERE id IN ({placeholders}) AND user_id = ?
    """, photo_ids + [user_id])
    conn.commit()
    conn.close()
    return paths


def get_trashed_photos(user_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM photos WHERE user_id = ? AND trashed = 1
        ORDER BY trashed_at DESC
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def log_action(photo_id: int, action: str, detail: str = ""):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO upload_log (photo_id, action, detail) VALUES (?, ?, ?)",
                   (photo_id, action, detail))
    conn.commit()
    conn.close()


# ══════════════════════════════════════════════════════════════════════════════
# PLANT TRACKER — separate from photo archive
# ══════════════════════════════════════════════════════════════════════════════

def init_tracker_tables():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS tracked_plants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            plant_type TEXT,
            variety TEXT,
            pot_size TEXT,
            location TEXT,
            acquired_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS care_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            care_type TEXT NOT NULL,
            care_date DATE NOT NULL,
            product TEXT,
            amount TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (plant_id) REFERENCES tracked_plants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS plant_issues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            issue_name TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            first_seen DATE,
            resolved_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (plant_id) REFERENCES tracked_plants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS tracker_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            archive_photo_id INTEGER DEFAULT NULL,
            file_path TEXT,
            stored_filename TEXT,
            caption TEXT,
            taken_date DATE,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (plant_id) REFERENCES tracked_plants(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS plant_type_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            UNIQUE(user_id, name)
        );

        CREATE TABLE IF NOT EXISTS care_product_presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            care_type TEXT NOT NULL,
            product_name TEXT NOT NULL,
            UNIQUE(user_id, care_type, product_name)
        );
    """)
    conn.commit()
    conn.close()


# ── Tracked plants ────────────────────────────────────────────────────────────

def create_tracked_plant(user_id, name, plant_type, variety, pot_size,
                          location, acquired_date, notes):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO tracked_plants
        (user_id, name, plant_type, variety, pot_size, location, acquired_date, notes)
        VALUES (?,?,?,?,?,?,?,?)
    """, (user_id, name, plant_type, variety, pot_size, location, acquired_date, notes))
    conn.commit()
    pid = cursor.lastrowid
    conn.close()
    # auto-add type preset
    if plant_type:
        add_type_preset(user_id, plant_type)
    return pid


def update_tracked_plant(plant_id, user_id, name, plant_type, variety,
                          pot_size, location, acquired_date, notes):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE tracked_plants SET name=?,plant_type=?,variety=?,pot_size=?,
        location=?,acquired_date=?,notes=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=?
    """, (name, plant_type, variety, pot_size, location, acquired_date, notes,
          plant_id, user_id))
    conn.commit()
    conn.close()
    if plant_type:
        add_type_preset(user_id, plant_type)


def delete_tracked_plant(plant_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM care_logs WHERE plant_id=? AND user_id=?", (plant_id, user_id))
    cursor.execute("DELETE FROM plant_issues WHERE plant_id=? AND user_id=?", (plant_id, user_id))
    cursor.execute("DELETE FROM tracker_photos WHERE plant_id=? AND user_id=?", (plant_id, user_id))
    cursor.execute("DELETE FROM tracked_plants WHERE id=? AND user_id=?", (plant_id, user_id))
    conn.commit()
    conn.close()


def get_tracked_plants(user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT tp.*,
            (SELECT MAX(care_date) FROM care_logs
             WHERE plant_id=tp.id AND care_type='watered') as last_watered,
            (SELECT MAX(care_date) FROM care_logs
             WHERE plant_id=tp.id AND care_type='fertilized') as last_fertilized,
            (SELECT MAX(care_date) FROM care_logs
             WHERE plant_id=tp.id AND care_type='sprayed') as last_sprayed,
            (SELECT COUNT(*) FROM plant_issues
             WHERE plant_id=tp.id AND status='active') as active_issues,
            (SELECT COUNT(*) FROM tracker_photos
             WHERE plant_id=tp.id) as photo_count
        FROM tracked_plants tp
        WHERE tp.user_id=?
        ORDER BY tp.name
    """, (user_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_tracked_plant(plant_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tracked_plants WHERE id=? AND user_id=?",
                   (plant_id, user_id))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


# ── Care logs ─────────────────────────────────────────────────────────────────

def add_care_log(plant_id, user_id, care_type, care_date, product, amount, notes):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO care_logs (plant_id, user_id, care_type, care_date, product, amount, notes)
        VALUES (?,?,?,?,?,?,?)
    """, (plant_id, user_id, care_type, care_date, product, amount, notes))
    conn.commit()
    lid = cursor.lastrowid
    conn.close()
    if product and care_type:
        add_product_preset(user_id, care_type, product)
    return lid


def get_care_logs(plant_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM care_logs WHERE plant_id=? AND user_id=?
        ORDER BY care_date DESC, created_at DESC
    """, (plant_id, user_id))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def delete_care_log(log_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM care_logs WHERE id=? AND user_id=?", (log_id, user_id))
    conn.commit()
    conn.close()


# ── Issues ────────────────────────────────────────────────────────────────────

def add_issue(plant_id, user_id, category, issue_name, status, first_seen, notes):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO plant_issues
        (plant_id, user_id, category, issue_name, status, first_seen, notes)
        VALUES (?,?,?,?,?,?,?)
    """, (plant_id, user_id, category, issue_name, status, first_seen, notes))
    conn.commit()
    iid = cursor.lastrowid
    conn.close()
    return iid


def update_issue(issue_id, user_id, status, resolved_date, notes):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE plant_issues SET status=?, resolved_date=?, notes=?
        WHERE id=? AND user_id=?
    """, (status, resolved_date, notes, issue_id, user_id))
    conn.commit()
    conn.close()


def delete_issue(issue_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM plant_issues WHERE id=? AND user_id=?", (issue_id, user_id))
    conn.commit()
    conn.close()


def get_issues(plant_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM plant_issues WHERE plant_id=? AND user_id=?
        ORDER BY status ASC, first_seen DESC
    """, (plant_id, user_id))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


# ── Tracker photos ────────────────────────────────────────────────────────────

def add_tracker_photo(plant_id, user_id, archive_photo_id, file_path,
                       stored_filename, caption, taken_date):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO tracker_photos
        (plant_id, user_id, archive_photo_id, file_path, stored_filename, caption, taken_date)
        VALUES (?,?,?,?,?,?,?)
    """, (plant_id, user_id, archive_photo_id, file_path, stored_filename,
          caption, taken_date))
    conn.commit()
    tid = cursor.lastrowid
    conn.close()
    return tid


def get_tracker_photos(plant_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM tracker_photos WHERE plant_id=? AND user_id=?
        ORDER BY taken_date DESC, added_at DESC
    """, (plant_id, user_id))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def delete_tracker_photo(photo_id, user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tracker_photos WHERE id=? AND user_id=?",
                   (photo_id, user_id))
    row = cursor.fetchone()
    cursor.execute("DELETE FROM tracker_photos WHERE id=? AND user_id=?",
                   (photo_id, user_id))
    conn.commit()
    conn.close()
    return dict(row) if row else None


# ── Presets ───────────────────────────────────────────────────────────────────

def add_type_preset(user_id, name):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO plant_type_presets (user_id, name) VALUES (?,?)",
                       (user_id, name.strip()))
        conn.commit()
    except: pass
    conn.close()


def get_type_presets(user_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM plant_type_presets WHERE user_id=? ORDER BY name",
                   (user_id,))
    rows = [r["name"] for r in cursor.fetchall()]
    conn.close()
    return rows


def add_product_preset(user_id, care_type, product_name):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO care_product_presets (user_id, care_type, product_name)
            VALUES (?,?,?)
        """, (user_id, care_type, product_name.strip()))
        conn.commit()
    except: pass
    conn.close()


def get_product_presets(user_id, care_type):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT product_name FROM care_product_presets
        WHERE user_id=? AND care_type=? ORDER BY product_name
    """, (user_id, care_type))
    rows = [r["product_name"] for r in cursor.fetchall()]
    conn.close()
    return rows