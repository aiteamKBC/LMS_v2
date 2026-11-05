"""Private, on-demand PDFs from verified saved evidence. No network or AI calls.

Presentation follows Coaching Session's printReport.ts: branded session details,
saved evidence, AI quality report/metrics and transcript evidence. Values are
rendered as saved; no booking, sign-off or attendance outcome is inferred.
"""
from hashlib import sha256
from html import escape, unescape
from io import BytesIO
import json
from pathlib import Path
import re
from threading import Lock

from reportlab import __file__ as reportlab_file
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image

from .recordings_cache import recent_read
from .recordings_media import session_window

PURPLE = colors.HexColor('#7C3AED')
INK = colors.HexColor('#1F2937')
MUTED = colors.HexColor('#64748B')
LINE = colors.HexColor('#E5E7EB')
SOFT = colors.HexColor('#F5F3FF')
WIDTH = A4[0] - 30 * mm
_font_lock = Lock()


def _fonts():
    with _font_lock:
        if 'CoachingPDF' not in pdfmetrics.getRegisteredFontNames():
            folder = Path(reportlab_file).parent / 'fonts'
            pdfmetrics.registerFont(TTFont('CoachingPDF', str(folder / 'Vera.ttf')))
            pdfmetrics.registerFont(TTFont('CoachingPDF-Bold', str(folder / 'VeraBd.ttf')))
            pdfmetrics.registerFontFamily('CoachingPDF', normal='CoachingPDF', bold='CoachingPDF-Bold',
                                          italic='CoachingPDF', boldItalic='CoachingPDF-Bold')


def _value(value):
    if value is None or value == '':
        return 'Not recorded'
    if isinstance(value, dict):
        return next((_value(value[key]) for key in ('text', 'summary', 'name', 'result', 'status', 'description')
                     if value.get(key) not in (None, '')), json.dumps(value, ensure_ascii=False))
    return str(value).replace('\x00', '').replace('\r', '').replace('\u2011', '-')


def _p(value, *, size=8.5, bold=False, color=INK, space=5):
    style = ParagraphStyle('coaching', fontName='CoachingPDF-Bold' if bold else 'CoachingPDF',
        fontSize=size, leading=size * 1.5, textColor=color, spaceAfter=space, splitLongWords=True)
    return Paragraph(escape(_value(value)).replace('\n', '<br/>'), style)


def _heading(value):
    return _p(value.upper(), size=8, bold=True, color=MUTED, space=8)


def _card(title, content, *, background='#FBFDFF', accent=None):
    body = [_heading(title), *content]
    card = Table([[body]], colWidths=[(WIDTH - 12) / 2], splitInRow=1)
    commands = [('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(background)),
                ('BOX', (0, 0), (-1, -1), .5, LINE),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]
    if accent:
        commands.append(('LINEABOVE', (0, 0), (-1, 0), 2, accent))
    card.setStyle(TableStyle(commands))
    return card


def _columns(left, right):
    table = Table([[left, '', right]], colWidths=[(WIDTH - 12) / 2, 12, (WIDTH - 12) / 2], splitInRow=0)
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    if table.wrap(WIDTH, A4[1])[1] > A4[1] - 34 * mm:
        table.splitInRow = 1
    return table


def _details(title, values):
    rows = [[_p(label, size=6.8, bold=True, color=MUTED, space=0), _p(value, size=7.5, space=0)]
            for label, value in values]
    table = Table(rows, colWidths=[40 * mm, (WIDTH - 12) / 2 - 40 * mm], splitInRow=1)
    table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, -1), .4, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 3), ('RIGHTPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    return [_heading(title), table]


def transcript_turns(raw):
    """Retain every turn, including plain-text transcripts and cue times."""
    turns = []
    for block in re.split(r'\n\s*\n', str(raw).replace('\r', '')):
        block = block.strip()
        if not block or block.startswith(('WEBVTT', 'NOTE ', 'STYLE\n')):
            continue
        stamp = re.search(r'((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3})[^\n]*\n', block)
        timing = f'{stamp[1]} - {stamp[2]}' if stamp else ''
        body = block[stamp.end():] if stamp else block
        voices = list(re.finditer(r'<v\s+([^>]+)>(.*?)(?:</v>|(?=<v\s+)|$)', body, re.DOTALL))
        parts = [(match[1], match[2]) for match in voices] or [('', body)]
        for speaker, text in parts:
            text = unescape(re.sub(r'</?(?:c|v|b|i|u|lang)(?:[ .][^>]*)?>', '', text)).strip()
            if text:
                turns.append((unescape(speaker), timing, text))
    return turns


def _transcript_blocks(turns):
    result = []
    for index, (speaker, timing, text) in enumerate(turns):
        body = [_p(' | '.join(part for part in (speaker, timing) if part), bold=True, color=PURPLE, size=7)] if speaker or timing else []
        body.append(_p(text, size=8.2))
        box = Table([[body]], colWidths=[WIDTH], splitInRow=0)
        box.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), SOFT if index % 2 else colors.HexColor('#F8FAFC')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
        if box.wrap(WIDTH, A4[1])[1] > A4[1] - 34 * mm:
            box.splitInRow = 1
        result.extend([box, Spacer(1, 5)])
    return result


def _report(raw):
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, dict) or not raw:
        raise ValueError('A saved AI report is required.')
    return raw


def _list(value):
    return value if isinstance(value, list) else [value] if value not in (None, '') else []


def _bullets(value):
    return [_p('- ' + _value(item)) for item in _list(value)] or [_p('None recorded.', color=MUTED)]


def _rag(value):
    return {'green': '#059669', 'amber': '#D97706', 'red': '#DC2626'}.get(str(value).lower(), '#64748B')


def _ai_sections(report):
    overall = report.get('overall_rating') or {}
    overall = overall if isinstance(overall, dict) else {}
    rag = report.get('rag_rating') or overall.get('rag')
    score = report.get('qa_score')
    average = overall.get('average_rating')
    if score is None and isinstance(average, (int, float)) and not isinstance(average, bool):
        score = round(average * 20, 1) if 0 <= average <= 5 else average
    scores = [_card('RAG rating', [_p(rag, bold=True, size=16, color=colors.HexColor(_rag(rag)))])] if rag else []
    if score is not None:
        scores.append(_card('QA score', [_p(f'{score} / 100', size=15, bold=True)]))
    if report.get('safeguarding_score') is not None:
        scores.append(_card('Safeguarding', [_p(f"{report['safeguarding_score']} / 100", size=15, bold=True)]))
    sections = [_heading('AI Quality Report')]
    for index in range(0, len(scores), 2):
        sections.extend([_columns(scores[index], scores[index + 1] if index + 1 < len(scores) else []), Spacer(1, 10)])
    judgement = overall.get('professional_judgement') or overall.get('qualitative')
    summary = report.get('executive_summary') or report.get('summary')
    if judgement or summary:
        sections.extend([_columns(_card('Professional Judgement', [_p(judgement)]),
                                  _card('Executive Summary', [_p(summary)])), Spacer(1, 10)])
    boxes = []
    for key, title, accent in [('strengths', 'Strengths', '#059669'), ('concerns', 'Concerns', '#DC2626'),
                               ('recommendations', 'Recommendations', '#D97706')]:
        if report.get(key):
            boxes.append(_card(title, _bullets(report[key]), accent=colors.HexColor(accent)))
    actions = report.get('priority_actions') or report.get('actions')
    if actions:
        body = []
        for item in _list(actions):
            if isinstance(item, dict):
                body.extend([_p(item.get('owner') or 'Owner not recorded', bold=True, size=7, color=PURPLE),
                             _p(item.get('action') or item.get('text') or item)])
                if item.get('due'):
                    body.append(_p(f"Due: {item['due']}", size=7, color=MUTED))
            else:
                body.append(_p(item))
        boxes.insert(1, _card('Actions', body, accent=PURPLE))
    for index in range(0, len(boxes), 2):
        sections.extend([_columns(boxes[index], boxes[index + 1] if index + 1 < len(boxes) else []), Spacer(1, 10)])
    metrics = report.get('qa') or []
    if metrics:
        sections.append(_heading('QA Metrics'))
        cards = []
        for item in _list(metrics):
            if not isinstance(item, dict):
                cards.append(_card('QA metric', [_p(item)]))
                continue
            content = []
            status = ' | '.join(str(item[key]) for key in ('rag', 'rating_1_to_5') if item.get(key) is not None)
            if status:
                content.append(_p(status, bold=True, color=colors.HexColor(_rag(item.get('rag'))), size=7))
            for key in ('result', 'notes'):
                if item.get(key) is not None:
                    content.append(_p(item[key]))
            for quote in _list(item.get('evidence')):
                if isinstance(quote, dict):
                    if quote.get('quote'):
                        content.append(_p('"' + _value(quote['quote']) + '"', size=7.5, color=MUTED))
                    for key in ('speaker', 'timecode', 'why_it_matters'):
                        if quote.get(key):
                            content.append(_p(quote[key], size=7, color=MUTED))
                else:
                    content.append(_p(quote, size=7.5, color=MUTED))
            cards.append(_card(item.get('metric') or 'QA metric', content))
        for index in range(0, len(cards), 2):
            sections.extend([_columns(cards[index], cards[index + 1] if index + 1 < len(cards) else []), Spacer(1, 9)])
    for key, title in [('checklist', 'Saved checklist'), ('ksb_evidence', 'KSB Evidence'),
                       ('learner_feedback', 'Learner Feedback'), ('manager_involvement', 'Manager Involvement')]:
        if report.get(key):
            sections.extend([_heading(title), *_bullets(report[key]), Spacer(1, 8)])
    return sections


def _render(record, evidence, analysis, kind):
    _fonts()
    saved = (analysis or {}).get('session') or {}
    report = _report(analysis['report']) if kind == 'analysis' else {}
    context = {**{key: report.get(key) for key in ('learner', 'coach', 'programme')}, **saved}
    name = context.get('learner_name') or (analysis or {}).get('learnerName') or context.get('learner') or 'Meeting'
    title = 'Coach Workspace Report' if kind == 'analysis' else 'Full Transcript'
    stream = BytesIO()
    doc = SimpleDocTemplate(stream, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=14 * mm, bottomMargin=16 * mm, title=f'{title} - {name}', author='Kent Business College')
    logo = Path(__file__).resolve().parents[2] / 'frontend' / 'public' / 'assets' / 'kbc-logo.png'
    heading = _p(title, size=11, bold=True)
    heading.style.alignment = TA_RIGHT
    brand = Table([[Image(str(logo), width=48 * mm, height=23 * mm, kind='proportional'), heading]], colWidths=[WIDTH / 2] * 2)
    brand.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LINEBELOW', (0, 0), (-1, -1), 1.5, PURPLE),
                              ('BOTTOMPADDING', (0, 0), (-1, -1), 10)]))
    begin, end = session_window(record)
    hero = [_p(name, size=17, bold=True), _p(context.get('program_name') or context.get('programme'), size=9),
            _p(saved.get('component_name') or saved.get('meeting_subject') or (analysis or {}).get('type') or 'Meeting transcript', size=9),
            _p(f"Coach: {context.get('case_owner') or context.get('coach') or record.owner_email}", size=8),
            _p(f"Occurrence (UTC): {begin.isoformat()} - {end.isoformat()}", size=7, color=MUTED)]
    panel = Table([[hero]], colWidths=[WIDTH], splitInRow=1)
    panel.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), SOFT), ('BOX', (0, 0), (-1, -1), .5, colors.HexColor('#DDD6FE')),
        ('LEFTPADDING', (0, 0), (-1, -1), 13), ('RIGHTPADDING', (0, 0), (-1, -1), 13),
        ('TOPPADDING', (0, 0), (-1, -1), 12), ('BOTTOMPADDING', (0, 0), (-1, -1), 8)]))
    story = [brand, Spacer(1, 14), panel, Spacer(1, 16)]
    raw = (evidence.get('transcript') or {}).get('content') or ''
    turns = transcript_turns(raw)
    if kind == 'analysis':
        story.extend([_columns(_details('Learner & Programme', [(label, saved.get(key)) for label, key in (
            ('Learner', 'learner_name'), ('Email', 'learner_email'), ('Status', 'learner_status'),
            ('Programme', 'program_name'), ('Component', 'component_name'))]),
            _details('Coach & Manager', [(label, saved.get(key)) for label, key in (
            ('Coach', 'case_owner'), ('Manager', 'manager_name'), ('Manager email', 'manager_email'))])), Spacer(1, 16),
            _columns(_details('Session Details', [(label, saved.get(key)) for label, key in (
            ('Type', 'source'), ('Session stage', 'tab'), ('Planned date', 'planned_date'), ('Aptem status', 'aptem_status'))]),
            _details('Meeting & Evidence', [(label, saved.get(key)) for label, key in (
            ('Meeting ID', 'meeting_id'), ('Subject', 'meeting_subject'), ('Start time', 'meeting_start_time'), ('Days from planned', 'days_from_planned'))])), Spacer(1, 16),
            _heading('Attendance & Evidence (saved Coaching Session values)')])
        for key, label in [('learner_attended', 'Learner attendance'), ('manager_attended', 'Manager attendance')]:
            value = saved.get(key)
            story.append(_p(f"{label}: {'Yes' if value is True else 'No' if value is False else 'Unknown'}", size=8))
        story.extend([_p('Transcript: ' + ('Available' if raw else 'Not available'), size=8), PageBreak(), *_ai_sections(report)])
        if turns:
            story.extend([PageBreak(), _heading('Transcript Evidence'),
                _p(f'{len(turns)} turns. Opening excerpt below; the Transcript PDF contains every turn.', size=8),
                *_transcript_blocks(turns[:4])])
    else:
        if not turns:
            raise ValueError('A verified transcript is required.')
        story.extend([_heading('Session Transcript'),
            _p(f'{len(turns)} turns | {sum(len(text.split()) for _, _, text in turns)} words', color=MUTED, size=8),
            *_transcript_blocks(turns)])
    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont('CoachingPDF', 6.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(15 * mm, 9 * mm, 'Kent Business College | Coaching Session | Confidential')
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f'Page {document.page}')
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()


def evidence_pdf(record, evidence, *, kind, analysis=None):
    """Call only after current authorization and same-occurrence source selection."""
    if kind == 'transcript' and len(evidence.get('analyses') or []) == 1:
        analysis = evidence['analyses'][0]
    payload = [record.owner_email, record.graph_event_id, session_window(record), kind,
               analysis, evidence.get('transcript')]
    digest = sha256(json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()
    return recent_read('evidence-pdf-v1', digest, lambda: _render(record, evidence, analysis, kind), timeout=600)
