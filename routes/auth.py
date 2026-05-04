"""
auth.py — User authentication routes.
"""
from flask import Blueprint, request, jsonify, session
from database import create_user, verify_user
from helpers import current_user

bp = Blueprint("auth", __name__)


@bp.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    result = create_user(username, password)
    if "error" in result:
        return jsonify(result), 409
    session["user"] = result
    return jsonify({"success": True, "user": result})


@bp.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    user = verify_user(data.get("username", ""), data.get("password", ""))
    if not user:
        return jsonify({"error": "Invalid username or password"}), 401
    session["user"] = user
    return jsonify({"success": True, "user": user})


@bp.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"success": True})


@bp.route("/api/me")
def me():
    user = current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify(user)