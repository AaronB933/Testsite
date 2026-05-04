"""
pages.py — HTML page routes (serve HTML files).
"""
from flask import Blueprint, send_from_directory
from helpers import current_user

bp = Blueprint("pages", __name__)


@bp.route("/")
def index():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "home.html")


@bp.route("/upload")
def upload_page():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "upload.html")


@bp.route("/tracker")
def tracker_page():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "tracker.html")


@bp.route("/organize")
def organize_page():
    if not current_user():
        return send_from_directory("static", "login.html")
    return send_from_directory("static", "organize.html")