"""Images, vector diagrams and tables from a PDF page.

* Raster images are re-encoded through Pillow (pixel cap, decompression-bomb
  protection, metadata stripped) and stored as WebP -- only clean bytes are kept.
* Vector diagrams (SWOT grids, funnels drawn with shapes) are not images in the
  PDF, so clusters of drawings are rendered to WebP. Labels printed inside the
  drawing are captured as text for search.
* Tables become Markdown text (the part the generator reads) plus a snapshot.
* Figure captions from the book ("Figure 3.2 ...") are kept on the occurrence;
  figure numbers are stripped from anything sent to the generator.
"""
from __future__ import annotations

import io
import re
import warnings
from dataclasses import dataclass, field

ASSET_EXTRACTOR_VERSION = "1"
MAX_PIXELS = 16_000_000
MIN_SIDE = 48                  # smaller images are icons or bullets
RENDER_DPI = 150
PREVIEW_DPI = 100
THUMB_WIDTH = 200
WEBP_QUALITY = 78
MIN_DRAWINGS_FOR_DIAGRAM = 6
CAPTION_RE = re.compile(r"^\s*(fig(?:ure)?|table|exhibit|diagram)\.?\s*\d+(?:\.\d+)*\b\s*[:.\-–—]?\s*", re.I)


@dataclass
class ExtractedAsset:
    kind: str                     # raster | vector_region | table_snapshot
    pdf_page: int
    bbox: tuple[float, float, float, float]
    data: bytes                   # WebP bytes
    media_type: str
    width: int
    height: int
    caption: str = ""
    label_text: str = ""
    table_markdown: str = ""
    extra: dict = field(default_factory=dict)


def _to_webp(image_bytes: bytes | None = None, pil_image=None):
    from PIL import Image

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        img = pil_image or Image.open(io.BytesIO(image_bytes))
        if img.width * img.height > MAX_PIXELS:
            raise ValueError("image too large")
        img.load()
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=WEBP_QUALITY, method=4)
        return out.getvalue(), img.width, img.height


def _render(page, clip=None, dpi=RENDER_DPI):
    from PIL import Image

    pix = page.get_pixmap(dpi=dpi, clip=clip, alpha=False)
    if pix.width * pix.height > MAX_PIXELS:
        raise ValueError("render too large")
    return _to_webp(pil_image=Image.frombytes("RGB", (pix.width, pix.height), pix.samples))


def strip_figure_number(text: str) -> str:
    """'Figure 3.2: Ansoff matrix' -> 'Ansoff matrix' (for generator text)."""
    return CAPTION_RE.sub("", text or "").strip()


def _caption_near(page, rect):
    """A 'Figure/Table N' line just below or above the region."""
    import fitz

    for probe in (fitz.Rect(rect.x0, rect.y1, rect.x1, rect.y1 + 40), fitz.Rect(rect.x0, rect.y0 - 40, rect.x1, rect.y0)):
        text = page.get_text("text", clip=probe).strip()
        for line in text.splitlines():
            if CAPTION_RE.match(line):
                return line.strip()
    return ""


def _merge_rects(rects, gap=12):
    import fitz

    merged = []
    for rect in sorted(rects, key=lambda r: (r.y0, r.x0)):
        grown = fitz.Rect(rect.x0 - gap, rect.y0 - gap, rect.x1 + gap, rect.y1 + gap)
        for i, existing in enumerate(merged):
            if existing.intersects(grown):
                merged[i] = existing | rect
                break
        else:
            merged.append(fitz.Rect(rect))
    return merged


def extract_tables(page, pdf_page):
    assets = []
    try:
        tables = page.find_tables().tables
    except Exception:  # noqa: BLE001 - table detection is best effort
        return assets
    for table in tables:
        markdown = (table.to_markdown() or "").strip()
        if not markdown:
            continue
        rect = table.bbox if hasattr(table.bbox, "x0") else __import__("fitz").Rect(table.bbox)
        data, w, h = _render(page, clip=rect)
        assets.append(ExtractedAsset("table_snapshot", pdf_page, tuple(rect), data, "image/webp", w, h,
                                     caption=_caption_near(page, rect), table_markdown=markdown))
    return assets


def extract_rasters(document, page, pdf_page):
    assets = []
    for info in page.get_images(full=True):
        xref = info[0]
        try:
            rects = page.get_image_rects(xref)
            raw = document.extract_image(xref)
            data, w, h = _to_webp(raw["image"])
        except Exception:  # noqa: BLE001 - one bad image never fails the page
            continue
        if min(w, h) < MIN_SIDE:
            continue
        rect = rects[0] if rects else page.rect
        assets.append(ExtractedAsset("raster", pdf_page, tuple(rect), data, "image/webp", w, h,
                                     caption=_caption_near(page, rect)))
    return assets


def extract_vector_regions(page, pdf_page, exclude=()):
    import fitz

    rects = [d["rect"] for d in page.get_drawings() if d.get("rect") and d["rect"].width * d["rect"].height > 4]
    rects = [r for r in rects if not any(fitz.Rect(e).contains(r) for e in exclude)]
    if len(rects) < MIN_DRAWINGS_FOR_DIAGRAM:
        return []
    assets = []
    for region in _merge_rects(rects):
        members = sum(1 for r in rects if region.contains(r))
        if members < MIN_DRAWINGS_FOR_DIAGRAM or region.width < 60 or region.height < 60:
            continue
        if region.width > page.rect.width * 0.98 and region.height > page.rect.height * 0.9:
            continue  # page border or background
        data, w, h = _render(page, clip=region)
        labels = re.sub(r"\s+", " ", page.get_text("text", clip=region)).strip()
        assets.append(ExtractedAsset("vector_region", pdf_page, tuple(region), data, "image/webp", w, h,
                                     caption=_caption_near(page, region), label_text=labels[:1000]))
    return assets


def extract_page_assets(document, page, pdf_page):
    tables = extract_tables(page, pdf_page)
    rasters = extract_rasters(document, page, pdf_page)
    vectors = extract_vector_regions(page, pdf_page, exclude=[a.bbox for a in tables])
    return tables + rasters + vectors


def page_previews(page):
    """(thumbnail, preview) WebP bytes for staff QA."""
    from PIL import Image

    preview, _, _ = _render(page, dpi=PREVIEW_DPI)
    img = Image.open(io.BytesIO(preview))
    ratio = THUMB_WIDTH / img.width
    thumb_img = img.resize((THUMB_WIDTH, max(1, int(img.height * ratio))))
    thumb, _, _ = _to_webp(pil_image=thumb_img)
    return thumb, preview


def mark_decorative(assets_by_sha_pages, total_pages, share=0.3):
    """An image repeated on many pages (logo, banner) is decorative."""
    limit = max(3, int(total_pages * share))
    return {sha for sha, pages in assets_by_sha_pages.items() if len(set(pages)) >= limit}
