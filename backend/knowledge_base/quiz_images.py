"""Bounded book image inputs and validated, self-contained quiz image pairs.

Quiz answers already support embedded images. Keeping a compressed snapshot in
that format preserves saved attempts/exports without public blobs or stale SAS
URLs. The source asset remains content-addressed in the book's storage.
"""
from __future__ import annotations

import base64
import io
import json
import logging

from PIL import Image, ImageStat, UnidentifiedImageError

from . import storage

logger = logging.getLogger(__name__)
MAX_IMAGES = 8
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 100 * 1024
MAX_ANSWER_IMAGE_CHARS = 4 * 1024 * 1024


class InvalidImageQuestion(ValueError):
    pass


def _snapshot(data):
    with Image.open(io.BytesIO(data)) as original:
        if original.width * original.height > 20_000_000:
            raise ValueError("Book image is too large.")
        rgba = original.convert("RGBA")
        img = Image.new("RGB", original.size, "white")
        img.paste(rgba, mask=rgba.getchannel("A"))
        if max(ImageStat.Stat(img).stddev) < 3:
            raise ValueError("Book image has no usable visual content.")
        img.thumbnail((1200, 1200))
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=82)
        if out.tell() > MAX_IMAGE_BYTES:
            raise ValueError("Book image exceeds quiz snapshot budget.")
        return "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode("ascii")


def select(repo, plan):
    images, warnings = [], []
    segments = {s.chunk_id: s for s in plan.segments}
    rows = repo.images_for_chunks(list(segments), limit=MAX_IMAGES * 3)
    # Repository orders one image per retrieved chunk before additional images.
    for row in rows:
        if len(images) >= MAX_IMAGES:
            break
        seg = segments.get(row["chunk_id"])
        if seg is None or str(row["build_id"]) != str(seg.build_id):
            continue
        try:
            if row["size_bytes"] > MAX_SOURCE_BYTES:
                raise ValueError("Book image exceeds source budget.")
            data = storage.read(row["storage_ref"])
            if len(data) > MAX_SOURCE_BYTES or storage.sha256_of(data) != row["sha256"].strip():
                raise ValueError("Book image content does not match its registered hash.")
            url = _snapshot(data)
        except (OSError, ValueError, UnidentifiedImageError, storage.StorageError):
            warnings.append("book_image_unavailable")
            logger.warning("Could not load book image %s for quiz generation.", row["id"])
            continue
        images.append({"token": f"BOOK_IMAGE_{row['id']}", "id": row["id"],
                       "occurrenceId": row["occurrence_id"], "imageUrl": url,
                       "book": seg.book_title, "section": seg.section, "page": row["pdf_page"],
                       "caption": (row["book_caption"] or row["label_text"] or "")[:800]})
    return images, sorted(set(warnings))


def prompt_content(prompt, images):
    if not images:
        return prompt
    content = [{"type": "input_text", "text": prompt}]
    for item in images:
        content.extend([
            {"type": "input_text", "text": f"{item['token']}: {item['book']}, {item['section']}, page {item['page']}. {item['caption']}"},
            {"type": "input_image", "image_url": item["imageUrl"], "detail": "high"},
        ])
    return content


def resolve(questions, images):
    """Only server-selected images may become answers; reject invented assets."""
    allowed = {image["token"]: image for image in images}
    used, total_chars = [], 0
    for index, question in enumerate(questions):
        if question["questionType"] != "image_matching":
            continue
        answers = question["answers"]
        if len(answers) < 2:
            raise InvalidImageQuestion("An image matching question needs at least two real book images. Generate again.")
        seen = set()
        for answer in answers:
            token, sep, match = answer["text"].partition(" -> ")
            token, match = token.strip(), match.strip()
            if not sep or token not in allowed or not match or token in seen:
                raise InvalidImageQuestion("AI returned an image question without valid book images. Generate again.")
            seen.add(token)
            item = allowed[token]
            total_chars += len(item["imageUrl"])
            if total_chars > MAX_ANSWER_IMAGE_CHARS:
                raise InvalidImageQuestion("Too many image answers. Generate fewer image questions.")
            answer["text"] = json.dumps({"kind": "image_matching_pair", "imageUrl": item["imageUrl"],
                                         "label": "", "match": match})
            used.append({"index": index, "assetId": item["id"], "occurrenceId": item["occurrenceId"],
                         "book": item["book"], "section": item["section"], "page": item["page"]})
    return used
