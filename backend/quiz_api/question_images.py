"""Question attachments use the same inline storage as image-matching answers."""
import base64
import binascii
import io
import warnings

from PIL import Image, UnidentifiedImageError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_FORMATS = {"image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WEBP"}


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
