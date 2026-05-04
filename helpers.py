"""
helpers.py — Shared utilities used across all route blueprints.
"""
import os
from datetime import date
from functools import wraps
from flask import jsonify, session

UPLOAD_BASE = os.path.join(os.path.dirname(__file__),
                           os.environ.get("UPLOAD_BASE", "uploads"))

VIDEO_EXTENSIONS = {'.mp4','.mov','.avi','.mkv','.m4v','.wmv','.flv','.webm','.3gp'}


def current_user():
    return session.get("user")


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "Not logged in"}), 401
        return fn(*args, **kwargs)
    return wrapper


def user_dir(user_id: int) -> str:
    return os.path.join(UPLOAD_BASE, f"user_{user_id}")


def safe_folder_name(name: str) -> str:
    return name.strip().lower().replace(" ", "_").replace("/", "-")


def get_season(d: date) -> str:
    m, day = d.month, d.day
    if (m == 3 and day >= 8) or m == 4 or m == 5 or (m == 6 and day <= 1):
        return "spring"
    if (m == 6 and day >= 2) or m == 7 or (m == 8 and day <= 15):
        return "summer"
    if (m == 8 and day >= 16) or m == 9 or m == 10 or (m == 11 and day <= 1):
        return "fall"
    return "winter"