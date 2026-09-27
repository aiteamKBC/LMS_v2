"""Structure-aware chunking.

Chunks are cut inside one section only, on paragraph boundaries, sized by
tokens. A small overlap (the last paragraph of the previous chunk, capped at
~15% of the target) keeps definitions that span a cut retrievable; retrieval
removes that overlap again when two neighbours are both selected.

``content`` is the clean text sent to the generator and used for citations;
``embed_text`` adds the book/section/page context line, which improves search
but is never shown twice.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from .tokens import count_tokens

CHUNKER_VERSION = "1"
TARGET_TOKENS = 600
MAX_TOKENS = 800
OVERLAP_CAP_TOKENS = 90


@dataclass
class Chunk:
    ordinal: int
    section_ordinal: int
    kind: str
    content: str
    embed_text: str
    content_sha256: str
    token_count: int
    pdf_page_start: int
    pdf_page_end: int


def normalise(text):
    return re.sub(r"\s+", " ", text).strip()


def content_hash(text):
    return hashlib.sha256(normalise(text).encode("utf-8")).hexdigest()


def section_path(sections, section):
    by_ordinal = {s.ordinal: s for s in sections}
    path, node = [], section
    while node is not None:
        path.append(node.title)
        node = by_ordinal.get(node.parent) if node.parent is not None else None
    return list(reversed(path))


def _split_long(text, limit):
    """A single paragraph longer than the limit is split on sentence ends."""
    if count_tokens(text) <= limit:
        return [text]
    parts, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        candidate = f"{current} {sentence}".strip()
        if current and count_tokens(candidate) > limit:
            parts.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts


def chunk_section(section, path, book_title, start_ordinal):
    pieces = []
    for page, text in section.paragraphs:
        for part in _split_long(text, MAX_TOKENS):
            pieces.append((page, part))
    chunks, buffer = [], []

    def flush():
        if not buffer:
            return
        content = "\n".join(text for _, text in buffer)
        pages = [page for page, _ in buffer]
        header = f"{book_title} › {' › '.join(path)} (pp. {min(pages)}–{max(pages)})"
        chunks.append(Chunk(
            ordinal=start_ordinal + len(chunks), section_ordinal=section.ordinal, kind="text",
            content=content, embed_text=f"{header}\n\n{content}", content_sha256=content_hash(content),
            token_count=count_tokens(content), pdf_page_start=min(pages), pdf_page_end=max(pages),
        ))

    size = 0
    for page, text in pieces:
        tokens = count_tokens(text)
        if buffer and size + tokens > TARGET_TOKENS:
            flush()
            last = buffer[-1]
            carry = [last] if count_tokens(last[1]) <= OVERLAP_CAP_TOKENS and len(buffer) > 1 else []
            buffer[:] = carry
            size = sum(count_tokens(t) for _, t in buffer)
        buffer.append((page, text))
        size += tokens
    flush()
    return chunks


def chunk_book(sections, book_title):
    chunks = []
    for section in sections:
        if not section.paragraphs:
            continue
        chunks.extend(chunk_section(section, section_path(sections, section), book_title, len(chunks)))
    return chunks


def text_coverage(sections, chunks):
    """Share of extracted body text that appears in some chunk (target >= 98%)."""
    body = {normalise(text) for s in sections for _, text in s.paragraphs if normalise(text)}
    if not body:
        return 1.0
    joined = "\n".join(normalise(c.content) for c in chunks)
    covered = sum(1 for line in body if line in joined)
    return covered / len(body)
