"""Fetches a learner's evidence image for embedding into a template photo-card.

Kept separate from pptx_generator.py so the network call is easy to stub out
in tests: pass a different `fetch_image` callable rather than mocking urllib.
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

ImageFetcher = Callable[[str], Optional[bytes]]


BLOB_PREFIX = "blob:"
MAX_IMAGE_BYTES = 15 * 1024 * 1024


def blob_image_ref(container: str, blob_name: str) -> str:
    """How a pack names an image held in blob storage (evidence or an edit upload)."""
    return f"{BLOB_PREFIX}{container}/{blob_name}"


def parse_blob_image_ref(ref: str) -> Optional[tuple]:
    if not isinstance(ref, str) or not ref.startswith(BLOB_PREFIX):
        return None
    container, _, blob_name = ref[len(BLOB_PREFIX):].partition("/")
    return (container, blob_name) if container and blob_name else None


def default_image_fetcher(ref: str) -> Optional[bytes]:
    """Image bytes for a pack's image reference: a blob reference, or (in
    snapshots taken before blob references existed) a server-generated SAS URL."""
    try:
        blob = parse_blob_image_ref(ref)
        if blob:
            from learner_api.evidence_storage import download_blob_bytes

            return download_blob_bytes(*blob, max_bytes=MAX_IMAGE_BYTES)
        import urllib.request

        with urllib.request.urlopen(ref, timeout=8) as response:  # noqa: S310 - server-generated SAS URL only
            return response.read()
    except Exception as exc:  # storage/network/timeout — never fatal to PPTX generation
        logger.warning("Progress review PPTX: could not fetch evidence image: %s", exc)
        return None


def fit_to_frame(image_bytes: bytes, width: int, height: int) -> Optional[bytes]:
    """Centre-crop an evidence image to its photo frame's aspect ratio, so a
    tall screenshot fills a wide card without stretching. None when the bytes
    are not a readable image (a PDF or PPTX never reaches a photo frame)."""
    import io

    from PIL import Image, ImageOps

    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    except Exception:
        return None
    target = width / height if width and height else image.width / image.height
    if image.width / image.height > target:
        new_width = int(image.height * target)
        left = (image.width - new_width) // 2
        image = image.crop((left, 0, left + new_width, image.height))
    else:
        new_height = int(image.width / target)
        top = (image.height - new_height) // 2
        image = image.crop((0, top, image.width, top + new_height))
    image.thumbnail((1600, 1600))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=85)
    return out.getvalue()


def placeholder(width: int, height: int, text: str = "") -> bytes:
    """A plain brand-tinted card for a photo frame with no real evidence
    image, so no template sample photo is ever left in a learner's deck."""
    import io

    from PIL import Image, ImageDraw, ImageFont

    ratio = width / height if width and height else 1.6
    size = (800, max(1, int(800 / ratio)))
    image = Image.new("RGB", size, (244, 241, 255))
    if text:
        draw = ImageDraw.Draw(image)
        try:
            font = ImageFont.truetype("arial.ttf", 34)
        except OSError:
            font = ImageFont.load_default()
        box = draw.textbbox((0, 0), text, font=font)
        draw.text(((size[0] - box[2]) / 2, (size[1] - box[3]) / 2), text, fill=(98, 108, 125), font=font)
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def transparent_image() -> bytes:
    """A 1x1 fully transparent PNG, to blank out a picture-filled shape."""
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(out, format="PNG")
    return out.getvalue()
