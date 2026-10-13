"""Render a saved Inclusion screening report without recalculating its findings."""

from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, KeepTogether, NextPageTemplate,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.pdfgen import canvas


PURPLE = colors.HexColor('#21164b')
INK = colors.HexColor('#21164b')
MUTED = colors.HexColor('#72658f')
LILAC = colors.HexColor('#d8c9ef')
PALE = colors.HexColor('#f7f4fb')
GREEN = colors.HexColor('#3e865f')
GREEN_PALE = colors.HexColor('#f2faf5')
AMBER = colors.HexColor('#ad8040')
AMBER_PALE = colors.HexColor('#fff9eb')
RED = colors.HexColor('#bd5055')
RED_PALE = colors.HexColor('#fff3f3')
PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = 40
CONTENT_WIDTH = PAGE_WIDTH - LEFT * 2


def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def _text(value):
    """Keep saved prose readable in ReportLab's built-in PDF font."""
    value = str(value or '')
    for source, target in {
        '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
        '\u2013': '-', '\u2014': '-', '\u2022': '-', '\u2026': '...',
    }.items():
        value = value.replace(source, target)
    return escape(value).replace('\n', '<br/>')


BODY = ParagraphStyle('InclusionBody', fontName='Helvetica', fontSize=8.5,
                      leading=12.5, textColor=INK)
SMALL = ParagraphStyle('InclusionSmall', parent=BODY, fontSize=7.2, leading=10)
TITLE = ParagraphStyle('InclusionTitle', parent=BODY, fontName='Helvetica-Bold',
                       fontSize=11.5, leading=15)
LABEL = ParagraphStyle('InclusionLabel', parent=BODY, fontName='Helvetica-Bold',
                       fontSize=7.8, leading=10)
WHITE_LABEL = ParagraphStyle('InclusionWhiteLabel', parent=LABEL,
                             textColor=colors.white)
NOTE = ParagraphStyle('InclusionNote', parent=SMALL, textColor=MUTED)
CENTER = ParagraphStyle('InclusionCenter', parent=SMALL, alignment=TA_CENTER)


def _p(value, style=BODY):
    return Paragraph(_text(value), style)


def _tone(level):
    normalized = str(level or '').strip().lower()
    if normalized in {'high', 'very high', 'red', 'critical'}:
        return RED, RED_PALE
    if normalized in {'medium', 'moderate', 'amber'}:
        return AMBER, AMBER_PALE
    return GREEN, GREEN_PALE


class ScoreBar(Flowable):
    def __init__(self, fraction, width=CONTENT_WIDTH - 28, height=7, color=GREEN):
        super().__init__()
        self.width = width
        self.height = height
        self.fraction = max(0, min(1, float(fraction or 0)))
        self.color = color

    def draw(self):
        self.canv.setFillColor(LILAC)
        self.canv.roundRect(0, 0, self.width, self.height, 3, fill=1, stroke=0)
        if self.fraction:
            self.canv.setFillColor(self.color)
            self.canv.roundRect(0, 0, self.width * self.fraction, self.height, 3,
                                fill=1, stroke=0)


def _card(contents, *, background=PALE, border=LILAC, padding=12, width=CONTENT_WIDTH):
    table = Table([[contents]], colWidths=[width], hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), background),
        ('BOX', (0, 0), (-1, -1), 0.65, border),
        ('LEFTPADDING', (0, 0), (-1, -1), padding),
        ('RIGHTPADDING', (0, 0), (-1, -1), padding),
        ('TOPPADDING', (0, 0), (-1, -1), padding),
        ('BOTTOMPADDING', (0, 0), (-1, -1), padding),
    ]))
    return table


def _bar(title):
    table = Table([[_p(title.upper(), WHITE_LABEL)]], colWidths=[CONTENT_WIDTH])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PURPLE),
        ('LEFTPADDING', (0, 0), (-1, -1), 14),
        ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    return table


def _risk_card(item, width):
    item = _dict(item)
    level = item.get('riskLevel') or 'Not recorded'
    tone, background = _tone(level)
    score = item.get('score')
    maximum = item.get('maxScore')
    score_label = f"{score if score is not None else '-'} / {maximum if maximum is not None else '-'}"
    percentage = item.get('adjustedPercentage')
    fraction = (percentage / 100) if isinstance(percentage, (int, float)) else (
        (score / maximum) if isinstance(score, (int, float)) and isinstance(maximum, (int, float)) and maximum else 0)
    contents = [
        _p(item.get('label') or 'Screening area', LABEL), Spacer(1, 5),
        _p(str(level).upper(), SMALL), Spacer(1, 15), _p(score_label, TITLE),
        Spacer(1, 7), ScoreBar(fraction, width=width - 28, color=tone),
        Spacer(1, 4), _p(f'{percentage}%' if isinstance(percentage, (int, float)) else '', SMALL),
    ]
    return _card(contents, background=background, border=tone, width=width, padding=10)


def _draw_header(canv, doc):
    canv.saveState()
    canv.setFillColor(PURPLE)
    canv.rect(0, PAGE_HEIGHT - 78, PAGE_WIDTH, 78, fill=1, stroke=0)
    logo = Path(__file__).resolve().parent / 'assets' / 'inclusion-report-logo.png'
    canv.drawImage(str(logo), LEFT, PAGE_HEIGHT - 64, 43, 47,
                   preserveAspectRatio=True, mask='auto')
    canv.setFillColor(colors.white)
    canv.setFont('Helvetica-Bold', 15)
    canv.drawString(LEFT + 47, PAGE_HEIGHT - 37, 'Learner Inclusiveness Report')
    canv.setFont('Helvetica', 8)
    canv.setFillColor(colors.HexColor('#c3b5dd'))
    canv.drawString(LEFT + 47, PAGE_HEIGHT - 56,
                    'Kent Business College - Confidential Assessment')
    canv.drawRightString(PAGE_WIDTH - LEFT, PAGE_HEIGHT - 56,
                         f'Generated: {doc.generated_label}')
    canv.restoreState()


class _NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._pages = []

    def showPage(self):
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        count = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self.setFillColor(PURPLE)
            self.rect(0, 0, PAGE_WIDTH, 26, fill=1, stroke=0)
            self.setFillColor(colors.white)
            self.setFont('Helvetica', 7)
            self.drawString(LEFT, 10,
                            'Kent Business College - Learner Inclusiveness Report - Confidential')
            self.drawRightString(PAGE_WIDTH - LEFT, 10,
                                 f'Page {self._pageNumber} of {count}')
            super().showPage()
        super().save()


def build_inclusion_report_pdf(master_report, *, fallback_name='', fallback_email='',
                               fallback_programme='', fallback_organisation='',
                               fallback_date=None):
    """Return a PDF using only the saved screening assessment and identity fields."""
    report = _dict(master_report)
    if not report:
        raise ValueError('Saved Inclusion report is empty.')
    header = _dict(report.get('reportHeader'))
    learner = _dict(report.get('learner'))
    overview = _dict(report.get('overview'))
    name = header.get('learnerName') or learner.get('name') or fallback_name
    email = header.get('learnerEmail') or learner.get('email') or fallback_email
    programme = header.get('programme') or learner.get('programme') or fallback_programme
    organisation = header.get('organisation') or learner.get('organisation') or fallback_organisation
    generated = header.get('generatedAt') or fallback_date
    generated_label = str(generated or '')[:10] or 'Date not recorded'
    risk = header.get('overallRiskLevel') or overview.get('overallRiskLevel') or 'Not recorded'
    tone, background = _tone(risk)

    buffer = BytesIO()
    doc = BaseDocTemplate(buffer, pagesize=A4, leftMargin=LEFT, rightMargin=LEFT,
                          topMargin=0, bottomMargin=0, title='Learner Inclusiveness Report',
                          author='Kent Business College')
    doc.generated_label = generated_label
    first = Frame(LEFT, 40, CONTENT_WIDTH, PAGE_HEIGHT - 140,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    later = Frame(LEFT, 40, CONTENT_WIDTH, PAGE_HEIGHT - 82,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id='first', frames=[first], onPage=_draw_header),
        PageTemplate(id='later', frames=[later]),
    ])
    story = [NextPageTemplate('later')]

    identity = [
        _p(name or 'Learner', TITLE), Spacer(1, 7),
        _p(f'Email: {email or "Not recorded"}', SMALL), Spacer(1, 4),
        _p(f'Programme: {programme or "Not recorded"}', SMALL), Spacer(1, 4),
        _p(f'Organisation: {organisation or "Not recorded"}', SMALL),
        Spacer(1, 7), _p(f'Generated: {generated_label} | Risk: {str(risk).upper()}', LABEL),
    ]
    story += [_card(identity, background=background), Spacer(1, 15)]

    score = overview.get('overallScore')
    maximum = overview.get('overallMaxScore')
    percentage = overview.get('rawPercentage')
    fraction = (percentage / 100) if isinstance(percentage, (int, float)) else (
        (score / maximum) if isinstance(score, (int, float)) and isinstance(maximum, (int, float)) and maximum else 0)
    story += [_card([
        _p(f'OVERALL SCORE  |  {percentage}% of total score' if isinstance(percentage, (int, float)) else 'OVERALL SCORE', LABEL), Spacer(1, 8),
        _p(f'{score if score is not None else "-"} / {maximum if maximum is not None else "-"}', TITLE),
        Spacer(1, 8), ScoreBar(fraction),
    ]), Spacer(1, 15)]

    roadmap = _list(report.get('riskRoadmap'))
    if roadmap:
        story += [_bar('Risk roadmap - inclusiveness screening areas'), Spacer(1, 8)]
        column_width = (CONTENT_WIDTH - 10) / 2
        rows = []
        for index in range(0, len(roadmap), 2):
            rows.append([_risk_card(roadmap[index], column_width),
                         _risk_card(roadmap[index + 1], column_width)
                         if index + 1 < len(roadmap) else ''])
        grid = Table(rows, colWidths=[column_width + 5] * 2, hAlign='LEFT')
        grid.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story += [grid, Spacer(1, 13)]

    if report.get('executiveSummary'):
        story += [_bar('Executive summary'), Spacer(1, 9),
                  _card(_p(report['executiveSummary'])), Spacer(1, 15)]

    findings = _list(report.get('keyFindings'))
    if findings:
        story += [_bar('Key findings & recommended responses'), Spacer(1, 9)]
        for item in findings:
            item = _dict(item)
            finding_tone, finding_background = _tone(item.get('riskLevel'))
            block = [
                _p(item.get('area') or 'Finding', LABEL), Spacer(1, 7),
                _p(item.get('finding'), SMALL), Spacer(1, 8),
                _p(f'Recommended response: {item.get("recommendedResponse") or "Not recorded"}', NOTE),
            ]
            story += [KeepTogether([_card(block, background=finding_background,
                                         border=finding_tone), Spacer(1, 10)])]

    support = _dict(report.get('supportPlan'))
    support_labels = (
        ('digitalSupport', 'Digital support'), ('learningSupport', 'Learning support'),
        ('wellbeingSupport', 'Wellbeing support'), ('assignmentSupport', 'Assignment support'),
        ('communicationSupport', 'Communication support'),
        ('accessibilityAdjustments', 'Accessibility adjustments'),
    )
    if support:
        story += [_bar('Support plan'), Spacer(1, 9)]
        for key, label in support_labels:
            entries = _list(support.get(key))
            if not entries:
                continue
            block = [_p(label.upper(), LABEL), Spacer(1, 7)]
            block.extend(_p(f'- {entry}', SMALL) for entry in entries)
            story += [KeepTogether([_card(block), Spacer(1, 9)])]

    actions = [_dict(item) for item in _list(report.get('priorityActions'))]
    if actions:
        story += [_bar('Priority actions'), Spacer(1, 9)]
        table_rows = [[_p('Priority', LABEL), _p('Owner', LABEL),
                       _p('Action', LABEL), _p('Due date', LABEL)]]
        table_rows.extend([
            _p(item.get('priority'), SMALL), _p(item.get('owner'), SMALL),
            _p(item.get('action'), SMALL), _p(item.get('due'), SMALL),
        ] for item in actions)
        table = Table(table_rows, colWidths=[65, 70, CONTENT_WIDTH - 215, 80],
                      repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), PALE),
            ('GRID', (0, 0), (-1, -1), 0.45, LILAC),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 7),
            ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ]))
        story += [table, Spacer(1, 14)]

    timeline = _dict(report.get('reviewTimeline'))
    if timeline:
        story += [_bar('Review timeline'), Spacer(1, 9)]
        timeline_cells = []
        for key, label in (('initialReview', 'Initial review'),
                           ('followUpReview', 'Follow-up review'),
                           ('nextFormalReview', 'Next formal review')):
            timeline_cells.append(_card([_p(label.upper(), LABEL), Spacer(1, 7),
                                         _p(timeline.get(key) or 'Not recorded', SMALL)],
                                        width=(CONTENT_WIDTH - 12) / 3, padding=9))
        timeline_table = Table([timeline_cells], colWidths=[CONTENT_WIDTH / 3] * 3)
        timeline_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ]))
        story += [timeline_table, Spacer(1, 14)]

    brief = _dict(report.get('managerBrief'))
    if brief:
        story += [_bar('Manager brief'), Spacer(1, 9)]
        if brief.get('oneLineStatus'):
            story += [_card(_p(brief['oneLineStatus'], LABEL),
                            background=background, border=tone), Spacer(1, 9)]
        for key, label in (('whatNeedsAttention', 'What needs attention'),
                           ('whatIsAlreadyInPlace', 'What is already in place')):
            entries = _list(brief.get(key))
            if entries:
                story += [KeepTogether([_card([_p(label, LABEL), Spacer(1, 7),
                                              *[_p(f'- {entry}', SMALL) for entry in entries]]),
                                       Spacer(1, 9)])]
        if brief.get('recommendedNextStep'):
            story += [_card([_p('Recommended next step', LABEL), Spacer(1, 7),
                             _p(brief['recommendedNextStep'], SMALL)],
                            background=GREEN_PALE, border=GREEN), Spacer(1, 12)]

    if report.get('professionalNote'):
        story += [_p(report['professionalNote'], NOTE)]
    doc.build(story, canvasmaker=_NumberedCanvas)
    return buffer.getvalue()
