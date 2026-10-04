"""Render saved progress in the existing migrated PDF layout; no calculation."""
from html import escape

from curriculum_api.review_pdf import display_date, percent_text, variance_text


def progress_section(snapshot, styles):
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    def paragraph(value):
        return Paragraph(escape(str(value)), styles["Normal"])

    story = [Spacer(1, 10), Paragraph("Learning Progress", styles["Heading2"])]
    if not snapshot:
        return story + [paragraph("No progress snapshot was calculated for this review.")]
    story.append(paragraph(
        f"Calculated from {display_date(snapshot.get('calculatedFrom'))} · "
        f"Calculated at {display_date(snapshot.get('calculatedAt'), include_time=True)}"
    ))
    programme = snapshot.get("programmeProgress") or {}
    story.extend([Spacer(1, 7), paragraph(
        f"Learning Plan Progress: {percent_text(programme.get('actualPercent'))}"
    )])
    rows = [[paragraph(label) for label in ("Progress", "Actual", "Expected", "Variance")]]
    ksb = snapshot.get("ksbProgress") or {}
    metrics = []
    if ksb.get("available"):
        metrics.append((ksb.get("title") or "KSB progress", ksb))
    else:
        story.append(paragraph(ksb.get("reason") or "KSB progress was not available in this snapshot."))
    metrics.extend([
        ("Off-the-job hours progress", snapshot.get("offTheJobHours") or {}),
        ("Programme progress", programme),
    ])
    for label, metric in metrics:
        rows.append([paragraph(value) for value in (
            label, percent_text(metric.get("actualPercent")),
            percent_text(metric.get("expectedPercent")),
            variance_text(metric) or "Target unavailable",
        )])
    table = Table(rows, colWidths=[170, 55, 60, 165], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eee9ff")),
        ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#c9c3dc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return story + [Spacer(1, 7), table, Spacer(1, 10)]
