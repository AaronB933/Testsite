"""
database.py — All database operations using SQLAlchemy raw SQL.
Compatible with PostgreSQL and SQLite.
"""
import bcrypt
from db import engine, execute, execute_write, execute_write_returning
from sqlalchemy import text

def _build_in_clause(ids, prefix='id'):
    """Build PostgreSQL/SQLite IN clause from a list of IDs."""
    placeholders = ', '.join(f':{prefix}{i}' for i in range(len(ids)))
    params = {f'{prefix}{i}': v for i, v in enumerate(ids)}
    return placeholders, params



# ── Schema ────────────────────────────────────────────────────────────────────

def init_db():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS photos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                date_taken DATE,
                date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                exif_found BOOLEAN DEFAULT FALSE,
                label TEXT DEFAULT NULL,
                variety TEXT DEFAULT NULL,
                season TEXT DEFAULT NULL,
                season_year INTEGER DEFAULT NULL,
                season_copy_path TEXT DEFAULT NULL,
                plant_copy_path TEXT DEFAULT NULL,
                trashed BOOLEAN DEFAULT FALSE,
                trashed_at TIMESTAMP DEFAULT NULL,
                notes TEXT
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS upload_log (
                id SERIAL PRIMARY KEY,
                photo_id INTEGER REFERENCES photos(id),
                action TEXT NOT NULL,
                detail TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        # Tracker tables
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tracked_plants (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                plant_type TEXT,
                variety TEXT,
                pot_size TEXT,
                location TEXT,
                acquired_date DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS care_logs (
                id SERIAL PRIMARY KEY,
                plant_id INTEGER NOT NULL REFERENCES tracked_plants(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                care_type TEXT NOT NULL,
                care_date DATE NOT NULL,
                product TEXT,
                amount TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS plant_issues (
                id SERIAL PRIMARY KEY,
                plant_id INTEGER NOT NULL REFERENCES tracked_plants(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                category TEXT NOT NULL,
                issue_name TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                first_seen DATE,
                resolved_date DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tracker_photos (
                id SERIAL PRIMARY KEY,
                plant_id INTEGER NOT NULL REFERENCES tracked_plants(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                archive_photo_id INTEGER DEFAULT NULL,
                file_path TEXT,
                stored_filename TEXT,
                caption TEXT,
                taken_date DATE,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS plant_type_presets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                UNIQUE(user_id, name)
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS care_product_presets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                care_type TEXT NOT NULL,
                product_name TEXT NOT NULL,
                UNIQUE(user_id, care_type, product_name)
            )
        """))

        conn.commit()
    print("Database initialized.")


def init_tracker_tables():
    """No-op — tracker tables now created in init_db."""
    pass


# ── Users ─────────────────────────────────────────────────────────────────────

def create_user(username: str, password: str) -> dict:
    rows = execute(
        "SELECT id FROM users WHERE LOWER(username) = LOWER(:u)",
        {"u": username.strip()}
    )
    if rows:
        return {"error": "Username already taken"}

    password_hash = bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    uid = execute_write_returning(
        "INSERT INTO users (username, password_hash) VALUES (:u, :p) RETURNING id",
        {"u": username.strip(), "p": password_hash}
    )
    return {"id": uid, "username": username.strip()}


def verify_user(username: str, password: str):
    rows = execute(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(:u)",
        {"u": username.strip()}
    )
    if not rows:
        return None
    user = rows[0]
    if bcrypt.checkpw(password.encode("utf-8"),
                      user["password_hash"].encode("utf-8")):
        return {"id": user["id"], "username": user["username"]}
    return None


# ── Photos ────────────────────────────────────────────────────────────────────

def insert_photo(user_id, original_filename, stored_filename,
                 file_path, date_taken, exif_found) -> int:
    return execute_write_returning("""
        INSERT INTO photos
        (user_id, original_filename, stored_filename, file_path, date_taken, exif_found)
        VALUES (:uid, :orig, :stored, :path, :dt, :exif)
        RETURNING id
    """, {
        "uid": user_id, "orig": original_filename, "stored": stored_filename,
        "path": file_path,
        "dt": str(date_taken) if date_taken else None,
        "exif": exif_found
    })


def get_all_photos(user_id, limit=50, offset=0):
    return execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        ORDER BY date_taken DESC LIMIT :limit OFFSET :offset
    """, {"uid": user_id, "limit": limit, "offset": offset})


def count_all_photos(user_id):
    rows = execute("""
        SELECT COUNT(*) as c FROM photos WHERE user_id = :uid AND trashed = FALSE
    """, {"uid": user_id})
    return rows[0]["c"]


def get_photos_by_label(user_id, label, limit=50, offset=0):
    if label == "inbox":
        return execute("""
            SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
            AND (label IS NULL OR label = '')
            ORDER BY date_taken DESC LIMIT :limit OFFSET :offset
        """, {"uid": user_id, "limit": limit, "offset": offset})
    return execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        AND label = :label ORDER BY date_taken DESC LIMIT :limit OFFSET :offset
    """, {"uid": user_id, "label": label, "limit": limit, "offset": offset})


def count_photos_by_label(user_id, label):
    if label == "inbox":
        rows = execute("""
            SELECT COUNT(*) as c FROM photos WHERE user_id = :uid AND trashed = FALSE
            AND (label IS NULL OR label = '')
        """, {"uid": user_id})
    else:
        rows = execute("""
            SELECT COUNT(*) as c FROM photos WHERE user_id = :uid AND trashed = FALSE
            AND label = :label
        """, {"uid": user_id, "label": label})
    return rows[0]["c"]


def get_photos_by_label_variety(user_id, label, variety):
    if variety == "no-variety":
        return execute("""
            SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
            AND label = :label AND (variety IS NULL OR variety = '')
            ORDER BY date_taken DESC
        """, {"uid": user_id, "label": label})
    return execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        AND label = :label AND variety = :variety ORDER BY date_taken DESC
    """, {"uid": user_id, "label": label, "variety": variety})


def get_photos_by_year_season(user_id, year, season):
    return execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        AND season_year = :year AND season = :season ORDER BY date_taken DESC
    """, {"uid": user_id, "year": year, "season": season})


def get_photos_by_year(user_id, year):
    return execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        AND season_year = :year ORDER BY date_taken DESC
    """, {"uid": user_id, "year": year})


def get_all_labels(user_id):
    labels = execute("""
        SELECT label, COUNT(*) as count FROM photos
        WHERE user_id = :uid AND trashed = FALSE
        AND label IS NOT NULL AND label != ''
        GROUP BY label ORDER BY label
    """, {"uid": user_id})
    inbox = execute("""
        SELECT COUNT(*) as count FROM photos
        WHERE user_id = :uid AND trashed = FALSE
        AND (label IS NULL OR label = '')
    """, {"uid": user_id})
    return {"labels": labels, "inbox_count": inbox[0]["count"]}


def get_plant_tree(user_id):
    rows = execute("""
        SELECT label,
               COALESCE(NULLIF(variety, ''), 'no-variety') as var,
               COUNT(*) as count
        FROM photos
        WHERE user_id = :uid AND trashed = FALSE
          AND label IS NOT NULL AND label != ''
        GROUP BY label, var ORDER BY label, var
    """, {"uid": user_id})
    tree = {}
    for row in rows:
        lb, var = row["label"], row["var"]
        if lb not in tree:
            tree[lb] = {}
        tree[lb][var] = row["count"]
    return tree


def get_year_season_tree(user_id):
    rows = execute("""
        SELECT season_year, season, COUNT(*) as count
        FROM photos
        WHERE user_id = :uid AND trashed = FALSE
          AND season IS NOT NULL AND season_year IS NOT NULL
        GROUP BY season_year, season
        ORDER BY season_year DESC, season
    """, {"uid": user_id})
    tree = {}
    for row in rows:
        y, s = row["season_year"], row["season"]
        if y not in tree:
            tree[y] = {}
        tree[y][s] = row["count"]
    return tree


def set_labels(photo_ids, label, user_id):
    placeholders, params = _build_in_clause(photo_ids)
    params['label'] = label
    params['uid'] = user_id
    with engine.connect() as conn:
        result = conn.execute(
            text(f"UPDATE photos SET label = :label WHERE id IN ({placeholders}) AND user_id = :uid"),
            params
        )
        conn.commit()
        return result.rowcount


def set_variety(photo_ids, variety, user_id):
    placeholders, params = _build_in_clause(photo_ids)
    params['variety'] = variety
    params['uid'] = user_id
    with engine.connect() as conn:
        result = conn.execute(
            text(f"UPDATE photos SET variety = :variety WHERE id IN ({placeholders}) AND user_id = :uid"),
            params
        )
        conn.commit()
        return result.rowcount


def set_season(photo_id, season, season_year, season_copy_path, user_id):
    execute_write("""
        UPDATE photos SET season = :season, season_year = :year,
        season_copy_path = :path WHERE id = :id AND user_id = :uid
    """, {"season": season, "year": season_year, "path": season_copy_path,
          "id": photo_id, "uid": user_id})


def set_plant_copy_path(photo_id, plant_copy_path, user_id):
    execute_write("""
        UPDATE photos SET plant_copy_path = :path WHERE id = :id AND user_id = :uid
    """, {"path": plant_copy_path, "id": photo_id, "uid": user_id})


def get_stats(user_id):
    total = execute("SELECT COUNT(*) as c FROM photos WHERE user_id=:uid AND trashed=FALSE",
                    {"uid": user_id})[0]["c"]
    label_count = execute("""
        SELECT COUNT(DISTINCT label) as c FROM photos
        WHERE user_id=:uid AND trashed=FALSE AND label IS NOT NULL AND label!=''
    """, {"uid": user_id})[0]["c"]
    inbox_count = execute("""
        SELECT COUNT(*) as c FROM photos
        WHERE user_id=:uid AND trashed=FALSE AND (label IS NULL OR label='')
    """, {"uid": user_id})[0]["c"]
    organized_count = execute("""
        SELECT COUNT(*) as c FROM photos
        WHERE user_id=:uid AND trashed=FALSE AND season IS NOT NULL
    """, {"uid": user_id})[0]["c"]
    tree = get_year_season_tree(user_id)
    return {
        "total": total, "label_count": label_count,
        "inbox_count": inbox_count, "organized_count": organized_count,
        "year_tree": tree
    }


# ── Trash ─────────────────────────────────────────────────────────────────────

def trash_photos(photo_ids, user_id):
    placeholders, params = _build_in_clause(photo_ids)
    params['uid'] = user_id
    with engine.connect() as conn:
        result = conn.execute(text(f"""
            UPDATE photos SET trashed = TRUE, trashed_at = CURRENT_TIMESTAMP
            WHERE id IN ({placeholders}) AND user_id = :uid
        """), params)
        conn.commit()
        return result.rowcount


def restore_photos(photo_ids, user_id):
    placeholders, params = _build_in_clause(photo_ids)
    params['uid'] = user_id
    with engine.connect() as conn:
        result = conn.execute(text(f"""
            UPDATE photos SET trashed = FALSE, trashed_at = NULL
            WHERE id IN ({placeholders}) AND user_id = :uid
        """), params)
        conn.commit()
        return result.rowcount


def permanently_delete_photos(photo_ids, user_id):
    placeholders, params = _build_in_clause(photo_ids)
    params['uid'] = user_id
    rows = execute(f"""
        SELECT stored_filename, file_path, season_copy_path, plant_copy_path FROM photos
        WHERE id IN ({placeholders}) AND user_id = :uid
    """, params)
    paths = [(r["stored_filename"], r["file_path"], r["season_copy_path"], r["plant_copy_path"])
             for r in rows]
    with engine.connect() as conn:
        conn.execute(text(f"DELETE FROM upload_log WHERE photo_id IN ({placeholders})"), params)
        conn.execute(text(f"DELETE FROM photos WHERE id IN ({placeholders}) AND user_id = :uid"), params)
        conn.commit()
    return paths


def get_trashed_photos(user_id):
    return execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = TRUE
        ORDER BY trashed_at DESC
    """, {"uid": user_id})


def log_action(photo_id, action, detail=""):
    execute_write("""
        INSERT INTO upload_log (photo_id, action, detail) VALUES (:pid, :a, :d)
    """, {"pid": photo_id, "a": action, "d": detail})


# ══════════════════════════════════════════════════════════════════════════════
# PLANT TRACKER
# ══════════════════════════════════════════════════════════════════════════════

def create_tracked_plant(user_id, name, plant_type, variety, pot_size,
                          location, acquired_date, notes):
    pid = execute_write_returning("""
        INSERT INTO tracked_plants
        (user_id, name, plant_type, variety, pot_size, location, acquired_date, notes)
        VALUES (:uid, :name, :pt, :var, :pot, :loc, :acq, :notes)
        RETURNING id
    """, {"uid": user_id, "name": name, "pt": plant_type, "var": variety,
          "pot": pot_size, "loc": location, "acq": acquired_date, "notes": notes})
    if plant_type:
        add_type_preset(user_id, plant_type)
    return pid


def update_tracked_plant(plant_id, user_id, name, plant_type, variety,
                          pot_size, location, acquired_date, notes):
    execute_write("""
        UPDATE tracked_plants SET name=:name, plant_type=:pt, variety=:var,
        pot_size=:pot, location=:loc, acquired_date=:acq, notes=:notes,
        updated_at=CURRENT_TIMESTAMP WHERE id=:id AND user_id=:uid
    """, {"name": name, "pt": plant_type, "var": variety, "pot": pot_size,
          "loc": location, "acq": acquired_date, "notes": notes,
          "id": plant_id, "uid": user_id})
    if plant_type:
        add_type_preset(user_id, plant_type)


def delete_tracked_plant(plant_id, user_id):
    for table in ["care_logs", "plant_issues", "tracker_photos"]:
        execute_write(
            f"DELETE FROM {table} WHERE plant_id=:pid AND user_id=:uid",
            {"pid": plant_id, "uid": user_id}
        )
    execute_write("DELETE FROM tracked_plants WHERE id=:pid AND user_id=:uid",
                  {"pid": plant_id, "uid": user_id})


def get_tracked_plants(user_id):
    return execute("""
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
        FROM tracked_plants tp WHERE tp.user_id=:uid ORDER BY tp.name
    """, {"uid": user_id})


def get_tracked_plant(plant_id, user_id):
    rows = execute(
        "SELECT * FROM tracked_plants WHERE id=:id AND user_id=:uid",
        {"id": plant_id, "uid": user_id}
    )
    return rows[0] if rows else None


def add_care_log(plant_id, user_id, care_type, care_date, product, amount, notes):
    lid = execute_write_returning("""
        INSERT INTO care_logs
        (plant_id, user_id, care_type, care_date, product, amount, notes)
        VALUES (:pid, :uid, :ct, :cd, :prod, :amt, :notes)
        RETURNING id
    """, {"pid": plant_id, "uid": user_id, "ct": care_type, "cd": care_date,
          "prod": product, "amt": amount, "notes": notes})
    if product and care_type:
        add_product_preset(user_id, care_type, product)
    return lid


def get_care_logs(plant_id, user_id):
    return execute("""
        SELECT * FROM care_logs WHERE plant_id=:pid AND user_id=:uid
        ORDER BY care_date DESC, created_at DESC
    """, {"pid": plant_id, "uid": user_id})


def delete_care_log(log_id, user_id):
    execute_write("DELETE FROM care_logs WHERE id=:id AND user_id=:uid",
                  {"id": log_id, "uid": user_id})


def add_issue(plant_id, user_id, category, issue_name, status, first_seen, notes):
    return execute_write_returning("""
        INSERT INTO plant_issues
        (plant_id, user_id, category, issue_name, status, first_seen, notes)
        VALUES (:pid, :uid, :cat, :name, :status, :fs, :notes)
        RETURNING id
    """, {"pid": plant_id, "uid": user_id, "cat": category, "name": issue_name,
          "status": status, "fs": first_seen, "notes": notes})


def update_issue(issue_id, user_id, status, resolved_date, notes):
    execute_write("""
        UPDATE plant_issues SET status=:status, resolved_date=:rd, notes=:notes
        WHERE id=:id AND user_id=:uid
    """, {"status": status, "rd": resolved_date, "notes": notes,
          "id": issue_id, "uid": user_id})


def delete_issue(issue_id, user_id):
    execute_write("DELETE FROM plant_issues WHERE id=:id AND user_id=:uid",
                  {"id": issue_id, "uid": user_id})


def get_issues(plant_id, user_id):
    return execute("""
        SELECT * FROM plant_issues WHERE plant_id=:pid AND user_id=:uid
        ORDER BY status ASC, first_seen DESC
    """, {"pid": plant_id, "uid": user_id})


def add_tracker_photo(plant_id, user_id, archive_photo_id, file_path,
                       stored_filename, caption, taken_date):
    return execute_write_returning("""
        INSERT INTO tracker_photos
        (plant_id, user_id, archive_photo_id, file_path, stored_filename, caption, taken_date)
        VALUES (:pid, :uid, :apid, :fp, :sf, :cap, :td)
        RETURNING id
    """, {"pid": plant_id, "uid": user_id, "apid": archive_photo_id,
          "fp": file_path, "sf": stored_filename, "cap": caption, "td": taken_date})


def get_tracker_photos(plant_id, user_id):
    return execute("""
        SELECT * FROM tracker_photos WHERE plant_id=:pid AND user_id=:uid
        ORDER BY taken_date DESC, added_at DESC
    """, {"pid": plant_id, "uid": user_id})


def delete_tracker_photo(photo_id, user_id):
    rows = execute(
        "SELECT * FROM tracker_photos WHERE id=:id AND user_id=:uid",
        {"id": photo_id, "uid": user_id}
    )
    execute_write("DELETE FROM tracker_photos WHERE id=:id AND user_id=:uid",
                  {"id": photo_id, "uid": user_id})
    return rows[0] if rows else None


def add_type_preset(user_id, name):
    try:
        execute_write("""
            INSERT INTO plant_type_presets (user_id, name) VALUES (:uid, :name)
            ON CONFLICT (user_id, name) DO NOTHING
        """, {"uid": user_id, "name": name.strip()})
    except Exception:
        pass


def get_type_presets(user_id):
    rows = execute(
        "SELECT name FROM plant_type_presets WHERE user_id=:uid ORDER BY name",
        {"uid": user_id}
    )
    return [r["name"] for r in rows]


def add_product_preset(user_id, care_type, product_name):
    try:
        execute_write("""
            INSERT INTO care_product_presets (user_id, care_type, product_name)
            VALUES (:uid, :ct, :pn)
            ON CONFLICT (user_id, care_type, product_name) DO NOTHING
        """, {"uid": user_id, "ct": care_type, "pn": product_name.strip()})
    except Exception:
        pass


def get_product_presets(user_id, care_type):
    rows = execute("""
        SELECT product_name FROM care_product_presets
        WHERE user_id=:uid AND care_type=:ct ORDER BY product_name
    """, {"uid": user_id, "ct": care_type})
    return [r["product_name"] for r in rows]