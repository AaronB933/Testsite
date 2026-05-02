import os
import shutil
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, session, redirect

from database import init_db, create_user, verify_user, get_or_create_plant, \
    insert_photo, log_action, get_all_plants, get_photos_by_plant, get_all_photos
from exifutils import read_date_taken, write_date_to_exif, build_stored_filename, \
    get_existing_filenames, is_supported

app = Flask(__name__, static_folder="static", template_folder="static")
app.secret_key = os.environ.get("SECRET_KEY", "plant-archive-secret-change-in-production")

UPLOAD_BASE = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_BASE, exist_ok=True)


# ── Auth helpers ───────────────────────────────────────────────────────────────

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


# ── Pages ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "index.html")

@app.route("/mobile")
def mobile():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "mobile.html")


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
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
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    user = verify_user(username, password)
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


# ── API: Upload ────────────────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
@login_required
def upload_photo():
    user = current_user()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    plant_name = request.form.get("plant", "unknown").strip().lower()
    manual_date = request.form.get("date", "").strip()

    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    if not is_supported(file.filename):
        return jsonify({"error": f"Unsupported file type: {file.filename}"}), 400

    original_filename = file.filename
    ext = os.path.splitext(original_filename)[1]

    temp_path = os.path.join(UPLOAD_BASE, f"_temp_{user['id']}_{original_filename}")
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
        return jsonify({
            "error": "no_date",
            "message": "No EXIF date found. Please provide the date the photo was taken."
        }), 422

    # Store photos per user
    user_dir = os.path.join(UPLOAD_BASE, f"user_{user['id']}", plant_name.replace(" ", "_"))
    os.makedirs(user_dir, exist_ok=True)

    existing = get_existing_filenames(user_dir)
    stored_filename = build_stored_filename(date_taken, plant_name.replace(" ", "_"), ext, existing)
    final_path = os.path.join(user_dir, stored_filename)

    shutil.move(temp_path, final_path)
    exif_written = write_date_to_exif(final_path, date_taken)

    plant_id = get_or_create_plant(plant_name, user["id"])
    photo_id = insert_photo(
        plant_id=plant_id,
        user_id=user["id"],
        original_filename=original_filename,
        stored_filename=stored_filename,
        file_path=final_path,
        date_taken=date_taken.date(),
        exif_found=exif_found,
        notes=""
    )

    log_action(photo_id, "uploaded", f"User {user['username']} — renamed to {stored_filename}")

    return jsonify({
        "success": True,
        "photo_id": photo_id,
        "stored_filename": stored_filename,
        "date_taken": date_taken.strftime("%m-%d-%Y"),
        "exif_found": exif_found,
        "exif_written": exif_written,
        "plant": plant_name
    })


# ── API: Plants & Photos ───────────────────────────────────────────────────────

@app.route("/api/plants", methods=["GET"])
@login_required
def list_plants():
    return jsonify(get_all_plants(current_user()["id"]))


@app.route("/api/plants/<int:plant_id>/photos", methods=["GET"])
@login_required
def plant_photos(plant_id):
    return jsonify(get_photos_by_plant(plant_id, current_user()["id"]))


@app.route("/api/photos", methods=["GET"])
@login_required
def all_photos():
    return jsonify(get_all_photos(current_user()["id"]))


# ── Serve uploaded photos (auth protected) ─────────────────────────────────────

@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    if not current_user():
        return jsonify({"error": "Not logged in"}), 401
    return send_from_directory(UPLOAD_BASE, filename)


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("Plant Photo Archive running at http://localhost:5000")
    print("On your phone (same WiFi): http://192.168.1.105:5000/mobile")
    app.run(debug=True, port=5000, host='0.0.0.0')