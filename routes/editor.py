"""
editor.py — Image editing routes (rotate, crop, resize, zip download, label presets).
"""
import os
import io
import shutil
import zipfile
from flask import Blueprint, request, jsonify, send_file

from database import execute, execute_write
from helpers import current_user, login_required, user_dir, UPLOAD_BASE

bp = Blueprint("editor", __name__)


# ── Label / variety presets ────────────────────────────────────────────────────

@bp.route("/api/presets/labels")
@login_required
def get_label_presets():
    """Return all unique labels the user has ever used."""
    uid = current_user()["id"]
    rows = execute("""
        SELECT DISTINCT label FROM photos
        WHERE user_id = :uid AND label IS NOT NULL AND label != ''
        ORDER BY label
    """, {"uid": uid})
    return jsonify([r["label"] for r in rows])


@bp.route("/api/presets/varieties")
@login_required
def get_variety_presets():
    """Return varieties, optionally filtered by label."""
    uid = current_user()["id"]
    label = request.args.get("label", "").strip()
    if label:
        rows = execute("""
            SELECT DISTINCT variety FROM photos
            WHERE user_id = :uid AND label = :label
              AND variety IS NOT NULL AND variety != ''
            ORDER BY variety
        """, {"uid": uid, "label": label})
    else:
        rows = execute("""
            SELECT DISTINCT variety FROM photos
            WHERE user_id = :uid
              AND variety IS NOT NULL AND variety != ''
            ORDER BY variety
        """, {"uid": uid})
    return jsonify([r["variety"] for r in rows])


# ── Zip download ───────────────────────────────────────────────────────────────

@bp.route("/api/photos/download-zip", methods=["POST"])
@login_required
def download_zip():
    """Zip selected photos and send as download."""
    data = request.get_json()
    photo_ids = data.get("photo_ids", [])
    folder_name = data.get("folder_name", "plant_archive_photos")
    if not photo_ids:
        return jsonify({"error": "No photos selected"}), 400

    uid = current_user()["id"]
    placeholders = ', '.join(f':id{i}' for i in range(len(photo_ids)))
    params = {f'id{i}': pid for i, pid in enumerate(photo_ids)}
    params['uid'] = uid

    photos = execute(
        f"SELECT * FROM photos WHERE id IN ({placeholders}) AND user_id = :uid",
        params
    )

    if not photos:
        return jsonify({"error": "No photos found"}), 404

    # Build zip in memory
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for photo in photos:
            src = photo["file_path"]
            if os.path.exists(src):
                arcname = os.path.join(folder_name, photo["stored_filename"])
                zf.write(src, arcname)

    zip_buffer.seek(0)
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f"{folder_name}.zip"
    )


# ── Image editing ──────────────────────────────────────────────────────────────

def _get_photo_or_404(photo_id, uid):
    rows = execute(
        "SELECT * FROM photos WHERE id = :id AND user_id = :uid",
        {"id": photo_id, "uid": uid}
    )
    return rows[0] if rows else None


def _backup_original(photo):
    """Copy original to originals/ folder if not already backed up."""
    src = photo["file_path"]
    uid = photo["user_id"]
    orig_dir = os.path.join(user_dir(uid), "originals")
    os.makedirs(orig_dir, exist_ok=True)
    dest = os.path.join(orig_dir, photo["stored_filename"])
    if not os.path.exists(dest):
        shutil.copy2(src, dest)
    return dest


@bp.route("/api/photos/<int:photo_id>/rotate", methods=["POST"])
@login_required
def rotate_photo(photo_id):
    """Rotate a photo by degrees (90, 180, 270, -90)."""
    from PIL import Image
    data = request.get_json()
    degrees = int(data.get("degrees", 90))
    uid = current_user()["id"]

    photo = _get_photo_or_404(photo_id, uid)
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    _backup_original(photo)

    src = photo["file_path"]
    img = Image.open(src)
    # PIL rotates counter-clockwise, so negate for intuitive UX
    rotated = img.rotate(-degrees, expand=True)
    rotated.save(src, quality=95)

    # Regenerate thumbnail
    _regenerate_thumbnail(photo, rotated)

    return jsonify({"success": True})


@bp.route("/api/photos/<int:photo_id>/crop", methods=["POST"])
@login_required
def crop_photo(photo_id):
    """Crop a photo. Expects {x, y, width, height} as % of original dimensions."""
    from PIL import Image
    data = request.get_json()
    uid = current_user()["id"]

    photo = _get_photo_or_404(photo_id, uid)
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    _backup_original(photo)

    src = photo["file_path"]
    img = Image.open(src)
    w, h = img.size

    # Coords can be absolute px or % (0-1)
    x      = int(data.get("x", 0))
    y      = int(data.get("y", 0))
    width  = int(data.get("width", w))
    height = int(data.get("height", h))

    cropped = img.crop((x, y, x + width, y + height))
    cropped.save(src, quality=95)
    _regenerate_thumbnail(photo, cropped)

    return jsonify({"success": True})


@bp.route("/api/photos/<int:photo_id>/resize", methods=["POST"])
@login_required
def resize_photo(photo_id):
    """Resize a photo. Expects {width, height} in px (maintains aspect if one is 0)."""
    from PIL import Image
    data = request.get_json()
    uid = current_user()["id"]

    photo = _get_photo_or_404(photo_id, uid)
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    _backup_original(photo)

    src = photo["file_path"]
    img = Image.open(src)
    orig_w, orig_h = img.size

    new_w = int(data.get("width", 0))
    new_h = int(data.get("height", 0))

    if new_w and not new_h:
        new_h = int(orig_h * new_w / orig_w)
    elif new_h and not new_w:
        new_w = int(orig_w * new_h / orig_h)
    elif not new_w and not new_h:
        return jsonify({"error": "Provide width or height"}), 400

    resized = img.resize((new_w, new_h), Image.LANCZOS)
    resized.save(src, quality=95)
    _regenerate_thumbnail(photo, resized)

    return jsonify({"success": True})


@bp.route("/api/photos/<int:photo_id>/restore-original", methods=["POST"])
@login_required
def restore_original(photo_id):
    """Restore photo from originals/ backup."""
    uid = current_user()["id"]
    photo = _get_photo_or_404(photo_id, uid)
    if not photo:
        return jsonify({"error": "Photo not found"}), 404

    orig_path = os.path.join(user_dir(uid), "originals", photo["stored_filename"])
    if not os.path.exists(orig_path):
        return jsonify({"error": "No original backup found"}), 404

    shutil.copy2(orig_path, photo["file_path"])

    # Regenerate thumbnail from restored original
    from PIL import Image
    img = Image.open(photo["file_path"])
    _regenerate_thumbnail(photo, img)

    return jsonify({"success": True})


def _regenerate_thumbnail(photo, img=None):
    """Regenerate thumbnail after editing."""
    from PIL import Image
    thumb_path = os.path.join(
        os.path.dirname(UPLOAD_BASE), 'thumbnails',
        f"user_{photo['user_id']}", 'inbox',
        photo["stored_filename"]
    )
    os.makedirs(os.path.dirname(thumb_path), exist_ok=True)
    if img is None:
        img = Image.open(photo["file_path"])
    thumb = img.copy()
    thumb.thumbnail((400, 400), Image.LANCZOS)
    thumb.save(thumb_path, 'JPEG', quality=85, optimize=True)