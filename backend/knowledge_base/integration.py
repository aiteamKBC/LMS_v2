"""The only bridge between the Knowledge Base and the existing quiz generator.

``generate_ai_questions`` calls ``merge_into_source`` only when the request
carries ``knowledgeBookIds``. Without it no book retrieval or image loading runs.
"""
from __future__ import annotations

import logging

from . import quiz_images, retrieval
from .providers import PaidCallsDisabled, get_embedding_provider
from .repository import Repository

logger = logging.getLogger(__name__)
KnowledgeBaseUnavailable = retrieval.KnowledgeBaseUnavailable


def requested_book_ids(payload):
    if payload is None:
        return []
    if hasattr(payload, "getlist"):
        values = payload.getlist("knowledgeBookIds") or payload.getlist("knowledgeBookIds[]")
    else:
        values = payload.get("knowledgeBookIds") or []
    if isinstance(values, str):
        values = [values]
    ids = []
    for value in values:
        ids.extend(part.strip() for part in str(value).split(",") if part.strip())
    return list(dict.fromkeys(ids))


def _question_count(payload):
    try:
        count = int(payload.get("questionCount") or payload.get("question_count") or 5)
    except (TypeError, ValueError):
        count = 5
    return max(1, min(count, 60))


def _query_provider():
    """Embedding provider for the topic lookup, or None when paid calls are off
    in this process (retrieval then matches by keywords)."""
    try:
        return get_embedding_provider()
    except PaidCallsDisabled:
        return None


def merge_into_source(payload, source_text, topic, user="", repo=None, provider=None):
    """Return (source_text, knowledge_meta). Book content comes first, within its
    ceiling; uploaded or pasted content fills the rest of the generator's
    existing 60,000-character limit, so that limit never cuts a book block."""
    repo = repo or Repository()
    book_ids = requested_book_ids(payload)
    count = _question_count(payload)
    plan = retrieval.plan(repo, provider or _query_provider(), book_ids, count, topic or "")
    images, image_warnings = quiz_images.select(repo, plan)
    plan.warnings.extend(image_warnings)
    kb_text = plan.text()

    existing = (source_text or "").strip()
    if existing and not existing.startswith("Source file:"):
        existing = f"Source file: Pasted lesson content\n{existing}"
    remaining = retrieval.EXISTING_CHAR_CAP - len(kb_text) - 2
    combined = kb_text if not existing or remaining <= 0 else f"{kb_text}\n\n{existing[:remaining]}"

    meta = {
        "mode": plan.mode,
        "books": sorted({(s.book_id, s.book_title) for s in plan.segments}, key=lambda b: b[1]),
        "chaptersTotal": plan.chapters_total,
        "chaptersUsed": plan.chapters_used,
        "sections": [{"book": s.book_title, "chapter": s.chapter, "section": s.section, "pages": s.pages}
                     for s in plan.segments],
        "tokens": plan.tokens,
        "ceiling": plan.ceiling,
        "warnings": plan.warnings,
        "generationId": None,
    }
    meta["books"] = [{"id": book_id, "title": title} for book_id, title in meta["books"]]
    try:
        meta["generationId"] = str(repo.log_generation({
            "created_by": user, "mode": plan.mode, "question_count": count,
            "request": {"bookIds": book_ids, "topic": topic or ""},
            "coverage_plan": {"chaptersTotal": plan.chapters_total, "chaptersUsed": plan.chapters_used,
                              "warnings": plan.warnings},
            "kb_tokens": plan.tokens, "ceiling_tokens": plan.ceiling,
        }, [{"block": b, "position": p, "chunk_id": seg.chunk_id, "build_id": seg.build_id, "tokens": seg.tokens}
            for b, (_, segs) in enumerate(plan.blocks) for p, seg in enumerate(segs)]))
    except Exception:  # noqa: BLE001 - provenance logging never blocks generation
        logger.warning("Could not record Knowledge Base provenance.", exc_info=True)
    meta["_plan"] = plan
    meta["_images"] = images
    meta["imagesAvailable"] = len(images)
    return combined, meta


def finish(meta, questions, repo=None):
    """Attach the probable source of each question; strip internal fields."""
    meta.pop("_images", None)
    plan = meta.pop("_plan", None)
    if plan is None:
        return meta
    attributions = retrieval.attribute_questions(questions, plan)
    meta["questionSources"] = [
        {"index": a["index"], "book": a["book"], "section": a["section"], "pages": a["pages"], "confidence": a["confidence"]}
        for a in attributions]
    if meta.get("generationId"):
        try:
            (repo or Repository()).log_question_sources(meta["generationId"], attributions)
        except Exception:  # noqa: BLE001
            logger.warning("Could not record question sources.", exc_info=True)
    return meta
