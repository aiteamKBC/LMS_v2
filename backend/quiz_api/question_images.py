"""Quiz images: validated, then stored as files and referenced by URL.

A question image or an image-matching answer arrives from the editor (or an
AI draft) as a ``data:image/...;base64`` URL. Kept in the column it rode in
every quiz read and could never be cached, so it is stored the way curriculum
uploads are (Azure when configured, local disk when not) and the column keeps
``/curriculum_api/curriculum/uploads/quiz_images/<sha256 prefix>.<ext>``. The
name comes from the bytes, so one picture is one file however many questions
use it, and the file never changes, which lets the browser cache it.
"""
import base64
import binascii
import hashlib
import io
import json
import re
import warnings

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WEBP"}
EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg"}
STORAGE_FOLDER = "quiz_images"
SERVED_PREFIX = f"/curriculum_api/curriculum/uploads/{STORAGE_FOLDER}/"
STORED_URL = re.compile(rf"^{re.escape(SERVED_PREFIX)}[0-9a-f]{{32}}\.(?:png|jpg|gif|webp|svg)$")
IMAGE_MATCHING_KIND = "image_matching_pair"


def validate_question_image(value):
    """Return an image data URL, or an empty string for an explicit removal."""
    if value is None or value == "":
        return ""
    if not isinstance(value, str) or len(value) > 4 * ((MAX_IMAGE_BYTES + 2) // 3) + 32:
        raise ValueError("Use a question image no larger than 5 MB.")
    header, separator, encoded = value.partition(",")
    mime = header.removeprefix("data:").removesuffix(";base64")
    if not separator or header != f"data:{mime};base64" or mime not in IMAGE_FORMATS:
        raise ValueError("Choose a PNG, JPG, GIF or WEBP question image.")
    try:
        content = base64.b64decode(encoded, validate=True)
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError("Use a question image no larger than 5 MB.")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as picture:
                if picture.format != IMAGE_FORMATS[mime]:
                    raise ValueError("The question image does not match its file type.")
                picture.verify()
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ValueError("Choose a valid PNG, JPG, GIF or WEBP question image.") from exc
    return value


def store_image_bytes(content, mime):
    """Store one image's bytes once and return its served URL. Raises ValueError."""
    from curriculum_api import upload_storage
    from curriculum_api.views import COMPONENT_UPLOAD_ROOT

    relative_path = f"{COMPONENT_UPLOAD_ROOT}/{STORAGE_FOLDER}/{hashlib.sha256(content).hexdigest()[:32]}{EXTENSIONS[mime]}"
    try:
        # Content-addressed: the same picture is already there under this name.
        if not upload_storage.exists(relative_path):
            from django.core.files.base import ContentFile
            relative_path = upload_storage.store(ContentFile(content), relative_path, mime)
    except Exception as exc:  # noqa: BLE001 - refused, never kept inline
        raise ValueError("The image could not be uploaded right now. Try again.") from exc
    return "/curriculum_api/curriculum/uploads/" + relative_path.removeprefix(f"{COMPONENT_UPLOAD_ROOT}/")


def _decoded(value, formats):
    header, _separator, encoded = value.partition(",")
    mime = header.removeprefix("data:").removesuffix(";base64")
    if mime not in formats:
        raise ValueError("Choose a PNG, JPG, GIF or WEBP image.")
    try:
        content = base64.b64decode(encoded, validate=True)
    except binascii.Error as exc:
        raise ValueError("The image could not be read. Choose it again.") from exc
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ValueError("Use an image no larger than 5 MB.")
    return content, mime


def store_question_image(value):
    """A question image as a stored URL; '' removes it. Never returns base64."""
    if value is None or value == "":
        return ""
    if isinstance(value, str) and STORED_URL.match(value.strip()):
        return value.strip()
    value = validate_question_image(value)
    content, mime = _decoded(value, IMAGE_FORMATS)
    return store_image_bytes(content, mime)


def stored_answer_text(text):
    """An answer text with any inline image-matching picture stored as a URL.

    Only the JSON pair shape carries an image; every other answer text is
    returned exactly as it arrived. A pair whose picture cannot be stored is
    refused (ValueError) rather than saved inline.
    """
    if not isinstance(text, str) or "data:" not in text or not text.lstrip().startswith("{"):
        return text
    try:
        payload = json.loads(text)
    except ValueError:
        return text
    image_url = payload.get("imageUrl") if isinstance(payload, dict) else None
    if not isinstance(image_url, str) or not image_url.strip().lower().startswith("data:"):
        return text
    content, mime = _decoded(image_url.strip(), EXTENSIONS)
    if mime in IMAGE_FORMATS:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                with Image.open(io.BytesIO(content)) as picture:
                    picture.verify()
            except (UnidentifiedImageError, OSError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
                raise ValueError("Choose a valid PNG, JPG, GIF or WEBP image.") from exc
    payload["imageUrl"] = store_image_bytes(content, mime)
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
