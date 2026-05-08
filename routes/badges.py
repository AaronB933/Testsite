"""
badges.py — Badge creation routes including AI background removal with SAM.
"""
import os
import io
import json
import numpy as np
from flask import Blueprint, request, jsonify, send_file

from helpers import current_user, login_required, user_dir, UPLOAD_BASE

bp = Blueprint("badges", __name__)


@bp.route("/badges")
def badges_page():
    if not current_user():
        from flask import send_from_directory
        return send_from_directory("static", "login.html")
    from flask import send_from_directory
    return send_from_directory("static", "badges.html")


@bp.route("/api/badges/remove-background", methods=["POST"])
@login_required
def remove_background():
    """
    Remove background using SAM when selection data is provided,
    otherwise fall back to standard u2net model.

    Accepts multipart form with:
      - file: image file
      - selection: JSON string with {type, points/x/y/width/height} (optional)
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    selection_str = request.form.get("selection", "")

    try:
        from PIL import Image

        input_bytes = file.read()
        input_image = Image.open(io.BytesIO(input_bytes)).convert("RGBA")
        orig_w, orig_h = input_image.size

        selection = None
        if selection_str:
            try:
                selection = json.loads(selection_str)
            except Exception:
                selection = None

        if selection:
            # ── SAM mode — use selection as prompt ────────────────────────
            from rembg import new_session, remove

            session = new_session("sam")

            # Build SAM input kwargs from selection
            if selection["type"] == "rect":
                # Rectangle → use as bounding box prompt
                x = int(selection.get("x", 0))
                y = int(selection.get("y", 0))
                w = int(selection.get("width", orig_w))
                h = int(selection.get("height", orig_h))
                # SAM expects center point + bounding box
                cx, cy = x + w // 2, y + h // 2
                sam_kwargs = {
                    "sam_prompt": [
                        {"type": "point", "data": [cx, cy], "label": 1},
                        {"type": "point", "data": [x, y], "label": 1},
                        {"type": "point", "data": [x + w, y + h], "label": 1},
                    ]
                }
            elif selection["type"] == "lasso" and selection.get("points"):
                # Lasso → use centroid + bounding box corners as foreground points
                pts = selection["points"]
                xs = [p["x"] for p in pts]
                ys = [p["y"] for p in pts]
                cx = int(sum(xs) / len(xs))
                cy = int(sum(ys) / len(ys))
                minx, miny = int(min(xs)), int(min(ys))
                maxx, maxy = int(max(xs)), int(max(ys))
                # Sample a few points from inside the lasso as foreground
                sam_kwargs = {
                    "sam_prompt": [
                        {"type": "point", "data": [cx, cy], "label": 1},
                        {"type": "point", "data": [minx + (maxx-minx)//4, miny + (maxy-miny)//4], "label": 1},
                        {"type": "point", "data": [maxx - (maxx-minx)//4, maxy - (maxy-miny)//4], "label": 1},
                        # Background hint — corners of image
                        {"type": "point", "data": [0, 0], "label": 0},
                        {"type": "point", "data": [orig_w - 1, 0], "label": 0},
                        {"type": "point", "data": [0, orig_h - 1], "label": 0},
                        {"type": "point", "data": [orig_w - 1, orig_h - 1], "label": 0},
                    ]
                }
            else:
                # Fallback: use center point
                sam_kwargs = {
                    "sam_prompt": [
                        {"type": "point", "label": 1, "data": [orig_w//2, orig_h//2]}
                    ]
                }

            # Run SAM — log what we're sending
            print(f"SAM prompt: {sam_kwargs.get('sam_prompt', 'none')}")
            rgb_image = input_image.convert("RGB")
            output_image = remove(rgb_image, session=session, **sam_kwargs)
            print("SAM complete")

        else:
            # ── Standard mode — no selection, use u2net ───────────────────
            from rembg import remove
            output_image = remove(input_image)

        # Send back as PNG
        output_buffer = io.BytesIO()
        output_image.save(output_buffer, format="PNG")
        output_buffer.seek(0)

        return send_file(output_buffer, mimetype="image/png", as_attachment=False)

    except ImportError as e:
        return jsonify({"error": f"Missing dependency: {e}"}), 500
    except Exception as e:
        print(f"Background removal error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/badges/save", methods=["POST"])
@login_required
def save_badge():
    """Save a badge PNG to the user's badges folder."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    user = current_user()
    file = request.files["file"]

    badges_dir = os.path.join(user_dir(user["id"]), "badges")
    os.makedirs(badges_dir, exist_ok=True)

    filename = file.filename or f"badge_{os.urandom(4).hex()}.png"
    save_path = os.path.join(badges_dir, filename)

    counter = 2
    base, ext = os.path.splitext(filename)
    while os.path.exists(save_path):
        save_path = os.path.join(badges_dir, f"{base}_{counter}{ext}")
        counter += 1

    file.save(save_path)
    return jsonify({"success": True, "path": save_path})