"""Book structure: Chapter -> Section -> Subsection, each with its page range.

The PDF outline (bookmarks) is the primary source. Books without one fall back
to heading detection by font size. Every text line is assigned to exactly one
section, so chunks never cross a section boundary and every line is
accounted for in the completeness check.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

STRUCTURE_VERSION = "1"


@dataclass
class Section:
    ordinal: int
    level: int
    title: str
    pdf_page_start: int
    number: str = ""
    parent: int | None = None
    pdf_page_end: int | None = None
    paragraphs: list[tuple[int, str]] = field(default_factory=list)  # (pdf_page, text)

    @property
    def is_leaf(self):
        return getattr(self, "_leaf", True)


def _number_of(title):
    match = re.match(r"^\s*((?:\d+\.)*\d+)[\s.:-]", title)
    return match.group(1) if match else ""


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def sections_from_toc(toc, page_count):
    sections, stack = [], []
    for index, (level, title, page) in enumerate(toc):
        page = min(max(int(page or 1), 1), page_count)
        while stack and stack[-1].level >= level:
            stack.pop()
        section = Section(ordinal=index, level=int(level), title=title.strip(), pdf_page_start=page,
                          number=_number_of(title), parent=stack[-1].ordinal if stack else None)
        sections.append(section)
        stack.append(section)
    return sections


def sections_from_headings(pages):
    """Fallback: lines clearly larger than body text are headings."""
    sizes = Counter()
    for page in pages:
        for line in page.lines:
            sizes[line.size] += len(line.text)
    if not sizes:
        return []
    body = sizes.most_common(1)[0][0]
    heading_sizes = sorted({line.size for p in pages for line in p.lines if line.size >= body * 1.25}, reverse=True)
    level_of = {size: min(index + 1, 3) for index, size in enumerate(heading_sizes)}
    sections = []
    stack = []
    for page in pages:
        for line in page.lines:
            level = level_of.get(line.size)
            if not level or len(line.text) > 120:
                continue
            while stack and stack[-1].level >= level:
                stack.pop()
            section = Section(ordinal=len(sections), level=level, title=line.text, pdf_page_start=page.pdf_page,
                              number=_number_of(line.text), parent=stack[-1].ordinal if stack else None)
            sections.append(section)
            stack.append(section)
    return sections


def _finalise(sections, page_count):
    children = {s.parent for s in sections if s.parent is not None}
    for s in sections:
        s._leaf = s.ordinal not in children
    for i, s in enumerate(sections):
        following = [t.pdf_page_start for t in sections[i + 1:] if t.level <= s.level]
        s.pdf_page_end = max(s.pdf_page_start, (following[0] if following else page_count))
    return sections


def build_structure(document_toc, pages):
    """Return the section list with every text line assigned to exactly one section."""
    page_count = max((p.pdf_page for p in pages), default=0)
    sections = sections_from_toc(document_toc, page_count) if document_toc else sections_from_headings(pages)
    if not sections:
        sections = [Section(ordinal=0, level=1, title="Full text", pdf_page_start=1)]
    sections = _finalise(sections, page_count)
    if sections[0].pdf_page_start > 1:
        front = Section(ordinal=-1, level=1, title="Front matter", pdf_page_start=1,
                        pdf_page_end=sections[0].pdf_page_start)
        front._leaf = True
        sections.insert(0, front)
    # Reading order: every line belongs to the latest heading before it, so a
    # chapter keeps its own introduction and nothing is left unassigned.
    leaves = sections

    starts = {}
    for leaf in leaves:
        starts.setdefault(leaf.pdf_page_start, []).append(leaf)
    current = leaves[0]
    for page in pages:
        pending = list(starts.get(page.pdf_page, []))
        # A section whose heading is not printed on its start page begins at the
        # top of that page; one whose heading is printed begins at the heading.
        on_page = [leaf for leaf in pending if any(_matches(leaf, line.text) for line in page.lines)]
        for leaf in pending:
            if leaf not in on_page:
                current = leaf
        for line in page.lines:
            if on_page and _matches(on_page[0], line.text):
                current = on_page.pop(0)
                continue  # the heading itself is structure, not body text
            current.paragraphs.append((page.pdf_page, line.text))
        for leaf in on_page:  # heading promised by the outline but not found
            current = leaf
    return sections


def _matches(section, text):
    line, title = _norm(text), _norm(section.title)
    return bool(line) and len(line) >= 3 and (title == line or (len(line) >= 12 and title.startswith(line)))
