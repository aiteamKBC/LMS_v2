"""Read the recorded time from an Aptem assessment report PDF."""

import re
from io import BytesIO

from pypdf import PdfReader


_TIME_SPENT = re.compile(
    r'^\s*Time[ \t]+spent[ \t]*:?[ \t]*(\d{1,4}):([0-5]\d)(?::([0-5]\d))?[ \t]*$',
    re.IGNORECASE | re.MULTILINE,
)


def report_seconds(pdf_bytes: bytes) -> int | None:
    """Return the report's Time spent value, or None when it is not unambiguous."""
    reader = PdfReader(BytesIO(pdf_bytes))
    text = '\n'.join(page.extract_text() or '' for page in reader.pages)
    matches = _TIME_SPENT.findall(text)
    if not matches:
        return None
    values = {
        int(hours) * 3600 + int(minutes) * 60 + int(seconds or 0)
        for hours, minutes, seconds in matches
    }
    return next(iter(values)) if len(values) == 1 else None
