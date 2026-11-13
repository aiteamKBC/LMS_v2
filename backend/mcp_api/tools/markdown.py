"""A deliberately small Markdown -> HTML converter for lesson text written by the assistant.

Safe by construction: every piece of input text is HTML-escaped first, and the only
markup in the output is the fixed set of tags emitted here (p, br, h2-h4, ul/ol/li,
blockquote, strong, em, code, and https links). No input HTML is ever passed through;
callers also refuse input that contains tags at all (SECURITY_AUDIT A8). There is no
server-side HTML sanitiser in this codebase, so nothing else may build this HTML.

Supported: ``#``/``##``/``###`` headings, ``-``/``*`` and ``1.`` lists, ``>`` quotes,
paragraphs (single newlines become line breaks), ``**bold**``, ``*italic*``/``_italic_``,
`` `code` `` and ``[text](https://...)`` links.
"""
import html
import re

_HEADING = re.compile(r"(#{1,3})\s+(.+)")
_BULLET = re.compile(r"[-*]\s+(.+)")
_NUMBERED = re.compile(r"\d+[.)]\s+(.+)")
_QUOTE = re.compile(r">\s?(.*)")
_CODE = re.compile(r"`([^`]+)`")
_LINK = re.compile(r"\[([^\]]+)\]\((https://[^\s()<>\"']+)\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<![\w*])[*_](?![\s*_])(.+?)(?<![\s*_])[*_](?![\w*])")


def _inline(text):
    codes = []

    def keep_code(match):
        codes.append(f"<code>{match.group(1)}</code>")
        return f"\x00{len(codes) - 1}\x00"

    text = _CODE.sub(keep_code, html.escape(text.strip(), quote=True))
    text = _LINK.sub(lambda m: f'<a href="{m.group(2)}" rel="noopener noreferrer">{m.group(1)}</a>', text)
    text = _BOLD.sub(r"<strong>\1</strong>", text)
    text = _ITALIC.sub(r"<em>\1</em>", text)
    return re.sub("\x00(\\d+)\x00", lambda m: codes[int(m.group(1))], text)


def markdown_to_html(source):
    blocks, paragraph, items, list_tag, quote = [], [], [], "", []

    def flush():
        nonlocal list_tag
        if paragraph:
            blocks.append("<p>" + "<br>".join(_inline(line) for line in paragraph) + "</p>")
            paragraph.clear()
        if items:
            blocks.append(f"<{list_tag}>" + "".join(f"<li>{_inline(i)}</li>" for i in items) + f"</{list_tag}>")
            items.clear()
            list_tag = ""
        if quote:
            blocks.append("<blockquote><p>" + "<br>".join(_inline(line) for line in quote) + "</p></blockquote>")
            quote.clear()

    for raw in str(source or "").replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        heading, bullet, numbered, quoted = (pattern.fullmatch(line) for pattern in (_HEADING, _BULLET, _NUMBERED, _QUOTE))
        if not line:
            flush()
        elif heading:
            flush()
            level = len(heading.group(1)) + 1
            blocks.append(f"<h{level}>{_inline(heading.group(2))}</h{level}>")
        elif bullet or numbered:
            tag = "ul" if bullet else "ol"
            if paragraph or quote or (items and list_tag != tag):
                flush()
            list_tag = tag
            items.append((bullet or numbered).group(1))
        elif quoted:
            if paragraph or items:
                flush()
            quote.append(quoted.group(1))
        else:
            if items or quote:
                flush()
            paragraph.append(line)
    flush()
    return "".join(blocks)
