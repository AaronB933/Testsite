"""
generate_thumbnails.py — One-time script to generate thumbnails for existing photos.

Run once:
    python generate_thumbnails.py

After this, new uploads generate thumbnails automatically.
"""
import os
import sys
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

UPLOAD_BASE = os.path.join(os.path.dirname(__file__), "uploads")
THUMB_BASE  = os.path.join(os.path.dirname(__file__), "thumbnails")
THUMB_SIZE  = (400, 400)

def generate_all():
    if not os.path.exists(UPLOAD_BASE):
        print("No uploads folder found.")
        return

    total = skipped = errors = generated = 0

    for user_folder in os.listdir(UPLOAD_BASE):
        user_upload = os.path.join(UPLOAD_BASE, user_folder, "inbox")
        user_thumb  = os.path.join(THUMB_BASE,  user_folder, "inbox")

        if not os.path.isdir(user_upload):
            continue

        os.makedirs(user_thumb, exist_ok=True)

        files = [f for f in os.listdir(user_upload)
                 if f.lower().endswith(('.jpg','.jpeg','.png'))
                 and not f.startswith('_temp')]
        total += len(files)

        for filename in files:
            src   = os.path.join(user_upload, filename)
            thumb = os.path.join(user_thumb,  filename)

            if os.path.exists(thumb):
                skipped += 1
                continue

            try:
                img = Image.open(src)
                img.verify()  # check it's a valid image
            except Exception:
                skipped += 1
                continue
            try:
                img = Image.open(src)  # reopen after verify
                img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                img.save(thumb, 'JPEG', quality=85, optimize=True)
                generated += 1
                if generated % 50 == 0:
                    print(f"  Generated {generated} thumbnails so far...")
            except Exception as e:
                errors += 1
                print(f"  Error on {filename}: {e}")

    print(f"\nDone!")
    print(f"  Generated: {generated}")
    print(f"  Skipped (already existed): {skipped}")
    print(f"  Errors: {errors}")
    print(f"  Total photos: {total}")

if __name__ == "__main__":
    print(f"Generating thumbnails in {THUMB_BASE}...")
    generate_all()