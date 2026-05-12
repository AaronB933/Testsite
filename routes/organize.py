"""
organize.py — Organize photos into season and plant folder structures.
"""
import os
import shutil
from datetime import date
from flask import Blueprint, jsonify

from database import execute, set_season, set_plant_copy_path, log_action
from helpers import (current_user, login_required, user_dir,
                     safe_folder_name, get_season)

bp = Blueprint("organize", __name__)


@bp.route("/api/organize/seasons", methods=["POST"])
@login_required
def organize_seasons():
    user = current_user()
    photos = execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        ORDER BY date_taken DESC
    """, {"uid": user["id"]})
    organized = skipped = 0

    for photo in photos:
        if not photo["date_taken"]:
            skipped += 1
            continue
        try:
            dt_str = str(photo["date_taken"])
            # Handle both "2026-04-25" and "2026-04-25 00:00:00" formats
            d = date.fromisoformat(dt_str[:10])
        except Exception as e:
            print(f"Date parse error for photo {photo['id']}: {photo['date_taken']} — {e}")
            skipped += 1
            continue
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


@bp.route("/api/organize/plants", methods=["POST"])
@login_required
def organize_plants():
    user = current_user()
    photos = execute("""
        SELECT * FROM photos WHERE user_id = :uid AND trashed = FALSE
        ORDER BY date_taken DESC
    """, {"uid": user["id"]})
    organized = skipped = 0

    for photo in photos:
        if not photo["label"]:
            skipped += 1
            continue
        label_folder = safe_folder_name(photo["label"])
        variety = photo.get("variety") or ""
        variety_folder = safe_folder_name(variety) if variety else "no-variety"
        plant_dir = os.path.join(user_dir(user["id"]), "plants", label_folder, variety_folder)
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
        log_action(photo["id"], "plant_copy", f"Copied to plants/{label_folder}/{variety_folder}")
        organized += 1

    return jsonify({"success": True, "organized": organized, "skipped": skipped})


@bp.route("/api/open-folder/<folder_type>")
@login_required
def open_folder(folder_type):
    user = current_user()
    base = user_dir(user["id"])
    if folder_type == "plants":
        path = os.path.join(base, "plants")
    elif folder_type == "seasons":
        path = base
    else:
        return jsonify({"error": "Unknown folder"}), 400
    os.makedirs(path, exist_ok=True)
    os.startfile(path)
    return jsonify({"success": True})


@bp.route("/api/organize/create-folder", methods=["POST"])
@login_required
def create_folder():
    from flask import request
    user = current_user()
    data = request.json
    folder_type = data.get("type")
    base = user_dir(user["id"])

    if folder_type == "label":
        path = os.path.join(base, safe_folder_name(data["name"]))
    elif folder_type == "year":
        path = os.path.join(base, str(int(data["year"])))
    elif folder_type == "plant":
        path = os.path.join(base, "plants", safe_folder_name(data["name"]))
    else:
        return jsonify({"success": False, "error": "unknown type"}), 400

    os.makedirs(path, exist_ok=True)
    return jsonify({"success": True, "path": path})


@bp.route("/api/organize/delete-folder", methods=["POST"])
@login_required
def delete_folder():
    """Delete an organized folder (not the original photos in inbox)."""
    import shutil as _shutil
    from flask import request
    user = current_user()
    data = request.json
    folder_type = data.get("type")
    base = user_dir(user["id"])

    if folder_type == "label":
        path = os.path.join(base, safe_folder_name(data["name"]))
    elif folder_type == "year":
        path = os.path.join(base, str(int(data["year"])))
    elif folder_type == "season":
        path = os.path.join(base, str(int(data["year"])), data["season"])
    elif folder_type == "plant":
        path = os.path.join(base, "plants", safe_folder_name(data["name"]))
    else:
        return jsonify({"success": False, "error": "unknown type"}), 400

    # Safety check — must be within user dir
    if not path.startswith(base):
        return jsonify({"success": False, "error": "invalid path"}), 403

    # Don't delete inbox, trash, undated, badges, originals
    protected = {"inbox", "trash", "undated", "badges", "originals"}
    folder_name = os.path.basename(path)
    if folder_name in protected:
        return jsonify({"success": False, "error": "cannot delete protected folder"}), 403

    if os.path.exists(path):
        _shutil.rmtree(path)

    return jsonify({"success": True})