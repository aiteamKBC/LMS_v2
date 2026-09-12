"""Fetches a learner's evidence image for embedding into a template photo-card.

Kept separate from pptx_generator.py so the network call is easy to stub out
in tests: pass a different `fetch_image` callable rather than mocking urllib.
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

ImageFetcher = Callable[[str], Optional[bytes]]


def default_image_fetcher(url: str) -> Optional[bytes]:
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=8) as response:  # noqa: S310 - server-generated SAS URL only
            return response.read()
    except Exception as exc:  # network/SSL/timeout — never fatal to PPTX generation
        logger.warning("Progress review PPTX: could not fetch evidence image %s: %s", url, exc)
        return None
