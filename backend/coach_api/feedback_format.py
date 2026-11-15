"""Sanitising and inspecting coach feedback rich text.

Feedback is stored in the existing text column so older plain-text reviews
remain valid.  The marking editor may send a small, allow-listed HTML subset;
keeping the allow-list on the server prevents a compromised client from
turning learner-facing feedback into executable markup.
"""

from __future__ import annotations

from html import escape
from html.parser import HTMLParser
import re


_ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li",
    "h2", "h3", "h4", "font", "span",
}
_BLOCK_TAGS = {"p", "ul", "ol", "li", "h2", "h3", "h4"}
_FONT_SIZE = re.compile(r"^(?:[1-7]|(?:small|medium|large|x-large|xx-large))$")
_CSS_FONT_SIZE = re.compile(r"^font-size\s*:\s*(?:\d+(?:\.\d+)?(?:px|em|rem|%))\s*;?$", re.I)


class _FeedbackHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._open: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs):
        tag = tag.lower()
        if self._skip_depth:
            if tag in {"script", "style", "iframe", "object", "embed"}:
                self._skip_depth += 1
            return
        if tag in {"script", "style", "iframe", "object", "embed"}:
            self._skip_depth = 1
            return
        if tag not in _ALLOWED_TAGS:
            return
        safe_attrs: list[str] = []
        for name, value in attrs:
            name = name.lower()
            value = value or ""
            if tag == "font" and name == "size" and _FONT_SIZE.fullmatch(value.strip().lower()):
                safe_attrs.append(f' size="{escape(value.strip(), quote=True)}"')
            elif tag == "span" and name == "style" and _CSS_FONT_SIZE.fullmatch(value.strip()):
                safe_attrs.append(f' style="{escape(value.strip(), quote=True)}"')
        self.parts.append(f"<{tag}{''.join(safe_attrs)}>")
        self._open.append(tag)

    def handle_startendtag(self, tag: str, attrs):
        if tag.lower() == "br":
            self.parts.append("<br>")
        else:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str):
        tag = tag.lower()
        if self._skip_depth:
            if tag in {"script", "style", "iframe", "object", "embed"}:
                self._skip_depth -= 1
            return
        if tag not in _ALLOWED_TAGS:
            return
        # Close only tags that were emitted.  Malformed pasted HTML must not
        # make the stored document contain unmatched closing tags.
        if tag in self._open:
            while self._open:
                current = self._open.pop()
                self.parts.append(f"</{current}>")
                if current == tag:
                    break

    def handle_data(self, data: str):
        if self._skip_depth:
            return
        self.parts.append(escape(data))

    def handle_entityref(self, name: str):
        if self._skip_depth:
            return
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str):
        if self._skip_depth:
            return
        self.parts.append(f"&#{name};")


def sanitize_feedback(value: str | None) -> str:
    """Return plain text or safe feedback HTML, trimmed at the edges."""
    text = str(value or "").strip()
    if "<" not in text or ">" not in text:
        return text
    parser = _FeedbackHTMLParser()
    try:
        parser.feed(text)
        parser.close()
    except Exception:  # malformed pasted markup should degrade to safe text
        return escape(re.sub(r"<[^>]*>", "", text)).strip()
    return "".join(parser.parts).strip()


class _FeedbackTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str):
        self.parts.append(data)

    def handle_starttag(self, tag: str, attrs):
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str):
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_startendtag(self, tag: str, attrs):
        if tag.lower() == "br":
            self.parts.append("\n")


def feedback_plain_text(value: str | None) -> str:
    """Extract readable text for required-field checks and audit summaries."""
    text = str(value or "")
    if "<" not in text or ">" not in text:
        return text.strip()
    parser = _FeedbackTextParser()
    parser.feed(text)
    parser.close()
    return " ".join("".join(parser.parts).split())
