"""
tracker.py — Plant tracker routes (plants, care logs, issues, photos, presets).
"""
import os
from flask import Blueprint, request, jsonify

from database import (execute,
                     create_tracked_plant, update_tracked_plant, delete_tracked_plant,
                     get_tracked_plants, get_tracked_plant,
                     add_care_log, get_care_logs, delete_care_log,
                     add_issue, update_issue, delete_issue, get_issues,
                     add_tracker_photo, get_tracker_photos, delete_tracker_photo,
                     get_type_presets, get_product_presets)
from helpers import current_user, login_required, user_dir

bp = Blueprint("tracker", __name__)


# ── Plants ─────────────────────────────────────────────────────────────────────

@bp.route("/api/tracker/plants", methods=["GET"])
@login_required
def tracker_list():
    return jsonify(get_tracked_plants(current_user()["id"]))


@bp.route("/api/tracker/plants", methods=["POST"])
@login_required
def tracker_create():
    d = request.get_json()
    u = current_user()
    pid = create_tracked_plant(
        u["id"], d.get("name", "").strip(),
        d.get("plant_type", ""), d.get("variety", ""),
        d.get("pot_size", ""), d.get("location", ""),
        d.get("acquired_date") or None, d.get("notes", "")
    )
    return jsonify({"success": True, "id": pid})


@bp.route("/api/tracker/plants/<int:plant_id>", methods=["GET"])
@login_required
def tracker_get(plant_id):
    p = get_tracked_plant(plant_id, current_user()["id"])
    if not p:
        return jsonify({"error": "Not found"}), 404
    return jsonify(p)


@bp.route("/api/tracker/plants/<int:plant_id>", methods=["PUT"])
@login_required
def tracker_update(plant_id):
    d = request.get_json()
    u = current_user()
    update_tracked_plant(
        plant_id, u["id"], d.get("name", "").strip(),
        d.get("plant_type", ""), d.get("variety", ""),
        d.get("pot_size", ""), d.get("location", ""),
        d.get("acquired_date") or None, d.get("notes", "")
    )
    return jsonify({"success": True})


@bp.route("/api/tracker/plants/<int:plant_id>", methods=["DELETE"])
@login_required
def tracker_delete(plant_id):
    delete_tracked_plant(plant_id, current_user()["id"])
    return jsonify({"success": True})


# ── Care logs ─────────────────────────────────────────────────────────────────

@bp.route("/api/tracker/plants/<int:plant_id>/care", methods=["GET"])
@login_required
def tracker_care_list(plant_id):
    return jsonify(get_care_logs(plant_id, current_user()["id"]))


@bp.route("/api/tracker/plants/<int:plant_id>/care", methods=["POST"])
@login_required
def tracker_care_add(plant_id):
    d = request.get_json()
    u = current_user()
    lid = add_care_log(
        plant_id, u["id"],
        d.get("care_type", ""), d.get("care_date", ""),
        d.get("product", ""), d.get("amount", ""), d.get("notes", "")
    )
    return jsonify({"success": True, "id": lid})


@bp.route("/api/tracker/care/<int:log_id>", methods=["DELETE"])
@login_required
def tracker_care_delete(log_id):
    delete_care_log(log_id, current_user()["id"])
    return jsonify({"success": True})


# ── Issues ────────────────────────────────────────────────────────────────────

@bp.route("/api/tracker/plants/<int:plant_id>/issues", methods=["GET"])
@login_required
def tracker_issues_list(plant_id):
    return jsonify(get_issues(plant_id, current_user()["id"]))


@bp.route("/api/tracker/plants/<int:plant_id>/issues", methods=["POST"])
@login_required
def tracker_issue_add(plant_id):
    d = request.get_json()
    u = current_user()
    iid = add_issue(
        plant_id, u["id"],
        d.get("category", ""), d.get("issue_name", ""),
        d.get("status", "active"), d.get("first_seen") or None,
        d.get("notes", "")
    )
    return jsonify({"success": True, "id": iid})


@bp.route("/api/tracker/issues/<int:issue_id>", methods=["PUT"])
@login_required
def tracker_issue_update(issue_id):
    d = request.get_json()
    update_issue(issue_id, current_user()["id"],
                 d.get("status", "active"),
                 d.get("resolved_date") or None,
                 d.get("notes", ""))
    return jsonify({"success": True})


@bp.route("/api/tracker/issues/<int:issue_id>", methods=["DELETE"])
@login_required
def tracker_issue_delete(issue_id):
    delete_issue(issue_id, current_user()["id"])
    return jsonify({"success": True})


# ── Photos ────────────────────────────────────────────────────────────────────

@bp.route("/api/tracker/plants/<int:plant_id>/photos", methods=["GET"])
@login_required
def tracker_photos_list(plant_id):
    return jsonify(get_tracker_photos(plant_id, current_user()["id"]))


@bp.route("/api/tracker/plants/<int:plant_id>/photos", methods=["POST"])
@login_required
def tracker_photo_add(plant_id):
    u = current_user()
    if "file" in request.files:
        file = request.files["file"]
        caption = request.form.get("caption", "")
        taken_date = request.form.get("taken_date", "") or None
        original = os.path.basename(file.filename.replace("/", os.sep).replace("\\", os.sep))
        tracker_dir = os.path.join(user_dir(u["id"]), "tracker", str(plant_id))
        os.makedirs(tracker_dir, exist_ok=True)
        stored = f"tp_{plant_id}_{original}"
        counter = 2
        base_s, ext_s = os.path.splitext(stored)
        while os.path.exists(os.path.join(tracker_dir, stored)):
            stored = f"{base_s}_{counter}{ext_s}"
            counter += 1
        file.save(os.path.join(tracker_dir, stored))
        tid = add_tracker_photo(plant_id, u["id"], None,
                                os.path.join(tracker_dir, stored),
                                stored, caption, taken_date)
        return jsonify({"success": True, "id": tid, "stored_filename": stored})

    d = request.get_json()
    if d and d.get("archive_photo_id"):
        rows = execute(
            "SELECT * FROM photos WHERE id = :id AND user_id = :uid",
            {"id": d["archive_photo_id"], "uid": u["id"]}
        )
        if not rows:
            return jsonify({"error": "Photo not found"}), 404
        ap = rows[0]
        tid = add_tracker_photo(plant_id, u["id"], ap["id"],
                                ap["file_path"], ap["stored_filename"],
                                d.get("caption", ""), ap["date_taken"])
        return jsonify({"success": True, "id": tid})

    return jsonify({"error": "No file or archive_photo_id"}), 400


@bp.route("/api/tracker/photos/<int:photo_id>", methods=["DELETE"])
@login_required
def tracker_photo_delete(photo_id):
    delete_tracker_photo(photo_id, current_user()["id"])
    return jsonify({"success": True})


# ── Presets ───────────────────────────────────────────────────────────────────

@bp.route("/api/tracker/presets/types")
@login_required
def tracker_type_presets():
    return jsonify(get_type_presets(current_user()["id"]))


@bp.route("/api/tracker/presets/products/<care_type>")
@login_required
def tracker_product_presets(care_type):
    return jsonify(get_product_presets(current_user()["id"], care_type))