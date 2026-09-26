"""Page extraction from a PDF with PyMuPDF.

Every page gets a known status -- text, blank, image_only (a page with drawings
or images but no text layer: an OCR candidate) or failed -- so the completeness
check can prove no page was silently skipped. Layout is kept as paragraphs, not
collapsed into one line, so headings and tables survive for structuring.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

EXTRACTOR_VERSION = "1"
MAX_PAGES = 2000


class PdfRejected(Exception):
    """The file cannot be processed; the message is shown to staff."""


@dataclass
class Line:
    text: str
    size: float
    bold: bool
    y0: float


@dataclass
class PageResult:
    pdf_page: int                  # 1-based
    printed_label: str | None
    status: str                    # text | blank | image_only | failed
    lines: list[Line] = field(default_factory=list)
    error: str = ""

    @property
    def text(self):
        return "\n".join(line.text for line in self.lines)


def open_pdf(data: bytes):
    import fitz

    if not data[:1024].lstrip().startswith(b"%PDF-") and b"%PDF-" not in data[:1024]:
        raise PdfRejected("The file is not a PDF.")
    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - reported to staff as corrupt
        raise PdfRejected("The PDF is damaged and cannot be opened.") from exc
    if document.needs_pass:
        document.close()
        raise PdfRejected("The PDF is password-protected. Upload a copy without a password.")
    if document.page_count == 0:
        document.close()
        raise PdfRejected("The PDF has no pages.")
    if document.page_count > MAX_PAGES:
        count = document.page_count
        document.close()
        raise PdfRejected(f"The PDF has {count} pages; the limit is {MAX_PAGES}.")
    return document


def _page_lines(page):
    lines = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for raw in block.get("lines", []):
            spans = [s for s in raw.get("spans", []) if s.get("text", "").strip()]
            if not spans:
                continue
            text = re.sub(r"\s+", " ", "".join(s["text"] for s in spans)).strip()
            size = max(s.get("size", 0) for s in spans)
            bold = any("bold" in s.get("font", "").lower() or (s.get("flags", 0) & 16) for s in spans)
            lines.append(Line(text=text, size=round(size, 1), bold=bool(bold), y0=raw["bbox"][1]))
    return lines


def extract_page(page, pdf_page: int) -> PageResult:
    try:
        label = page.get_label() or None
    except Exception:  # noqa: BLE001 - labels are optional metadata
        label = None
    try:
        lines = _page_lines(page)
    except Exception as exc:  # noqa: BLE001 - recorded as a gap, never silent
        return PageResult(pdf_page, label, "failed", error=str(exc)[:300])
    if lines:
        return PageResult(pdf_page, label, "text", lines)
    has_visuals = bool(page.get_images(full=True)) or bool(page.get_drawings())
    return PageResult(pdf_page, label, "image_only" if has_visuals else "blank")


def extract_pages(document, start: int = 1, end: int | None = None):
    end = min(end or document.page_count, document.page_count)
    return [extract_page(document.load_page(n - 1), n) for n in range(start, end + 1)]


def strip_running_lines(pages: list[PageResult], min_share: float = 0.5):
    """Remove headers and footers that repeat on most pages (book title, page
    numbers). Page numbers are normalised to '#' so '12' and '13' match."""
    text_pages = [p for p in pages if p.status == "text"]
    if len(text_pages) < 4:
        return pages

    def key(text):
        return re.sub(r"\d+", "#", text.strip().lower())

    counts = Counter()
    for page in text_pages:
        edge = {key(line.text) for line in page.lines[:2] + page.lines[-2:]}
        counts.update(edge)
    repeated = {k for k, n in counts.items() if n / len(text_pages) >= min_share}
    for page in text_pages:
        head, tail = page.lines[:2], page.lines[-2:]
        edge_ids = {id(line) for line in head + tail if key(line.text) in repeated}
        page.lines = [line for line in page.lines if id(line) not in edge_ids]
        if not page.lines:
            page.status = "blank"
    return pages
