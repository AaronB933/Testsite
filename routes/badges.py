"""
badges.py — Badge creation routes including AI background removal.
"""
import os
import io
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
    """Remove background from uploaded image using rembg AI model."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]

    try:
        from rembg import remove
        from PIL import Image

        # Read input
        input_bytes = file.read()
        input_image = Image.open(io.BytesIO(input_bytes))

        # Remove background — returns RGBA PNG
        output_image = remove(input_image)

        # Send back as PNG
        output_buffer = io.BytesIO()
        output_image.save(output_buffer, format="PNG")
        output_buffer.seek(0)

        return send_file(
            output_buffer,
            mimetype="image/png",
            as_attachment=False
        )

    except ImportError:
        return jsonify({
            "error": "rembg not installed. Run: pip install rembg"
        }), 500
    except Exception as e:
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

    # Avoid overwriting
    counter = 2
    base, ext = os.path.splitext(filename)
    while os.path.exists(save_path):
        save_path = os.path.join(badges_dir, f"{base}_{counter}{ext}")
        counter += 1

    file.save(save_path)
    return jsonify({"success": True, "path": save_path})