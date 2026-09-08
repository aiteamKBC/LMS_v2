"""Render an assessment-report PDF in the same layout Aptem produces.

Mirrors the field order and sections of the real Aptem report (header
key/values → Criteria with grouped KSBs → Comments) and reuses the branding
logo lifted from a genuine Aptem report, so a report built through our form
reads the same as one Aptem generated.
"""

import datetime
import html
import io
import os
import re

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_ASSETS = os.path.join(os.path.dirname(__file__), "assets")

# KBC rebranded from "IBIS Consultancy" to "Kent Business College" on this date:
# evidence completed before it uses the IBIS template, on/after it uses Kent.
KENT_FROM = datetime.date(2025, 6, 16)

# Per-template logo file + on-page size in POINTS, matching how Aptem places it
# (top-left, ~75×51 for the IBIS mark; the Kent crest is square).
_TEMPLATES = {
    "ibis": {"logo": "report_logo_ibis.png", "w": 75.0, "h": 51.0},
    "kent": {"logo": "report_logo_kent.png", "w": 52.0, "h": 52.0},
}


def template_for_date(value):
    """'kent' for evidence on/after 16 Jun 2025, else 'ibis'. Accepts a date,
    datetime, ISO string, or None (None → current 'kent' template)."""
    d = value
    if isinstance(d, str):
        try:
            d = datetime.datetime.fromisoformat(d.replace("Z", "+00:00"))
        except ValueError:
            d = None
    if isinstance(d, datetime.datetime):
        d = d.date()
    if not isinstance(d, datetime.date):
        return "kent"
    return "kent" if d >= KENT_FROM else "ibis"

_HEADER_FIELDS = [
    ("Learner name", "learner_name"),
    ("Activity name", "activity_name"),
    ("Evidence name", "evidence_name"),
    ("Time spent", "time_spent"),
    ("Assessment result", "result"),
    ("Assessed by", "assessor"),
    ("Assessment date", "date"),
]

def format_time_spent(value):
    """Minutes (int) or an existing 'HH:MM' string → 'HH:MM' like Aptem."""
    if value in (None, ""):
        return "00:00"
    if isinstance(value, str) and ":" in value:
        return value
    try:
        m = int(value)
    except (TypeError, ValueError):
        return "00:00"
    return f"{m // 60:02d}:{m % 60:02d}"


def _comments_paragraphs(comments_html, style):
    """Convert stored feedback (HTML or plain text) into reportlab paragraphs,
    keeping basic emphasis and paragraph/line breaks, dropping the rest."""
    text = comments_html or ""
    # Normalise the tags reportlab understands; drop everything else.
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(p|div|li)\s*>", "\n", text)
    text = re.sub(r"(?i)<\s*li[^>]*>", "• ", text)
    text = re.sub(r"(?i)<\s*(strong|b)\s*>", "<b>", text)
    text = re.sub(r"(?i)</\s*(strong|b)\s*>", "</b>", text)
    text = re.sub(r"(?i)<\s*(em|i)\s*>", "<i>", text)
    text = re.sub(r"(?i)</\s*(em|i)\s*>", "</i>", text)
    text = re.sub(r"(?i)<(?!/?[biu]>)[^>]+>", "", text)   # strip any other tag
    text = html.unescape(text)
    blocks = [b.strip() for b in text.split("\n") if b.strip()]
    if not blocks:
        return [Paragraph("—", style)]
    return [Paragraph(b, style) for b in blocks]


def build_assessment_report_pdf(data):
    """Return the report as PDF bytes.

    data: learner_name, activity_name, evidence_name, time_spent, result,
          assessor, date, standard, ksbs (dict kind→[{code,description}]),
          comments (HTML/plain). Branding: data['template'] ('ibis'|'kent'),
          or derived from data['evidence_date'] via the 16 Jun 2025 cutoff.
    """
    template = data.get("template")
    if template not in _TEMPLATES:
        template = template_for_date(data.get("evidence_date"))
    tpl = _TEMPLATES[template]

    # All metrics below are lifted directly from a genuine Aptem report:
    # Helvetica 12pt pure-black throughout, 35pt left margin, values at x=149,
    # bold labels + bold section headings, and Aptem's exact row rhythm.
    MARGIN = 35
    LABEL_W = 114                     # value column begins at x = 35 + 114 = 149
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=55, bottomMargin=40,
        title="Assessment report",
    )

    base = ParagraphStyle("base", fontName="Helvetica", fontSize=12, leading=14.4,
                          textColor=colors.black)
    label_style = ParagraphStyle("lbl", parent=base, fontName="Helvetica-Bold")
    heading_style = ParagraphStyle("heading", parent=base, fontName="Helvetica-Bold",
                                   spaceBefore=22, spaceAfter=11)
    crit_style = ParagraphStyle("crit", parent=base, leftIndent=22.5, spaceAfter=2.5)
    body_style = ParagraphStyle("body", parent=base, spaceAfter=8)

    story = []

    # Branding logo, top-left, at Aptem's size.
    logo_path = os.path.join(_ASSETS, tpl["logo"])
    if os.path.exists(logo_path):
        logo = Image(logo_path, width=tpl["w"], height=tpl["h"])
        logo.hAlign = "LEFT"          # Aptem places it top-left, not centred
        story.append(logo)
        story.append(Spacer(1, 21))   # logo bottom (y≈106) → first row (y≈127)

    # Header key/value block: two columns, no borders. Per-row bottom padding
    # reproduces Aptem's rhythm — Learner/Activity/Evidence/Time spaced wider,
    # then Assessment result/Assessed by/Assessment date tight (~18.6pt pitch).
    rows = [[Paragraph(lbl, label_style),
             Paragraph(html.escape(str(_field(data, key))), base)]
            for lbl, key in _HEADER_FIELDS]
    bottom_pad = [13.6, 22.6, 13.6, 4.6, 4.6, 4.6, 0.0]   # per header row
    tbl = Table(rows, colWidths=[LABEL_W, doc.width - LABEL_W])
    ts = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
    ]
    for i, pad in enumerate(bottom_pad):
        ts.append(("BOTTOMPADDING", (0, i), (-1, i), pad))
    tbl.setStyle(TableStyle(ts))
    story.append(tbl)

    # Criteria — free text the assessor types, indented under the heading.
    story.append(Paragraph("Criteria", heading_style))
    criteria = (data.get("criteria") or "").strip()
    if criteria:
        story.extend(_comments_paragraphs(criteria, crit_style))
    else:
        story.append(Paragraph("—", crit_style))

    # Comments — at the left margin, like Aptem.
    story.append(Paragraph("Comments", heading_style))
    story.extend(_comments_paragraphs(data.get("comments"), body_style))

    doc.build(story)
    return buf.getvalue()


def _field(data, key):
    v = data.get(key)
    if key == "time_spent":
        return format_time_spent(v)
    return "" if v is None else v
