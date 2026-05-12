import os
import re
import piexif
import exifread
from datetime import datetime
from PIL import Image

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:
    HEIF_SUPPORTED = False


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tiff", ".tif"}


def is_supported(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_EXTENSIONS


def _parse_exif_date(raw: str) -> datetime | None:
    """Try common EXIF date formats."""
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S",
                "%Y:%m:%d", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw.strip(), fmt)
            if 1990 <= dt.year <= datetime.now().year + 1:
                return dt
        except ValueError:
            continue
    return None


def _date_from_filename(file_path: str) -> datetime | None:
    """Try to extract a date from the filename itself.
    Handles patterns like: IMG_20230814_..., 2023-08-14, 20230814, etc.
    """
    name = os.path.splitext(os.path.basename(file_path))[0]
    patterns = [
        r'(\d{4})[_\-](\d{2})[_\-](\d{2})',  # 2023-08-14 or 2023_08_14
        r'(\d{4})(\d{2})(\d{2})',              # 20230814
    ]
    for pat in patterns:
        m = re.search(pat, name)
        if m:
            try:
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 1990 <= y <= datetime.now().year + 1 and 1 <= mo <= 12 and 1 <= d <= 31:
                    return datetime(y, mo, d)
            except ValueError:
                continue
    return None


def read_date_taken(file_path: str) -> tuple[datetime | None, bool]:
    """
    Try every possible source for a photo date, in priority order:
    1. EXIF DateTimeOriginal (most reliable)
    2. EXIF DateTimeDigitized
    3. EXIF DateTime (Image DateTime)
    4. GPS timestamp
    5. HEIC EXIF
    6. Filename pattern (IMG_20230814, 2023-08-14, etc.)
    7. File modified time (iCloud for Windows preserves this)

    Returns (datetime_or_None, exif_found: bool)
    """
    ext = os.path.splitext(file_path)[1].lower()

    # ── 1-4. exifread — reads all EXIF tags at once ────────────────────────
    try:
        with open(file_path, "rb") as f:
            tags = exifread.process_file(f, details=False)

        # Priority order of EXIF date tags
        for tag in ("EXIF DateTimeOriginal", "EXIF DateTimeDigitized",
                    "Image DateTime", "EXIF DateTime"):
            if tag in tags:
                dt = _parse_exif_date(str(tags[tag]))
                if dt:
                    return dt, True

        # GPS timestamp as last EXIF resort
        gps_date = tags.get("GPS GPSDate")
        gps_time = tags.get("GPS GPSTimeStamp")
        if gps_date and gps_time:
            try:
                date_str = str(gps_date)  # "2023:08:14"
                dt = _parse_exif_date(date_str)
                if dt:
                    return dt, True
            except Exception:
                pass

    except Exception:
        pass

    # ── 5. piexif fallback for JPEG ─────────────────────────────────────────
    if ext in {".jpg", ".jpeg"}:
        try:
            exif_data = piexif.load(file_path)
            exif_ifd = exif_data.get("Exif", {})
            ifd0 = exif_data.get("0th", {})
            for field in (piexif.ExifIFD.DateTimeOriginal,
                          piexif.ExifIFD.DateTimeDigitized):
                date_bytes = exif_ifd.get(field)
                if date_bytes:
                    dt = _parse_exif_date(date_bytes.decode("utf-8", errors="ignore"))
                    if dt:
                        return dt, True
            # IFD0 DateTime
            date_bytes = ifd0.get(piexif.ImageIFD.DateTime)
            if date_bytes:
                dt = _parse_exif_date(date_bytes.decode("utf-8", errors="ignore"))
                if dt:
                    return dt, True
        except Exception:
            pass

    # ── 6. HEIC via Pillow ──────────────────────────────────────────────────
    if ext in {".heic", ".heif"} and HEIF_SUPPORTED:
        try:
            img = Image.open(file_path)
            exif_bytes = img.info.get("exif")
            if exif_bytes:
                exif_data = piexif.load(exif_bytes)
                exif_ifd = exif_data.get("Exif", {})
                for field in (piexif.ExifIFD.DateTimeOriginal,
                              piexif.ExifIFD.DateTimeDigitized):
                    date_bytes = exif_ifd.get(field)
                    if date_bytes:
                        dt = _parse_exif_date(date_bytes.decode("utf-8", errors="ignore"))
                        if dt:
                            return dt, True
        except Exception:
            pass

    # ── 7. Filename pattern ──────────────────────────────────────────────────
    dt = _date_from_filename(file_path)
    if dt:
        return dt, False  # found but not from EXIF

    # ── 8. File modified time ────────────────────────────────────────────────
    # iCloud for Windows preserves correct modified dates even when EXIF is stripped
    try:
        mtime = os.path.getmtime(file_path)
        dt = datetime.fromtimestamp(mtime)
        if 2000 <= dt.year <= datetime.now().year:
            return dt, False
    except Exception:
        pass

    return None, False


def write_date_to_exif(file_path: str, date_taken: datetime) -> bool:
    """Write DateTimeOriginal into JPEG EXIF. Returns True on success."""
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
    """Build a filename like: photo_04-22-2026.jpg"""
    ext = extension.lower()
    if ext == ".heic":
        ext = ".jpg"
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