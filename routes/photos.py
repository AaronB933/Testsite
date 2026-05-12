"""
photos.py — Photo upload, fetching, labeling, and serving.
"""
import os
import shutil
import hashlib
import threading
from datetime import datetime
from flask import Blueprint, request, jsonify, send_from_directory

from database import (insert_photo, log_action, execute,
                     get_all_photos, count_all_photos,
                     get_photos_by_label, count_photos_by_label,
                     get_photos_by_label_variety,
                     get_photos_by_year_season, get_photos_by_year,
                     get_all_labels, get_plant_tree, get_year_season_tree,
                     set_labels, set_variety, get_stats)
from exifutils import (read_date_taken, write_date_to_exif, build_stored_filename,
                       get_existing_filenames, is_supported)
from helpers import (current_user, login_required, user_dir,
                     UPLOAD_BASE, VIDEO_EXTENSIONS)

bp = Blueprint("photos", __name__)

# In-memory cache of existing filenames per user
_filename_cache = {}
_filename_cache_lock = threading.Lock()

# In-memory cache of existing file hashes per user — avoids DB query per upload
_hash_cache = {}
_hash_cache_lock = threading.Lock()

def get_cached_filenames(inbox_dir, user_id):
    with _filename_cache_lock:
        if user_id not in _filename_cache:
            _filename_cache[user_id] = set(
                os.listdir(inbox_dir) if os.path.exists(inbox_dir) else []
            )
        return _filename_cache[user_id]

def add_to_filename_cache(user_id, filename):
    with _filename_cache_lock:
        if user_id in _filename_cache:
            _filename_cache[user_id].add(filename)



def _load_hash_cache(user_id):
    """Load hash cache from DB (must be called with lock held)."""
    if user_id not in _hash_cache:
        from database import execute
        rows = execute(
            "SELECT file_hash FROM photos WHERE user_id = :uid AND file_hash IS NOT NULL",
            {"uid": user_id}
        )
        _hash_cache[user_id] = {r["file_hash"] for r in rows}
    return _hash_cache[user_id]

def check_and_add_hash(user_id, file_hash):
    """Atomically check if hash exists and add it. Returns True if duplicate."""
    with _hash_cache_lock:
        cache = _load_hash_cache(user_id)
        if file_hash in cache:
            return True
        cache.add(file_hash)
        return False


# ── Stats ──────────────────────────────────────────────────────────────────────

@bp.route("/api/stats")
@login_required
def stats():
    return jsonify(get_stats(current_user()["id"]))


# ── Upload ─────────────────────────────────────────────────────────────────────

@bp.route("/api/upload", methods=["POST"])
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
        file.filename.replace('/', os.sep).replace('\\\\', os.sep)
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

    # Duplicate check
    with open(temp_path, 'rb') as f:
        file_hash = hashlib.md5(f.read()).hexdigest()

    if check_and_add_hash(user["id"], file_hash):
        os.remove(temp_path)
        return jsonify({
            "error": "duplicate",
            "message": "Already uploaded"
        }), 409

    date_taken, exif_found = read_date_taken(temp_path)

    if not exif_found and manual_date:
        try:
            date_taken = datetime.strptime(manual_date, "%Y-%m-%d")
            exif_found = False
        except ValueError:
            pass

    undated = False
    if date_taken is None:
        date_taken = datetime(1900, 1, 1)
        exif_found = False
        undated = True

    # Convert HEIC to JPEG
    if ext.lower() in {'.heic', '.heif'}:
        try:
            from PIL import Image
            from pillow_heif import register_heif_opener
            register_heif_opener()
            img = Image.open(temp_path)
            stored_filename_base = build_stored_filename(date_taken, "photo", ".jpg",
                                                          get_cached_filenames(inbox_dir, user["id"]))
            final_path = os.path.join(inbox_dir, stored_filename_base)
            img.save(final_path, 'JPEG', quality=95)
            os.remove(temp_path)
            stored_filename = stored_filename_base
        except Exception as e:
            print(f"HEIC conversion failed: {e}")
            stored_filename = build_stored_filename(date_taken, "photo", ext,
                                                     get_cached_filenames(inbox_dir, user["id"]))
            final_path = os.path.join(inbox_dir, stored_filename)
            shutil.move(temp_path, final_path)
    else:
        stored_filename = build_stored_filename(date_taken, "photo", ext,
                                                 get_cached_filenames(inbox_dir, user["id"]))
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
        exif_found=exif_found,
        file_hash=file_hash
    )
    log_action(photo_id, "uploaded", original_filename)

    # Auto-label undated photos and copy to undated folder
    if undated:
        from database import set_labels
        set_labels([photo_id], "No date found", user["id"])
        # Also copy to undated folder for easy access
        try:
            undated_dir = os.path.join(user_dir(user["id"]), "undated")
            os.makedirs(undated_dir, exist_ok=True)
            undated_dest = os.path.join(undated_dir, stored_filename)
            if not os.path.exists(undated_dest):
                shutil.copy2(final_path, undated_dest)
        except Exception as e:
            print(f"Could not copy to undated folder: {e}")

    # Hash already added atomically in check_and_add_hash
    add_to_filename_cache(user["id"], stored_filename)

    # Generate thumbnail in background — fast uploads, thumbnail ready shortly after
    def _make_thumb():
        try:
            from PIL import Image as PILImage
            thumb_dir = os.path.join(
                os.path.dirname(UPLOAD_BASE), 'thumbnails',
                f"user_{user['id']}", 'inbox'
            )
            os.makedirs(thumb_dir, exist_ok=True)
            thumb_path = os.path.join(thumb_dir, stored_filename)
            if not os.path.exists(thumb_path):
                img = PILImage.open(final_path)
                img.thumbnail((400, 400), PILImage.LANCZOS)
                img.save(thumb_path, 'JPEG', quality=85, optimize=True)
        except Exception as e:
            print(f"Thumbnail generation failed: {e}")
    threading.Thread(target=_make_thumb, daemon=True).start()

    return jsonify({
        "success": True,
        "photo_id": photo_id,
        "stored_filename": stored_filename,
        "date_taken": None if undated else (date_taken.strftime("%m-%d-%Y") if hasattr(date_taken, 'strftime') else str(date_taken)),
        "undated": undated,
    })


# ── All photos (no pagination — for virtual scroller) ─────────────────────────────

@bp.route("/api/photos/all")
@login_required
def all_photos_full():
    """Returns ALL photos for a view with no pagination limit.
    Used by the virtual scroller which manages rendering itself."""
    uid = current_user()["id"]
    view = request.args.get("view", "all")
    from database import (get_photos_by_label_variety,
                          get_photos_by_year_season, get_photos_by_year,
                          get_trashed_photos as _get_trashed)

    if view == "all":
        photos = execute(
            "SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE ORDER BY date_taken DESC",
            {"uid": uid}
        )
    elif view == "inbox":
        photos = execute(
            "SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE AND (label IS NULL OR label = '') ORDER BY date_taken DESC",
            {"uid": uid}
        )
    elif view == "trash":
        photos = _get_trashed(uid)
    elif view.startswith("label:"):
        label = view[6:]
        photos = db_execute(
            "SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE AND label = :label ORDER BY date_taken DESC",
            {"uid": uid, "label": label}
        )
    elif view.startswith("plant:"):
        parts = view.split(":")
        photos = get_photos_by_label_variety(uid, parts[1], parts[2])
    elif view.startswith("year:"):
        parts = view.split(":")
        if len(parts) > 2 and parts[2]:
            photos = get_photos_by_year_season(uid, int(parts[1]), parts[2])
        else:
            photos = get_photos_by_year(uid, int(parts[1]))
    else:
        photos = []

    return jsonify({"photos": photos, "total": len(photos)})


# ── Photo lists ─────────────────────────────────────────────────────────────────

@bp.route("/api/photos")
@login_required
def all_photos():
    uid = current_user()["id"]
    limit = int(request.args.get("limit", 50))
    offset = int(request.args.get("offset", 0))
    photos = get_all_photos(uid, limit=limit, offset=offset)
    total = count_all_photos(uid)
    return jsonify({"photos": photos, "total": total, "limit": limit, "offset": offset})


@bp.route("/api/photos/label/<path:label>")
@login_required
def photos_by_label(label):
    uid = current_user()["id"]
    limit = int(request.args.get("limit", 50))
    offset = int(request.args.get("offset", 0))
    photos = get_photos_by_label(uid, label, limit=limit, offset=offset)
    total = count_photos_by_label(uid, label)
    return jsonify({"photos": photos, "total": total, "limit": limit, "offset": offset})


@bp.route("/api/photos/label/<path:label>/variety/<path:variety>")
@login_required
def photos_by_label_variety(label, variety):
    photos = get_photos_by_label_variety(current_user()["id"], label, variety)
    return jsonify({"photos": photos, "total": len(photos)})


@bp.route("/api/photos/year/<int:year>")
@login_required
def photos_by_year(year):
    photos = get_photos_by_year(current_user()["id"], year)
    return jsonify({"photos": photos, "total": len(photos)})


@bp.route("/api/photos/year/<int:year>/season/<season>")
@login_required
def photos_by_year_season(year, season):
    photos = get_photos_by_year_season(current_user()["id"], year, season)
    return jsonify({"photos": photos, "total": len(photos)})


@bp.route("/api/labels")
@login_required
def labels():
    return jsonify(get_all_labels(current_user()["id"]))


@bp.route("/api/plant-tree")
@login_required
def plant_tree():
    return jsonify(get_plant_tree(current_user()["id"]))


@bp.route("/api/year-tree")
@login_required
def year_tree():
    return jsonify(get_year_season_tree(current_user()["id"]))


# ── Label & variety assignment ─────────────────────────────────────────────────

@bp.route("/api/photos/label", methods=["POST"])
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


@bp.route("/api/photos/variety", methods=["POST"])
@login_required
def assign_variety():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    variety = (data.get("variety") or "").strip().lower()
    if not photo_ids:
        return jsonify({"error": "No photos selected"}), 400
    affected = set_variety(photo_ids, variety if variety else None, current_user()["id"])
    return jsonify({"success": True, "updated": affected})


# ── Serve files ─────────────────────────────────────────────────────────────────

@bp.route("/uploads/<path:filename>")
def serve_upload(filename):
    if not current_user():
        return jsonify({"error": "Not logged in"}), 401
    from flask import make_response
    response = make_response(send_from_directory(UPLOAD_BASE, filename))
    # Cache images aggressively in browser — 7 days
    # This makes re-scrolling instant since images are already in browser cache
    response.headers['Cache-Control'] = 'private, max-age=604800'
    return response


@bp.route("/thumbnails/<path:filename>")
def serve_thumbnail(filename):
    """Serve pre-generated thumbnails. Strong caching so browser never re-fetches."""
    if not current_user():
        return jsonify({"error": "Not logged in"}), 401
    from flask import make_response
    thumb_base = os.path.join(os.path.dirname(UPLOAD_BASE), 'thumbnails')
    thumb_path = os.path.join(thumb_base, filename)
    if not os.path.exists(thumb_path):
        # Thumbnail not ready yet — generate it on the fly and cache it
        try:
            from PIL import Image as PILImage
            src_path = os.path.join(UPLOAD_BASE, filename)
            if os.path.exists(src_path):
                os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
                img = PILImage.open(src_path)
                img.thumbnail((400, 400), PILImage.LANCZOS)
                img.save(thumb_path, 'JPEG', quality=85, optimize=True)
            else:
                return serve_upload(filename)
        except Exception:
            return serve_upload(filename)
    response = make_response(send_from_directory(thumb_base, filename))
    # Strong cache — browser keeps thumbnail for 30 days, never re-requests
    response.headers['Cache-Control'] = 'private, max-age=2592000, immutable'
    response.headers['Vary'] = 'Cookie'
    return response