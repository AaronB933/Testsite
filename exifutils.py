import os
import piexif
import exifread
from datetime import datetime
from PIL import Image
 
try:
    from pillowheif import register_heif_opener
    register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:
    HEIF_SUPPORTED = False
 
 
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tiff", ".tif"}
 
 
def is_supported(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_EXTENSIONS
 
 
def read_date_taken(file_path: str) -> tuple[datetime | None, bool]:
    """
    Read DateTimeOriginal from EXIF data.
    Returns (datetime_or_None, exif_found: bool)
    """
    ext = os.path.splitext(file_path)[1].lower()
 
    # Try exifread first (most reliable for JPEG/TIFF)
    try:
        with open(file_path, "rb") as f:
            tags = exifread.process_file(f, stop_tag="EXIF DateTimeOriginal", details=False)
 
        if "EXIF DateTimeOriginal" in tags:
            raw = str(tags["EXIF DateTimeOriginal"])
            dt = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
            return dt, True
 
        # Fallback tag
        if "Image DateTime" in tags:
            raw = str(tags["Image DateTime"])
            dt = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
            return dt, True
 
    except Exception:
        pass
 
    # Fallback: try piexif for JPEG
    if ext in {".jpg", ".jpeg"}:
        try:
            exif_data = piexif.load(file_path)
            exif_ifd = exif_data.get("Exif", {})
            date_bytes = exif_ifd.get(piexif.ExifIFD.DateTimeOriginal)
            if date_bytes:
                raw = date_bytes.decode("utf-8")
                dt = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
                return dt, True
        except Exception:
            pass
 
    # HEIC: use Pillow (pillow-heif)
    if ext in {".heic", ".heif"} and HEIF_SUPPORTED:
        try:
            img = Image.open(file_path)
            exif_bytes = img.info.get("exif")
            if exif_bytes:
                exif_data = piexif.load(exif_bytes)
                exif_ifd = exif_data.get("Exif", {})
                date_bytes = exif_ifd.get(piexif.ExifIFD.DateTimeOriginal)
                if date_bytes:
                    raw = date_bytes.decode("utf-8")
                    dt = datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
                    return dt, True
        except Exception:
            pass
 
    return None, False
 
 
def write_date_to_exif(file_path: str, date_taken: datetime) -> bool:
    """
    Write DateTimeOriginal into the file's EXIF data.
    Only works reliably for JPEG. Returns True on success.
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in {".jpg", ".jpeg"}:
        return False
 
    try:
        date_str = date_taken.strftime("%Y:%m:%d %H:%M:%S").encode("utf-8")
 
        try:
            exif_data = piexif.load(file_path)
        except Exception:
            exif_data = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}}
 
        exif_data["Exif"][piexif.ExifIFD.DateTimeOriginal] = date_str
        exif_data["Exif"][piexif.ExifIFD.DateTimeDigitized] = date_str
        exif_data["0th"][piexif.ImageIFD.DateTime] = date_str
 
        exif_bytes = piexif.dump(exif_data)
        piexif.insert(exif_bytes, file_path)
        return True
 
    except Exception as e:
        print(f"Warning: Could not write EXIF to {file_path}: {e}")
        return False
 
 
def build_stored_filename(date_taken: datetime, plant_name: str,
                          extension: str, existing_files: list[str]) -> str:
    """
    Build a filename like: rose_04-22-2026.jpeg
    Appends _2, _3 etc. if duplicates exist.
    """
    ext = extension.lower()
    if ext == ".heic":
        ext = ".jpg"  # convert HEIC to JPEG on save
 
    base = f"{plant_name}_{date_taken.strftime('%m-%d-%Y')}"
    candidate = f"{base}{ext}"
    counter = 2
 
    while candidate in existing_files:
        candidate = f"{base}_{counter}{ext}"
        counter += 1
 
    return candidate
 
 
def get_existing_filenames(directory: str) -> list[str]:
    if not os.path.exists(directory):
        return []
    return os.listdir(directory)
 