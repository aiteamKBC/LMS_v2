"""Processing one book build, stage by stage, resumably.

Extracting -> Structuring -> Chunking -> Embedding -> Verifying -> Activating.

* Every batch is saved before the next starts, and each stage skips what is
  already stored, so a crash or restart repeats at most one batch.
* Embeddings are looked up by content hash first; only new text is sent to the
  provider, so a retry or a new edition never pays twice for the same content.
* Ready is decided by explicit checks, not by "the worker finished". A gap puts
  the build in needs_review with the exact pages and reasons.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from . import assets as asset_extractor
from . import chunking, extract, storage, structure
from .tokens import count_tokens

PAGE_BATCH = 20
EMBED_BATCH = 100
MIN_TEXT_COVERAGE = 0.98
PIPELINE_VERSION = "1"


def build_versions():
    return {
        "pipeline": PIPELINE_VERSION,
        "extractor": extract.EXTRACTOR_VERSION,
        "asset_extractor": asset_extractor.ASSET_EXTRACTOR_VERSION,
        "structure": structure.STRUCTURE_VERSION,
        "chunker": chunking.CHUNKER_VERSION,
    }


class PermanentFailure(RuntimeError):
    """The file itself cannot be processed; retrying will not help."""


@dataclass
class Context:
    job: dict
    repo: object
    store: object
    provider: object
    info: dict
    throttle: object = None        # callable run between batches (VPS load check)

    def beat(self, stage, **progress):
        self.repo.heartbeat(self.job["id"], self.job["lease_id"], stage, progress)
        if self.throttle:
            self.throttle()


def run_build(ctx: Context):
    info = ctx.info
    try:
        document = extract.open_pdf(ctx.store.get(info["storage_ref"]))
    except extract.PdfRejected as exc:
        raise PermanentFailure(str(exc)) from exc
    try:
        page_count = document.page_count
        if info.get("page_count") != page_count:
            ctx.repo.set_page_count(info["version_id"], page_count)
        _extract(ctx, document, page_count)
        coverage = _structure(ctx, document, page_count)
        _embed(ctx)
        return _verify_and_activate(ctx, page_count, coverage)
    finally:
        document.close()


def _extract(ctx, document, page_count):
    version_id = ctx.info["version_id"]
    done = ctx.repo.stored_pages(version_id, extract.EXTRACTOR_VERSION)
    todo = [n for n in range(1, page_count + 1) if n not in done]
    ctx.beat("extracting", pages_done=len(done), pages_total=page_count)
    for start in range(0, len(todo), PAGE_BATCH):
        batch = todo[start:start + PAGE_BATCH]
        pages, asset_items = [], []
        for number in batch:
            page = document.load_page(number - 1)
            result = extract.extract_page(page, number)
            pages.append(result)
            if result.status != "failed":
                asset_items.extend(_page_assets(ctx, document, page, number))
        ctx.repo.save_assets(ctx.job, ctx.info["build_id"], asset_items)
        ctx.repo.save_pages(ctx.job, version_id, extract.EXTRACTOR_VERSION, pages)
        ctx.beat("extracting", pages_done=len(done) + start + len(batch), pages_total=page_count)


def _page_assets(ctx, document, page, number):
    items = []
    try:
        found = asset_extractor.extract_page_assets(document, page, number)
        thumb, preview = asset_extractor.page_previews(page)
    except Exception:  # noqa: BLE001 - visuals never fail a page's text
        return items
    for kind, data in (("thumb", thumb), ("preview", preview)):
        ctx.store.put(storage.preview_key(str(ctx.info["version_id"]), number, kind), data)
    for asset in found:
        sha = storage.sha256_of(asset.data)
        ref = ctx.store.put(storage.asset_key(sha, "webp"), asset.data)
        items.append((
            {"sha256": sha, "media_type": asset.media_type, "width": asset.width, "height": asset.height,
             "size_bytes": len(asset.data), "storage_ref": ref},
            {"pdf_page": number, "bbox": asset.bbox, "kind": asset.kind, "caption": asset.caption,
             "label_text": asset.table_markdown or asset.label_text},
        ))
    return items


def _pages_from_rows(rows):
    pages = []
    for row in rows:
        lines = [extract.Line(b["t"], b["s"], b["b"], b["y"]) for b in (row["blocks"] or [])]
        pages.append(extract.PageResult(row["pdf_page"], row["printed_label"], row["status"], lines))
    return pages


def _structure(ctx, document, page_count):
    rows = ctx.repo.load_pages(ctx.info["version_id"], extract.EXTRACTOR_VERSION)
    pages = extract.strip_running_lines(_pages_from_rows(rows))
    sections = structure.build_structure(document.get_toc(), pages)
    chunks = chunking.chunk_book(sections, ctx.info["title"])
    coverage = chunking.text_coverage(sections, chunks)

    occurrences = ctx.repo.load_occurrences(ctx.info["build_id"])
    pages_by_sha = {}
    for occ in occurrences:
        pages_by_sha.setdefault(occ["sha256"], []).append(occ["pdf_page"])
    decorative_shas = asset_extractor.mark_decorative(pages_by_sha, page_count)
    decorative_ids = {o["id"] for o in occurrences if o["sha256"] in decorative_shas}

    links = []
    for occ in occurrences:
        section = _section_for_page(sections, occ["pdf_page"])
        text_chunk = next((c for c in chunks if c.kind == "text" and c.pdf_page_start <= occ["pdf_page"] <= c.pdf_page_end), None)
        if text_chunk is not None:
            links.append((occ["id"], section.ordinal, text_chunk.ordinal, "same_page"))
        if occ["id"] in decorative_ids:
            links.append((occ["id"], section.ordinal, None, "same_page"))
            continue
        asset_chunk = _asset_chunk(occ, section, sections, ctx.info["title"], len(chunks))
        if asset_chunk is None:
            links.append((occ["id"], section.ordinal, None, "same_page"))
            continue
        chunks.append(asset_chunk)
        links.append((occ["id"], section.ordinal, asset_chunk.ordinal, "asset_chunk"))

    ctx.repo.replace_structure(ctx.job, ctx.info["build_id"], sections, chunks, links, decorative_ids)
    ctx.beat("chunking", sections=len(sections), chunks=len(chunks), text_coverage=round(coverage, 4))
    return coverage


def _section_for_page(sections, pdf_page):
    candidates = [s for s in sections if s.pdf_page_start <= pdf_page]
    return candidates[-1] if candidates else sections[0]


def _asset_chunk(occ, section, sections, book_title, ordinal):
    """Searchable text for a figure or table. Figure numbers are stripped, so the
    generator never writes 'see Figure 3.2' for an image the learner cannot see."""
    caption = asset_extractor.strip_figure_number(occ["book_caption"] or "")
    description = occ["manual_description"] or occ["vision_description"] or ""
    path = " › ".join(chunking.section_path(sections, section))
    if occ["kind"] == "table_snapshot":
        body = "\n".join(part for part in (caption, occ["label_text"] or "") if part)
        kind = "table"
    else:
        parts = [caption, f"Labels: {occ['label_text']}" if occ["label_text"] else "", description]
        body = "\n".join(part for part in parts if part)
        kind = "asset"
    if not body.strip():
        return None  # nothing searchable yet; stays linked to its section (shown as "no description")
    header = f"{book_title} › {path} (p. {occ['pdf_page']})"
    return chunking.Chunk(
        ordinal=ordinal, section_ordinal=section.ordinal, kind=kind, content=body,
        embed_text=f"{header}\n\n{body}", content_sha256=chunking.content_hash(body),
        token_count=count_tokens(body), pdf_page_start=occ["pdf_page"], pdf_page_end=occ["pdf_page"],
    )


def _embed(ctx):
    space_id = ctx.info["embedding_space_id"]
    embedded = 0
    while True:
        batch = ctx.repo.chunks_without_vectors(ctx.info["build_id"], space_id, EMBED_BATCH)
        if not batch:
            break
        cached = ctx.repo.cached_embeddings({row["content_sha256"].strip() for row in batch}, space_id)
        missing = {}
        for row in batch:
            sha = row["content_sha256"].strip()
            if sha not in cached and sha not in missing:
                missing[sha] = row["embed_text"]
        new = []
        if missing:
            result = ctx.provider.embed(list(missing.values()))
            per_item = max(1, result.total_tokens // max(1, len(missing)))
            for sha, vector in zip(missing.keys(), result.vectors):
                new.append((sha, vector, per_item))
        literals = dict(cached)
        literals.update({sha: _literal(vec) for sha, vec, _ in new})
        ctx.repo.store_vectors(ctx.job, space_id, new,
                               [(row["id"], literals[row["content_sha256"].strip()]) for row in batch])
        embedded += len(batch)
        ctx.beat("embedding", chunks_embedded=embedded)


def _literal(vector):
    return "[" + ",".join(f"{v:.7g}" for v in vector) + "]"


def _verify_and_activate(ctx, page_count, coverage):
    build_id, space_id = ctx.info["build_id"], ctx.info["embedding_space_id"]
    rows = ctx.repo.load_pages(ctx.info["version_id"], extract.EXTRACTOR_VERSION)
    statuses = {row["pdf_page"]: row["status"] for row in rows}
    issues = []
    for number in range(1, page_count + 1):
        if number not in statuses:
            issues.append({"pdf_page": number, "stage": "extracting", "reason": "Page was not extracted.", "retriable": True})
        elif statuses[number] == "failed":
            issues.append({"pdf_page": number, "stage": "extracting", "reason": "Text could not be read from this page.", "retriable": True})
    counts = ctx.repo.verification_counts(build_id, space_id)
    if counts["chunks_without_vector"]:
        raise RuntimeError(f"{counts['chunks_without_vector']} chunks still have no vector; will retry.")
    if counts["chunks_without_section"]:
        issues.append({"pdf_page": None, "stage": "structuring", "reason": f"{counts['chunks_without_section']} chunks have no section.", "retriable": True})
    if coverage < MIN_TEXT_COVERAGE:
        issues.append({"pdf_page": None, "stage": "chunking", "reason": f"Only {coverage:.1%} of the text reached the chunks.", "retriable": True})

    completeness = {
        "pages_total": page_count,
        "pages_by_status": {s: sum(1 for v in statuses.values() if v == s) for s in set(statuses.values())},
        "text_coverage": round(coverage, 4), **counts, "issues": len(issues),
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    ctx.repo.record_issues(ctx.job, build_id, issues)
    status = "needs_review" if issues else "ready"
    ctx.repo.set_build_status(ctx.job, build_id, status, completeness)
    ctx.beat("verifying", **{k: v for k, v in completeness.items() if k != "pages_by_status"})
    if status == "ready":
        ctx.repo.activate_build(build_id)
    return status
