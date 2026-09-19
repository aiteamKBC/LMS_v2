"""A signed MCM export, using the supplied Aptem PDF as the layout reference.

The saved instance supplies the questions, answers and original signatures.
Source PDFs and their learners' answers/signatures are never used as content.
"""
import base64
import binascii
import re
from datetime import datetime, timezone
from html import escape
from io import BytesIO
from pathlib import Path
from zoneinfo import ZoneInfo


SIGNATURE_ROLES = ('advisor', 'employer', 'participant', 'referrer')
ROLE_LABELS = {'advisor': 'Advisor', 'employer': 'Employer', 'participant': 'Participant', 'referrer': 'Referrer'}
IMAGE_PATTERN = re.compile(r'^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$', re.I)

REVIEW_TYPE_MCM = 'mcm'
REVIEW_TYPE_PROGRESS_REVIEW = 'progress_review'
#: Review Types with a signed export, by the Review Type's stable code -- never
#: by a template's name. Anything else has no PDF at all (404), exactly as
#: before this Progress Review entry was added.
EXPORTABLE_REVIEW_TYPES = {
    REVIEW_TYPE_MCM: 'Monthly-Coaching-Meeting',
    REVIEW_TYPE_PROGRESS_REVIEW: 'Progress-Review',
}


def review_type_code(definition):
    return definition.get('template', {}).get('reviewTypeCode')


def pdf_availability(definition):
    if review_type_code(definition) not in EXPORTABLE_REVIEW_TYPES:
        return None
    signatures = definition.get('signatures', {})
    required = {role for role in SIGNATURE_ROLES if signatures.get(role, {}).get('required')}
    # A learner acknowledgement is always needed for this signed MCM export,
    # including old templates that did not request one when they were authored.
    required.add('participant')
    if (definition.get('instance') or {}).get('status') != 'completed' or any(
        not signatures.get(role, {}).get('signed') for role in required
    ):
        return {'available': False, 'reason': 'The PDF is available after the learner and all required parties have signed.'}
    for role in required:
        state = signatures[role]
        if not state.get('signedName') or not state.get('signedAt') or not IMAGE_PATTERN.fullmatch(state.get('signature') or ''):
            return {'available': False, 'reason': 'A saved signature image, name or date is missing. The signed PDF cannot be generated.'}
    return {'available': True, 'reason': ''}


def learner_information(source, *, name='', programme=''):
    return {
        'name': getattr(source, 'username', '') or name,
        'programme': getattr(source, 'programme', '') or programme,
        'startDate': getattr(source, 'start_date', None),
        'endDate': getattr(source, 'end_date', None),
        # The learner's OWN programme dates, as distinct from the two above --
        # "Created_users"."Start_date"/"End_date" carry the cohort delivery
        # window (active_users.mirror_learner_placement stamps the profile
        # mirror with it), which is shared by everyone placed in that cohort.
        # Carried separately rather than substituted, so the existing MCM
        # export keeps reading exactly the dates it always has.
        'learnerStartDate': getattr(source, 'learner_start_date', None),
        'learnerEndDate': getattr(source, 'learner_end_date', None),
        'employer': getattr(source, 'employer', ''),
        'manager': getattr(source, 'line_manager', ''),
    }


def programme_dates(definition, information):
    """(start, end) for the Information block.

    A Progress Review states the individual learner's own programme start date
    -- the same date its progress snapshot was calculated from -- so the two
    can never disagree inside one document. Everything else keeps the enrolment
    window it already showed.
    """
    if review_type_code(definition) != REVIEW_TYPE_PROGRESS_REVIEW:
        return information.get('startDate'), information.get('endDate')
    snapshot = definition.get('progressSnapshot') or {}
    start = snapshot.get('calculatedFrom') or information.get('learnerStartDate') or information.get('startDate')
    return start, information.get('learnerEndDate') or information.get('endDate')


def percent_text(value):
    return 'Not recorded' if value is None else f'{round(float(value))}%'


def variance_text(metric):
    """"23% above expected (57%)" -- the reference's above/below annotation,
    read from the stored snapshot rather than recomputed."""
    variance, direction = metric.get('variancePercent'), metric.get('varianceDirection')
    if variance is None or not direction:
        return ''
    expected = metric.get('expectedPercent')
    suffix = '' if expected is None else f' (expected {percent_text(expected)})'
    return f'{abs(round(float(variance)))}% {direction} expected{suffix}'


def display_date(value, *, include_time=False):
    if not value:
        return 'Not recorded'
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if include_time:
            parsed = parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
            return parsed.astimezone(ZoneInfo('Europe/London')).strftime('%d/%m/%Y %H:%M') + ' (Europe/London)'
        return parsed.strftime('%d/%m/%Y')
    except ValueError:
        return str(value)


def answer_text(value):
    if value is None or value == '' or value == []:
        return 'Not recorded'
    if isinstance(value, bool):
        return 'Yes' if value else 'No'
    if isinstance(value, list):
        return '; '.join(answer_text(item) for item in value)
    if isinstance(value, dict):
        return '\n'.join(f'{key}: {answer_text(item)}' for key, item in value.items())
    return str(value)


def visible_fields(fields):
    for field in fields or []:
        yield field
        if field.get('fieldType') == 'boolean_case_block':
            answer = field.get('answer')
            branch = 'yesFields' if answer in ('yes', True) else 'noFields' if answer in ('no', False) else None
            if branch:
                yield from visible_fields(field.get(branch))


def _signature_image(state):
    from PIL import Image as PillowImage
    from reportlab.platypus import Image

    match = IMAGE_PATTERN.fullmatch(state.get('signature') or '')
    if not match or len(match[2]) > 2_000_000:
        raise ValueError('The saved signature image cannot be included in the PDF.')
    try:
        content = base64.b64decode(match[2], validate=True)
        with PillowImage.open(BytesIO(content)) as im:
            if im.width * im.height > 8_000_000:
                raise ValueError('The saved signature image is too large.')
            im.load()
            output = BytesIO()
            im.convert('RGBA').save(output, format='PNG')
            width, height = im.size
        output.seek(0)
        scale = min(180 / width, 58 / height)
        return Image(output, width=width * scale, height=height * scale, hAlign='LEFT')
    except (OSError, ValueError, binascii.Error) as exc:
        raise ValueError('The saved signature image cannot be included in the PDF.') from exc


def build_mcm_pdf(definition, information):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, PageBreak

    availability = pdf_availability(definition)
    if not availability or not availability['available']:
        raise ValueError((availability or {}).get('reason') or 'A signed review is required.')
    output = BytesIO()
    page_width, page_height = landscape(A4)
    margin = 56
    width = page_width - 2 * margin
    navy, panel = colors.HexColor('#204d66'), colors.HexColor('#f1f3f7')
    body = ParagraphStyle('ReviewBody', fontName='Helvetica', fontSize=9, leading=11, textColor=navy, splitLongWords=True)
    bold = ParagraphStyle('ReviewLabel', parent=body, fontName='Helvetica-Bold')

    def paragraph(value, strong=False):
        return Paragraph(escape(str(value or '')).replace('\n', '<br/>'), bold if strong else body)

    def section(title, rows, *, repeat_header=True):
        table = Table([[paragraph(title, True)], *[[row] for row in rows]], colWidths=[width],
                      repeatRows=1 if repeat_header else 0, splitByRow=1, splitInRow=1)
        table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), .55, navy), ('INNERGRID', (0, 0), (-1, -1), .35, navy),
            ('BACKGROUND', (0, 0), (-1, 0), panel), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('TOPPADDING', (0, 0), (-1, 0), 6), ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
        ]))
        return table

    instance = definition['instance']
    title = definition['template']['name']
    story = [paragraph(title, True), Spacer(1, 12)]
    start_date, end_date = programme_dates(definition, information)
    info_rows = [
        ('Programme Name', information.get('programme')),
        ('Programme Start Date', display_date(start_date)),
        ('Planned End Date', display_date(end_date)),
        ('Employer', information.get('employer')), ('Manager', information.get('manager')),
        ('Review Planned Date', display_date(instance.get('targetDate'))),
        ('Review Completed Date', display_date(instance.get('completedAt'))),
    ]
    info = Table([[paragraph(information.get('name') or 'Not recorded', True),
                   Paragraph('<br/>'.join(f'<b>{escape(label)}:</b> {escape(str(value or "Not recorded"))}' for label, value in info_rows), body)]],
                 colWidths=[150, width - 164])
    info.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                             ('LINEAFTER', (0, 0), (0, -1), .4, navy),
                             ('LEFTPADDING', (1, 0), (1, -1), 10)]))
    story.extend([section('Information', [info]), Spacer(1, 16)])

    def progress_bar(metric):
        """The reference's track + fill + target marker, drawn from the stored
        snapshot. Never recalculated here -- this renders numbers, it does not
        produce them."""
        from reportlab.graphics.shapes import Drawing, Line, Rect

        bar_width = width - 40
        drawing = Drawing(bar_width, 16)
        drawing.add(Rect(0, 3, bar_width, 10, fillColor=colors.HexColor('#d5d9e2'), strokeColor=None))
        actual = metric.get('actualPercent')
        if actual is not None:
            filled = max(0.0, min(float(actual), 100.0)) / 100 * bar_width
            if filled > 0:
                drawing.add(Rect(0, 3, filled, 10, fillColor=colors.HexColor('#1f7a8c'), strokeColor=None))
        expected = metric.get('expectedPercent')
        if expected is not None:
            marker = max(0.0, min(float(expected), 100.0)) / 100 * bar_width
            drawing.add(Line(marker, 0, marker, 16, strokeColor=navy, strokeWidth=1.4))
        return drawing

    def progress_rows(snapshot):
        rows = [Paragraph(
            '<b>Calculated from:</b> {} &nbsp;&nbsp; <b>Calculated at:</b> {}'.format(
                escape(display_date(snapshot.get('calculatedFrom'))),
                escape(display_date(snapshot.get('calculatedAt'), include_time=True)),
            ), body)]
        for key, label in (('programmeProgress', 'Programme progress'),
                           ('offTheJobHours', 'Off-the-job hours progress')):
            metric = snapshot.get(key) or {}
            caption = variance_text(metric)
            rows.append([
                Paragraph(f'<b>{escape(label)}</b> &nbsp; {escape(percent_text(metric.get("actualPercent")))}', body),
                Spacer(1, 3),
                progress_bar(metric),
                Paragraph(escape(caption), body) if caption else Spacer(1, 1),
            ])
        return rows

    if review_type_code(definition) == REVIEW_TYPE_PROGRESS_REVIEW:
        # Exactly what was frozen when the coach pressed Calculate. An
        # instance that was never calculated says so, rather than this export
        # quietly reaching for the learner's current figures.
        snapshot = definition.get('progressSnapshot')
        story.extend([
            section('Learning Progress', progress_rows(snapshot) if snapshot
                    else [paragraph('No progress snapshot was calculated for this review.')]),
            Spacer(1, 16),
        ])

    for block in sorted(definition.get('sections', []), key=lambda item: item.get('displayOrder', 0)):
        if not block.get('enabled', True):
            continue
        rows = []
        for field in visible_fields(block.get('fields')):
            if field.get('fieldType') == 'action_button':
                continue
            kind = field.get('fieldType')
            if kind in ('boolean', 'boolean_case_block', 'numeric', 'date', 'list_item', 'email', 'phone'):
                answer = display_date(field.get('answer')) if kind == 'date' else answer_text(field.get('answer'))
                rows.append(Paragraph(f'<b>{escape(str(field.get("title") or ""))}</b> {escape(answer)}', body))
                continue
            row = [paragraph(field.get('title'), True)]
            description = (field.get('configuration') or {}).get('description')
            if description:
                row.append(paragraph(description))
            if field.get('fieldType') != 'title_description':
                row.extend([Spacer(1, 3), paragraph(answer_text(field.get('answer')))])
            rows.append(row)
        if rows:
            story.extend([section(block.get('title', ''), rows), Spacer(1, 16)])

    if review_type_code(definition) == REVIEW_TYPE_PROGRESS_REVIEW:
        # One row per completed Progress Review this learner has had, each
        # showing the RAG that review itself recorded -- a review that captured
        # none reads "None", the way the legacy export shows it. Never the
        # learner's current coach_rag, which would rewrite signed history.
        history = definition.get('ragHistory') or []
        story.extend([
            section('RAG Status', [
                Paragraph(
                    '<b>{}{}</b><br/>{}'.format(
                        escape(str(entry.get('reviewName') or 'Progress Review')),
                        f" - {escape(display_date(entry.get('targetDate')))}" if entry.get('targetDate') else '',
                        escape(str(entry.get('rag') or 'None')),
                    ), body)
                for entry in history
            ] if history else [paragraph('No completed Progress Reviews recorded.')]),
            Spacer(1, 16),
        ])
    else:
        # A presentation-only placeholder, matching the legacy reference PDF's
        # structure -- the Review Instance owns no meeting-summary field today,
        # so this always shows "No Summary Generated". If one is added later,
        # this reads it instead, without any dependency on the separate
        # coach_meeting_summaries/CoachCalendarEvent AI-summary feature.
        summary = definition.get('meetingSummary')
        summary_text = summary.strip() if isinstance(summary, str) and summary.strip() else 'No Summary Generated'
        story.extend([section('Meeting Summary', [paragraph(summary_text)]), Spacer(1, 16)])

    # A dedicated final page follows the PR reference, using the actual saved
    # mark. Never substitute a typed name or another document's signature.
    story.append(PageBreak())
    for role in SIGNATURE_ROLES:
        state = definition['signatures'].get(role, {})
        if not (state.get('required') or role == 'participant' or state.get('signed')):
            continue
        image = _signature_image(state)
        content = [paragraph(f"Name: {state['signedName']}"), Spacer(1, 6), paragraph('Signature:', True),
                   image, Spacer(1, 6), paragraph(f"Date: {display_date(state['signedAt'], include_time=True)}")]
        story.extend([section(ROLE_LABELS[role], [content]), Spacer(1, 12)])

    logo = Path(__file__).parent / 'templates' / 'kbc-logo.png'

    def page_header(canvas, document):
        canvas.saveState()
        canvas.setTitle(title)
        canvas.setAuthor('Kent Business College')
        canvas.setFont('Helvetica-Bold', 11)
        canvas.drawCentredString(page_width / 2, page_height - 40, 'Review')
        if logo.is_file():
            canvas.drawImage(str(logo), page_width - margin - 75, page_height - 86, width=75, height=75, preserveAspectRatio=True, mask='auto')
        canvas.setFont('Helvetica', 8)
        canvas.drawCentredString(page_width / 2, 25, f'Page {document.page}')
        canvas.restoreState()

    SimpleDocTemplate(output, pagesize=landscape(A4), leftMargin=margin, rightMargin=margin,
                      topMargin=85, bottomMargin=43).build(story, onFirstPage=page_header, onLaterPages=page_header)
    return output.getvalue()


def mcm_pdf_response(definition, information):
    from django.http import HttpResponse, JsonResponse
    availability = pdf_availability(definition)
    if availability is None:
        return JsonResponse({'detail': 'This review type has no signed PDF export.'}, status=404)
    if not availability['available']:
        return JsonResponse({'detail': availability['reason']}, status=409)
    try:
        content = build_mcm_pdf(definition, information)
    except ValueError as exc:
        return JsonResponse({'detail': str(exc)}, status=409)
    response = HttpResponse(content, content_type='application/pdf')
    identifier = re.sub(r'[^A-Za-z0-9_-]', '', str(definition['instance']['id']))
    prefix = EXPORTABLE_REVIEW_TYPES[review_type_code(definition)]
    response['Content-Disposition'] = f'attachment; filename="{prefix}-{identifier}.pdf"'
    response['Cache-Control'] = 'private, no-store'
    return response
