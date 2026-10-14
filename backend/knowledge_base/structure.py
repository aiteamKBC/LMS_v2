"""Book structure: Chapter -> Section -> Subsection, each with its page range.

The PDF outline (bookmarks) is the primary source. Books without one fall back
to their own heading numbering (Chapter 3 / 3.1 / 3.1.1) when they clearly use
it, and otherwise to heading detection by font size. Every text line is assigned to exactly one
section, so chunks never cross a section boundary and every line is
accounted for in the completeness check.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

STRUCTURE_VERSION = "2"


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


@dataclass
class _Heading:
    text: str
    size: float


_CHAPTER = re.compile(r"^\s*(?:chapter|appendix|part|unit|module)\s*(\d+)\b", re.IGNORECASE)
_DOTTED = re.compile(r"^\s*(\d+(?:\.\d+)+)\.?\s*(?=[^\d\s.%])")
_BARE = re.compile(r"^\s*(\d+)[\s.:]+(?=[^\d\s.%])")


def _numbered_heading(line, body):
    """(level, number) for a line styled and numbered as a heading, else None."""
    if len(line.text) > 120 or line.size <= body:
        return None
    big = line.size >= body * 1.5
    match = _CHAPTER.match(line.text)
    if match and big:
        return 1, match.group(1)
    match = _DOTTED.match(line.text)
    if match and line.bold:
        return min(match.group(1).count(".") + 1, 3), match.group(1)
    match = _BARE.match(line.text)
    if match and big and line.bold:
        return 1, match.group(1)
    return None


def sections_from_numbering(pages, body):
    """Books whose headings carry their own numbering (Chapter 3, 3.1, 3.1.1):
    the numbering gives the level, so a large cover title cannot become the only
    chapter. Returns [] when the book does not clearly number its headings."""
    styled = [line for page in pages for line in page.lines
              if line.bold and line.size > body and len(line.text) <= 120]
    found = []
    for page in pages:
        for index, line in enumerate(page.lines):
            heading = _numbered_heading(line, body)
            if not heading:
                continue
            title = line.text
            following = page.lines[index + 1] if index + 1 < len(page.lines) else None
            # A heading wrapped onto a second line keeps its full title.
            if (following and following.size == line.size and following.bold == line.bold
                    and not _numbered_heading(following, body) and len(title) + len(following.text) <= 120):
                title = f"{title} {following.text}"
            found.append((page, _Heading(title, line.size), heading))
    if len(found) < 10 or len(found) * 2 < len(styled) or not any(level == 1 for _, _, (level, _) in found):
        return []
    sections, stack = [], []
    for page, line, (level, number) in found:
        while stack and stack[-1].level >= level:
            stack.pop()
        section = Section(ordinal=len(sections), level=level, title=line.text, pdf_page_start=page.pdf_page,
                          number=number, parent=stack[-1].ordinal if stack else None)
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
    numbered = sections_from_numbering(pages, body)
    if numbered:
        return numbered
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
