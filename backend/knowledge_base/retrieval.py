"""Retrieval and coverage planning for question generation.

The number of chunks is not fixed: it follows the number of distinct concepts
the quiz needs, and the token ceiling is an upper bound, never a target.

* Topic mode: hybrid search (vectors + full text) inside the selected books;
  one chunk per section first, so each question can test a different concept.
  If the topic cannot be embedded with the books' own model here, the search
  is keyword-only and says so (``keyword_search_only``).
* Whole-book mode (no topic): chapters are covered in order; if there are more
  chapters than questions, an evenly spread sample is taken and declared.
* Context is deduplicated (overlapping neighbours, repeated sentences) and
  delivered as ``Source file:`` blocks -- never more blocks than questions,
  because the existing allocation only uses the first N blocks.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass, field

from . import providers
from .tokens import count_tokens

logger = logging.getLogger(__name__)

CEILING_BASE = 1500
CEILING_PER_QUESTION = 350
CEILING_MAX = 15000
EXISTING_CHAR_CAP = 60000       # the generator's own limit -- unchanged
MIN_CONCEPT_TOKENS = 250
MAX_VECTOR_DISTANCE = 0.8       # vector-only hits further than this are not relevant
SEARCH_LIMIT = 60


_STOPWORDS = frozenset(
    "the and for are but not you all any can had her was one our out has have what which who whom this that these "
    "those does did with from into about than then them they their there when where why how most more some such "
    "only own same other each first also would should could will shall may might must very just best following "
    "true false statement correct answer option below above".split())


class KnowledgeBaseUnavailable(ValueError):
    """Shown to staff: the selected books cannot be used right now."""


@dataclass
class Segment:
    chunk_id: int
    build_id: str
    book_id: str
    book_title: str
    chapter: str
    section: str
    pages: str
    tokens: int
    text: str = ""


@dataclass
class Plan:
    mode: str
    question_count: int
    ceiling: int
    blocks: list[tuple[str, list[Segment]]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    chapters_total: int = 0
    chapters_used: list[str] = field(default_factory=list)

    @property
    def tokens(self):
        return sum(seg.tokens for _, segs in self.blocks for seg in segs)

    @property
    def segments(self):
        return [seg for _, segs in self.blocks for seg in segs]

    def text(self):
        parts = []
        for label, segs in self.blocks:
            body = "\n\n".join(f"[{seg.section}, p. {seg.pages}]\n{seg.text}" for seg in segs)
            parts.append(f"Source file: {label}\n{body}")
        return "\n\n".join(parts)


def ceiling_for(question_count):
    return min(CEILING_MAX, CEILING_BASE + CEILING_PER_QUESTION * max(1, question_count))


def _vector_literal(vector):
    return "[" + ",".join(f"{v:.7g}" for v in vector) + "]"


def _pages(row):
    start, end = row.get("pdf_page_start"), row.get("pdf_page_end")
    return f"{start}" if start == end or not end else f"{start}–{end}"


class _Tree:
    def __init__(self, sections):
        self.by_id = {s["id"]: s for s in sections}

    def chapter_of(self, section_id):
        node = self.by_id.get(section_id)
        while node and node.get("parent_id") in self.by_id:
            node = self.by_id[node["parent_id"]]
        return node

    def title(self, section_id):
        node = self.by_id.get(section_id)
        return node["title"] if node else "Book"


def plan(repo, provider, book_ids, question_count, topic="", char_budget=EXISTING_CHAR_CAP):
    question_count = max(1, min(int(question_count or 5), 60))
    builds = repo.active_builds(book_ids)
    if not builds:
        raise KnowledgeBaseUnavailable("None of the selected books is ready yet.")
    build_info = {str(b["build_id"]): b for b in builds}
    tree = _Tree(repo.sections_for_builds(list(build_info)))
    result = Plan(mode="topic" if topic.strip() else "whole_book", question_count=question_count,
                  ceiling=ceiling_for(question_count))
    chosen = _topic_candidates(repo, provider, builds, topic, question_count, result) if topic.strip() \
        else _whole_book_candidates(repo, build_info, question_count, tree, result)

    segments = _fill_budget(repo, chosen, build_info, tree, result, char_budget)
    _dedupe(segments)
    result.blocks = _blocks(segments, result.mode, question_count)
    concepts = len({seg.section for seg in segments})
    if concepts < math.ceil(question_count / 3):
        result.warnings.append("low_content")
    if not segments:
        raise KnowledgeBaseUnavailable("The selected books have no content about this topic.")
    return result


def _query_vector(provider, text, space_provider, space_model, dims):
    """The topic's vector in this embedding space, or None when the provider here
    cannot produce one (paid calls off, another model, or the call failed)."""
    if not providers.matches_space(provider, space_provider, space_model, dims):
        return None
    try:
        return provider.embed([text]).vectors[0]
    except Exception:  # noqa: BLE001 - degrade to keyword search; never fail the generation
        logger.warning("Topic embedding failed; matching by keywords.", exc_info=True)
        return None


def _topic_candidates(repo, provider, builds, topic, question_count, result):
    by_space = {}
    for b in builds:
        key = (b["embedding_space_id"], b["dims"], b["space_provider"], b["space_model"])
        by_space.setdefault(key, []).append(str(b["build_id"]))
    query = topic.strip()
    hits = []
    for (space_id, dims, space_provider, space_model), build_ids in by_space.items():
        vector = _query_vector(provider, query, space_provider, space_model, dims)
        if vector is None:                       # never compare vectors of different models
            if "keyword_search_only" not in result.warnings:
                result.warnings.append("keyword_search_only")
            hits.extend(repo.search_chunks_text(build_ids, query, SEARCH_LIMIT))
        else:
            hits.extend(repo.search_chunks(build_ids, space_id, dims, _vector_literal(vector), query, SEARCH_LIMIT))
    relevant = [h for h in hits if h["text_match"] or (h["distance"] is not None and h["distance"] <= MAX_VECTOR_DISTANCE)]
    relevant.sort(key=lambda h: -h["score"])
    chosen, seen_sections = [], set()
    for hit in relevant:                         # pass 1: one chunk per section = distinct concepts
        if hit["section_id"] not in seen_sections:
            chosen.append(hit)
            seen_sections.add(hit["section_id"])
        if len(chosen) >= question_count:
            return chosen
    for hit in relevant:                         # pass 2: depth for rich sections, still bounded
        if hit not in chosen:
            chosen.append(hit)
        if len(chosen) >= question_count:
            break
    return chosen


def _whole_book_candidates(repo, build_info, question_count, tree, result):
    index = repo.chunk_index(list(build_info))
    chapters = []
    for build_id in build_info:
        seen = []
        for row in index:
            if str(row["build_id"]) != build_id:
                continue
            chapter = tree.chapter_of(row["section_id"])
            key = chapter["id"] if chapter else None
            if key not in [c[0] for c in seen]:
                seen.append((key, build_id))
        chapters.extend(seen)
    real = [c for c in chapters if tree.title(c[0]) != "Front matter"]
    if real:                                     # the cover/preface is not a chapter to assess
        chapters = real
    result.chapters_total = len(chapters)
    if len(chapters) > question_count:           # declared, evenly spread sample
        step = len(chapters) / question_count
        chapters = [chapters[int(i * step)] for i in range(question_count)]
    result.chapters_used = [tree.title(c[0]) for c in chapters]
    per_chapter = max(1, math.ceil(question_count / max(1, len(chapters))))
    chosen = []
    for chapter_id, build_id in chapters:
        rows = [r for r in index if str(r["build_id"]) == build_id
                and ((tree.chapter_of(r["section_id"]) or {}).get("id") == chapter_id)]
        picked, sections = [], set()
        for row in rows:                          # first chunk of distinct sections in reading order
            if row["section_id"] not in sections:
                picked.append(row)
                sections.add(row["section_id"])
            if len(picked) >= per_chapter:
                break
        chosen.extend(picked)
    return chosen


def _fill_budget(repo, chosen, build_info, tree, result, char_budget):
    budget_tokens = result.ceiling
    contents = repo.chunk_contents([c["id"] for c in chosen])
    segments, used, chars = [], 0, 0
    for hit in chosen:
        text = contents.get(hit["id"], "")
        tokens = count_tokens(text)
        room = budget_tokens - used
        if tokens > room:
            if room < MIN_CONCEPT_TOKENS:
                result.warnings.append("budget_limited")
                break
            text = _shorten(text, room)          # shorten a concept before dropping it
            tokens = count_tokens(text)
        if chars + len(text) + 200 > char_budget:
            result.warnings.append("budget_limited")
            break
        info = build_info[str(hit["build_id"])]
        chapter = tree.chapter_of(hit["section_id"])
        segments.append(Segment(
            chunk_id=hit["id"], build_id=str(hit["build_id"]), book_id=str(info["book_id"]), book_title=info["title"],
            chapter=chapter["title"] if chapter else info["title"], section=tree.title(hit["section_id"]),
            pages=_pages(hit), tokens=tokens, text=text))
        used += tokens
        chars += len(text) + 200
    return segments


def _shorten(text, max_tokens):
    out = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if count_tokens(" ".join(out + [sentence])) > max_tokens:
            break
        out.append(sentence)
    return " ".join(out) if out else text[: max_tokens * 3]


def _sentence_key(sentence):
    return hashlib.sha1(re.sub(r"[^a-z0-9]+", " ", sentence.lower()).strip().encode()).hexdigest()


def _dedupe(segments):
    """Drop any sentence already sent (chunk overlaps, asset text repeating a
    paragraph). A segment left empty is removed."""
    seen = set()
    for seg in segments:
        kept = []
        for line in seg.text.split("\n"):
            sentences = [s for s in re.split(r"(?<=[.!?])\s+", line) if s.strip()]
            fresh = []
            for sentence in sentences:
                key = _sentence_key(sentence)
                if len(sentence.strip()) < 20 or key not in seen:
                    fresh.append(sentence)
                    seen.add(key)
            if fresh:
                kept.append(" ".join(fresh))
        seg.text = "\n".join(kept)
        seg.tokens = count_tokens(seg.text)
    segments[:] = [s for s in segments if s.text.strip()]


def _blocks(segments, mode, question_count):
    blocks = {}
    for seg in segments:
        label = seg.book_title if mode == "topic" else f"{seg.book_title} — {seg.chapter}"
        blocks.setdefault(label, []).append(seg)
    items = list(blocks.items())
    while len(items) > question_count:           # never more blocks than questions
        label, segs = items.pop()
        prev_label, prev_segs = items[-1]
        items[-1] = (prev_label, prev_segs + segs)
    return items


def attribute_questions(questions, plan_):
    """Probable source of each generated question: local lexical overlap with the
    chunks actually sent. A probability, never proof."""
    def words(text):
        found = set()
        for w in re.findall(r"[a-z]{3,}", text.lower()):
            if w in _STOPWORDS:
                continue
            found.add(w[:-1] if len(w) > 4 and w.endswith("s") else w)
        return found

    chunks = [(seg, words(seg.text)) for seg in plan_.segments]
    out = []
    for index, question in enumerate(questions):
        correct = [a.get("text", "") for a in question.get("answers", []) if a.get("isCorrect")]
        if question.get("questionType") == "image_matching":
            concepts = []
            for value in correct:
                try:
                    pair = json.loads(value)
                except (TypeError, ValueError):
                    pair = None
                concepts.append(str(pair.get("match") or "") if isinstance(pair, dict) else value)
            correct = concepts
        text = " ".join([question.get("text", "")] + correct)
        q_words = words(text)
        best, score = None, 0.0
        for seg, c_words in chunks:
            if not q_words or not c_words:
                continue
            overlap = len(q_words & c_words) / len(q_words)
            if overlap > score:
                best, score = seg, overlap
        out.append({
            "index": index, "sha": hashlib.sha256(question.get("text", "").encode("utf-8")).hexdigest(),
            "chunk_id": best.chunk_id if best else None, "confidence": round(score, 3), "method": "lexical_overlap",
            "section": best.section if best and score >= 0.3 else None,
            "pages": best.pages if best and score >= 0.3 else None,
            "book": best.book_title if best and score >= 0.3 else None,
        })
    return out
