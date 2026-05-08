"""
garden.py — Garden planner routes (page, save/load layouts, list badges).
"""
import os
import json
from flask import Blueprint, request, jsonify, send_from_directory

from database import execute, execute_write, execute_write_returning
from helpers import current_user, login_required, user_dir, UPLOAD_BASE

bp = Blueprint("garden", __name__)


@bp.route("/garden")
def garden_page():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "garden.html")


# ── Garden layouts ─────────────────────────────────────────────────────────────

def ensure_garden_table():
    from db import engine
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS garden_layouts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                layout_data TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.commit()


@bp.route("/api/garden/layouts", methods=["GET"])
@login_required
def list_layouts():
    ensure_garden_table()
    rows = execute("""
        SELECT id, name, created_at, updated_at FROM garden_layouts
        WHERE user_id = :uid ORDER BY updated_at DESC
    """, {"uid": current_user()["id"]})
    return jsonify(rows)


@bp.route("/api/garden/layouts", methods=["POST"])
@login_required
def save_layout():
    ensure_garden_table()
    uid = current_user()["id"]
    data = request.get_json()
    name = data.get("name", "My Garden").strip()
    layout_data = json.dumps(data.get("layout", {}))
    layout_id = data.get("id")

    if layout_id:
        execute_write("""
            UPDATE garden_layouts SET name=:name, layout_data=:data,
            updated_at=CURRENT_TIMESTAMP WHERE id=:id AND user_id=:uid
        """, {"name": name, "data": layout_data, "id": layout_id, "uid": uid})
        return jsonify({"success": True, "id": layout_id})
    else:
        new_id = execute_write_returning("""
            INSERT INTO garden_layouts (user_id, name, layout_data)
            VALUES (:uid, :name, :data) RETURNING id
        """, {"uid": uid, "name": name, "data": layout_data})
        return jsonify({"success": True, "id": new_id})


@bp.route("/api/garden/layouts/<int:layout_id>", methods=["GET"])
@login_required
def get_layout(layout_id):
    ensure_garden_table()
    rows = execute("""
        SELECT * FROM garden_layouts WHERE id=:id AND user_id=:uid
    """, {"id": layout_id, "uid": current_user()["id"]})
    if not rows:
        return jsonify({"error": "Not found"}), 404
    row = rows[0]
    return jsonify({
        "id": row["id"],
        "name": row["name"],
        "layout": json.loads(row["layout_data"]),
        "updated_at": row["updated_at"]
    })


@bp.route("/api/garden/layouts/<int:layout_id>", methods=["DELETE"])
@login_required
def delete_layout(layout_id):
    ensure_garden_table()
    execute_write("""
        DELETE FROM garden_layouts WHERE id=:id AND user_id=:uid
    """, {"id": layout_id, "uid": current_user()["id"]})
    return jsonify({"success": True})


# ── Badges list ────────────────────────────────────────────────────────────────

@bp.route("/api/garden/badges")
@login_required
def list_badges():
    """Return saved badge PNG files for use in garden planner."""
    uid = current_user()["id"]
    badges_dir = os.path.join(user_dir(uid), "badges")
    if not os.path.exists(badges_dir):
        return jsonify([])
    badges = []
    for f in os.listdir(badges_dir):
        if f.lower().endswith(('.png', '.jpg', '.jpeg')):
            badges.append({
                "filename": f,
                "url": f"/uploads/user_{uid}/badges/{f}",
                "name": os.path.splitext(f)[0].replace('_', ' ').replace('badge ', '').strip()
            })
    return jsonify(badges)


# ── Texture tiling ─────────────────────────────────────────────────────────────

@bp.route("/api/garden/texture-preview", methods=["POST"])
@login_required
def texture_preview():
    """Return a tiled texture image from an archive photo."""
    from PIL import Image
    import io
    from flask import send_file

    data = request.get_json()
    photo_id = data.get("photo_id")
    tile_size = int(data.get("tile_size", 200))  # px

    uid = current_user()["id"]
    rows = execute("SELECT file_path FROM photos WHERE id=:id AND user_id=:uid",
                   {"id": photo_id, "uid": uid})
    if not rows:
        return jsonify({"error": "Photo not found"}), 404

    src = rows[0]["file_path"]
    if not os.path.exists(src):
        return jsonify({"error": "File not found"}), 404

    img = Image.open(src).convert("RGB")
    img.thumbnail((tile_size, tile_size), Image.LANCZOS)

    # Create a 3x3 tiled preview
    w, h = img.size
    tiled = Image.new("RGB", (w * 3, h * 3))
    for row in range(3):
        for col in range(3):
            tiled.paste(img, (col * w, row * h))

    buf = io.BytesIO()
    tiled.save(buf, "JPEG", quality=85)
    buf.seek(0)
    return send_file(buf, mimetype="image/jpeg")