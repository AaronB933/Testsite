"""
app.py — Plant Archive application entry point.

This file only handles app setup and blueprint registration.
Actual route logic lives in the routes/ package, organized by feature.
"""
import os
from flask import Flask
from dotenv import load_dotenv

load_dotenv()

from database import init_db
from routes.auth import bp as auth_bp
from routes.pages import bp as pages_bp
from routes.photos import bp as photos_bp
from routes.trash import bp as trash_bp
from routes.organize import bp as organize_bp
from routes.tracker import bp as tracker_bp


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="static")
    app.secret_key = os.environ.get("SECRET_KEY", "plant-archive-secret-change-me")

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(pages_bp)
    app.register_blueprint(photos_bp)
    app.register_blueprint(trash_bp)
    app.register_blueprint(organize_bp)
    app.register_blueprint(tracker_bp)

    return app


app = create_app()


if __name__ == "__main__":
    init_db()
    print("Plant Photo Archive running at http://localhost:5000")
    print("Mobile: http://192.168.1.105:5000/mobile")
    app.run(debug=True, port=5000, host='0.0.0.0')