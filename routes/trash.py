"""
trash.py — Move photos to trash, restore, permanently delete.
"""
import os
import shutil
from flask import Blueprint, request, jsonify

from database import (execute, trash_photos, restore_photos,
                     permanently_delete_photos, get_trashed_photos)
from helpers import current_user, login_required, user_dir

bp = Blueprint("trash", __name__)


@bp.route("/api/photos/trash", methods=["POST"])
@login_required
def move_to_trash():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    if not photo_ids:
        return jsonify({"error": "No photos provided"}), 400
    user = current_user()

    placeholders = ', '.join(f':id{i}' for i in range(len(photo_ids)))
    params = {f'id{i}': pid for i, pid in enumerate(photo_ids)}
    params['uid'] = user['id']
    photos = execute(
        f"SELECT * FROM photos WHERE id IN ({placeholders}) AND user_id = :uid",
        params
    )

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


@bp.route("/api/photos/restore", methods=["POST"])
@login_required
def restore_from_trash():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    if not photo_ids:
        return jsonify({"error": "No photos provided"}), 400
    user = current_user()

    placeholders = ', '.join(f':id{i}' for i in range(len(photo_ids)))
    params = {f'id{i}': pid for i, pid in enumerate(photo_ids)}
    params['uid'] = user['id']
    photos = execute(
        f"SELECT * FROM photos WHERE id IN ({placeholders}) AND user_id = :uid",
        params
    )

    inbox_dir = os.path.join(user_dir(user["id"]), "inbox")
    trash_dir = os.path.join(user_dir(user["id"]), "trash")
    os.makedirs(inbox_dir, exist_ok=True)

    for photo in photos:
        trash_path = os.path.join(trash_dir, photo["stored_filename"])
        if os.path.exists(trash_path):
            shutil.move(trash_path, os.path.join(inbox_dir, photo["stored_filename"]))

    affected = restore_photos(photo_ids, user["id"])
    return jsonify({"success": True, "restored": affected})


@bp.route("/api/photos/delete-permanent", methods=["POST"])
@login_required
def delete_permanent():
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    if not photo_ids:
        return jsonify({"error": "No photos provided"}), 400
    user = current_user()
    trash_dir = os.path.join(user_dir(user["id"]), "trash")
    paths = permanently_delete_photos(photo_ids, user["id"])
    for stored_filename, file_path, season_path, plant_path in paths:
        trash_path = os.path.join(trash_dir, stored_filename)
        for p in [trash_path, file_path, season_path, plant_path]:
            if p and os.path.exists(p):
                try: os.remove(p)
                except: pass
    return jsonify({"success": True, "deleted": len(paths)})


@bp.route("/api/photos/trash", methods=["GET"])
@login_required
def list_trash():
    return jsonify(get_trashed_photos(current_user()["id"]))