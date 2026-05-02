import os
import shutil
from datetime import date, datetime
from flask import Flask, request, jsonify, send_from_directory, session

from database import (init_db, create_user, verify_user, insert_photo, log_action,
                      get_all_photos, get_photos_by_label, get_photos_by_label_variety,
                      get_photos_by_year_season, get_photos_by_year,
                      get_all_labels, get_plant_tree, get_year_season_tree,
                      set_labels, set_variety, set_season, set_plant_copy_path,
                      get_stats, trash_photos, restore_photos,
                      permanently_delete_photos, get_trashed_photos)
from exifutils import (read_date_taken, write_date_to_exif, build_stored_filename,
                       get_existing_filenames, is_supported)

app = Flask(__name__, static_folder="static", template_folder="static")
app.secret_key = os.environ.get("SECRET_KEY", "plant-archive-secret-change-me")

UPLOAD_BASE = os.path.join(os.path.dirname(__file__), "uploads")
VIDEO_EXTENSIONS = {'.mp4','.mov','.avi','.mkv','.m4v','.wmv','.flv','.webm','.3gp'}


def get_season(d: date) -> str:
    m, day = d.month, d.day
    if (m == 3 and day >= 8) or m == 4 or m == 5 or (m == 6 and day <= 1):
        return "spring"
    if (m == 6 and day >= 2) or m == 7 or (m == 8 and day <= 15):
        return "summer"
    if (m == 8 and day >= 16) or m == 9 or m == 10 or (m == 11 and day <= 1):
        return "fall"
    return "winter"


def current_user():
    return session.get("user")


def login_required(fn):
    from functools import wraps
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "Not logged in"}), 401
        return fn(*args, **kwargs)
    return wrapper


def user_dir(user_id: int) -> str:
    return os.path.join(UPLOAD_BASE, f"user_{user_id}")


def safe_folder_name(name: str) -> str:
    """Convert a label/variety to a safe folder name."""
    return name.strip().lower().replace(" ", "_").replace("/", "-")


# ── Pages ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "home.html")

@app.route("/upload")
def upload_page():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "upload.html")

@app.route("/organize")
def organize_page():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "organize.html")


# ── Auth ───────────────────────────────────────────────────────────────────────

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    result = create_user(username, password)
    if "error" in result:
        return jsonify(result), 409
    session["user"] = result
    return jsonify({"success": True, "user": result})

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    user = verify_user(data.get("username", ""), data.get("password", ""))
    if not user:
        return jsonify({"error": "Invalid username or password"}), 401
    session["user"] = user
    return jsonify({"success": True, "user": user})

@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True})

@app.route("/api/me")
def me():
    user = current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify(user)


# ── Stats ──────────────────────────────────────────────────────────────────────

@app.route("/api/stats")
@login_required
def stats():
    return jsonify(get_stats(current_user()["id"]))


# ── Upload ─────────────────────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
@login_required
def upload_photo():
    user = current_user()
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    manual_date = request.form.get("date", "").strip()

    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    original_filename = os.path.basename(
        file.filename.replace('/', os.sep).replace('\\', os.sep)
    )
    ext = os.path.splitext(original_filename)[1].lower()

    if ext in VIDEO_EXTENSIONS:
        return jsonify({"error": "video"}), 415

    if not is_supported(original_filename):
        return jsonify({"error": "Unsupported file type"}), 400

    inbox_dir = os.path.join(user_dir(user["id"]), "inbox")
    os.makedirs(inbox_dir, exist_ok=True)

    temp_path = os.path.join(inbox_dir, f"_temp_{original_filename}")
    file.save(temp_path)

    date_taken, exif_found = read_date_taken(temp_path)

    if not exif_found and manual_date:
        try:
            date_taken = datetime.strptime(manual_date, "%Y-%m-%d")
            exif_found = False
        except ValueError:
            pass

    if date_taken is None:
        os.remove(temp_path)
        return jsonify({"error": "no_date",
                        "message": "No EXIF date found. Please set the date manually."}), 422

    existing = get_existing_filenames(inbox_dir)
    stored_filename = build_stored_filename(date_taken, "photo", ext, existing)
    final_path = os.path.join(inbox_dir, stored_filename)

    shutil.move(temp_path, final_path)
    write_date_to_exif(final_path, date_taken)

    dt = date_taken.date() if hasattr(date_taken, 'date') else date_taken
    photo_id = insert_photo(
        user_id=user["id"],
        original_filename=original_filename,
        stored_filename=stored_filename,
        file_path=final_path,
        date_taken=dt,
        exif_found=exif_found
    )
    log_action(photo_id, "uploaded", original_filename)

    return jsonify({
        "success": True,
        "photo_id": photo_id,
        "stored_filename": stored_filename,
        "date_taken": date_taken.strftime("%m-%d-%Y") if hasattr(date_taken, 'strftime') else str(date_taken),
    })


# ── Photos ─────────────────────────────────────────────────────────────────────

@app.route("/api/photos")
@login_required
def all_photos():
    return jsonify(get_all_photos(current_user()["id"]))

@app.route("/api/photos/label/<path:label>")
@login_required
def photos_by_label(label):
    return jsonify(get_photos_by_label(current_user()["id"], label))

@app.route("/api/photos/label/<path:label>/variety/<path:variety>")
@login_required
def photos_by_label_variety(label, variety):
    return jsonify(get_photos_by_label_variety(current_user()["id"], label, variety))

@app.route("/api/photos/year/<int:year>")
@login_required
def photos_by_year(year):
    return jsonify(get_photos_by_year(current_user()["id"], year))

@app.route("/api/photos/year/<int:year>/season/<season>")
@login_required
def photos_by_year_season(year, season):
    return jsonify(get_photos_by_year_season(current_user()["id"], year, season))

@app.route("/api/labels")
@login_required
def labels():
    return jsonify(get_all_labels(current_user()["id"]))

@app.route("/api/plant-tree")
@login_required
def plant_tree():
    return jsonify(get_plant_tree(current_user()["id"]))

@app.route("/api/year-tree")
@login_required
def year_tree():
    return jsonify(get_year_season_tree(current_user()["id"]))


# ── Label & variety assignment ─────────────────────────────────────────────────

@app.route("/api/photos/label", methods=["POST"])
@login_required
def assign_label():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    label = (data.get("label") or "").strip().lower()
    variety = (data.get("variety") or "").strip().lower()
    if not photo_ids:
        return jsonify({"error": "No photos selected"}), 400
    if not label:
        return jsonify({"error": "No label provided"}), 400

    affected = set_labels(photo_ids, label, current_user()["id"])
    if variety:
        set_variety(photo_ids, variety, current_user()["id"])

    return jsonify({"success": True, "updated": affected})


@app.route("/api/photos/variety", methods=["POST"])
@login_required
def assign_variety():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    variety = (data.get("variety") or "").strip().lower()
    if not photo_ids:
        return jsonify({"error": "No photos selected"}), 400

    affected = set_variety(photo_ids, variety if variety else None, current_user()["id"])
    return jsonify({"success": True, "updated": affected})


# ── Season organize ─────────────────────────────────────────────────────────────

@app.route("/api/organize/seasons", methods=["POST"])
@login_required
def organize_seasons():
    user = current_user()
    photos = get_all_photos(user["id"])
    organized = skipped = 0

    for photo in photos:
        if not photo["date_taken"]:
            skipped += 1
            continue

        d = date.fromisoformat(str(photo["date_taken"]))
        season = get_season(d)
        year = d.year

        season_dir = os.path.join(user_dir(user["id"]), str(year), season)
        os.makedirs(season_dir, exist_ok=True)

        src = photo["file_path"]
        if not os.path.exists(src):
            skipped += 1
            continue

        dest_path = os.path.join(season_dir, photo["stored_filename"])
        counter = 2
        base, ext = os.path.splitext(photo["stored_filename"])
        while os.path.exists(dest_path):
            dest_path = os.path.join(season_dir, f"{base}_{counter}{ext}")
            counter += 1

        shutil.copy2(src, dest_path)
        set_season(photo["id"], season, year, dest_path, user["id"])
        log_action(photo["id"], "season_copy", f"Copied to {year}/{season}")
        organized += 1

    return jsonify({"success": True, "organized": organized, "skipped": skipped})


# ── Plant directory organize ────────────────────────────────────────────────────

@app.route("/api/organize/plants", methods=["POST"])
@login_required
def organize_plants():
    user = current_user()
    photos = get_all_photos(user["id"])
    organized = skipped = 0

    for photo in photos:
        if not photo["label"]:
            skipped += 1
            continue

        label_folder = safe_folder_name(photo["label"])
        variety = photo.get("variety") or ""
        variety_folder = safe_folder_name(variety) if variety else "no-variety"

        plant_dir = os.path.join(user_dir(user["id"]), "plants",
                                 label_folder, variety_folder)
        os.makedirs(plant_dir, exist_ok=True)

        src = photo["file_path"]
        if not os.path.exists(src):
            skipped += 1
            continue

        dest_path = os.path.join(plant_dir, photo["stored_filename"])
        counter = 2
        base, ext = os.path.splitext(photo["stored_filename"])
        while os.path.exists(dest_path):
            dest_path = os.path.join(plant_dir, f"{base}_{counter}{ext}")
            counter += 1

        shutil.copy2(src, dest_path)
        set_plant_copy_path(photo["id"], dest_path, user["id"])
        log_action(photo["id"], "plant_copy",
                   f"Copied to plants/{label_folder}/{variety_folder}")
        organized += 1

    return jsonify({"success": True, "organized": organized, "skipped": skipped})


# ── Trash ──────────────────────────────────────────────────────────────────────

@app.route("/api/photos/trash", methods=["POST"])
@login_required
def move_to_trash():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    if not photo_ids:
        return jsonify({"error": "No photos provided"}), 400
    user = current_user()

    conn_mod = __import__('database').get_connection()
    cursor = conn_mod.cursor()
    ph = ",".join("?"*len(photo_ids))
    cursor.execute(f"SELECT * FROM photos WHERE id IN ({ph}) AND user_id = ?",
                   photo_ids + [user["id"]])
    photos = [dict(r) for r in cursor.fetchall()]
    conn_mod.close()

    trash_dir = os.path.join(user_dir(user["id"]), "trash")
    os.makedirs(trash_dir, exist_ok=True)

    for photo in photos:
        src = photo["file_path"]
        if os.path.exists(src):
            dest = os.path.join(trash_dir, photo["stored_filename"])
            counter = 2
            base, ext = os.path.splitext(photo["stored_filename"])
            while os.path.exists(dest):
                dest = os.path.join(trash_dir, f"{base}_{counter}{ext}")
                counter += 1
            shutil.move(src, dest)

    affected = trash_photos(photo_ids, user["id"])
    return jsonify({"success": True, "trashed": affected})


@app.route("/api/photos/restore", methods=["POST"])
@login_required
def restore_from_trash():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    if not photo_ids:
        return jsonify({"error": "No photos provided"}), 400
    user = current_user()

    conn_mod = __import__('database').get_connection()
    cursor = conn_mod.cursor()
    ph = ",".join("?"*len(photo_ids))
    cursor.execute(f"SELECT * FROM photos WHERE id IN ({ph}) AND user_id = ?",
                   photo_ids + [user["id"]])
    photos = [dict(r) for r in cursor.fetchall()]
    conn_mod.close()

    inbox_dir = os.path.join(user_dir(user["id"]), "inbox")
    trash_dir = os.path.join(user_dir(user["id"]), "trash")
    os.makedirs(inbox_dir, exist_ok=True)

    for photo in photos:
        trash_path = os.path.join(trash_dir, photo["stored_filename"])
        if os.path.exists(trash_path):
            shutil.move(trash_path, os.path.join(inbox_dir, photo["stored_filename"]))

    affected = restore_photos(photo_ids, user["id"])
    return jsonify({"success": True, "restored": affected})


@app.route("/api/photos/delete-permanent", methods=["POST"])
@login_required
def delete_permanent():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    if not photo_ids:
        return jsonify({"error": "No photos provided"}), 400
    paths = permanently_delete_photos(photo_ids, current_user()["id"])
    for file_path, season_path, plant_path in paths:
        for p in [file_path, season_path, plant_path]:
            if p and os.path.exists(p):
                try: os.remove(p)
                except: pass
    return jsonify({"success": True, "deleted": len(paths)})


@app.route("/api/photos/trash", methods=["GET"])
@login_required
def list_trash():
    return jsonify(get_trashed_photos(current_user()["id"]))

@app.route("/api/open-folder/<folder_type>")
@login_required
def open_folder(folder_type):
    user = current_user()
    base = user_dir(user["id"])
    if folder_type == "plants":
        path = os.path.join(base, "plants")
    elif folder_type == "seasons":
        path = os.path.join(base)  # year folders live directly here
    else:
        return jsonify({"error": "Unknown folder"}), 400

    os.makedirs(path, exist_ok=True)
    os.startfile(path)
    return jsonify({"success": True})


# ── Serve files ─────────────────────────────────────────────────────────────────

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    if not current_user():
        return jsonify({"error": "Not logged in"}), 401
    return send_from_directory(UPLOAD_BASE, filename)


# ── Run ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("Plant Photo Archive running at http://localhost:5000")
    print("Mobile: http://192.168.1.105:5000/mobile")
    app.run(debug=True, port=5000, host='0.0.0.0')