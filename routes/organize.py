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