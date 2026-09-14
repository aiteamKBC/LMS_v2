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


def pdf_availability(definition):
    if definition.get('template', {}).get('reviewTypeCode') != 'mcm':
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
        'employer': getattr(source, 'employer', ''),
        'manager': getattr(source, 'line_manager', ''),
    }


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
        raise ValueError((availability or {}).get('reason') or 'A signed MCM is required.')
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
    info_rows = [
        ('Programme Name', information.get('programme')),
        ('Programme Start Date', display_date(information.get('startDate'))),
        ('Planned End Date', display_date(information.get('endDate'))),
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
        return JsonResponse({'detail': 'This PDF export is for monthly coaching meetings.'}, status=404)
    if not availability['available']:
        return JsonResponse({'detail': availability['reason']}, status=409)
    try:
        content = build_mcm_pdf(definition, information)
    except ValueError as exc:
        return JsonResponse({'detail': str(exc)}, status=409)
    response = HttpResponse(content, content_type='application/pdf')
    identifier = re.sub(r'[^A-Za-z0-9_-]', '', str(definition['instance']['id']))
    response['Content-Disposition'] = f'attachment; filename="Monthly-Coaching-Meeting-{identifier}.pdf"'
    response['Cache-Control'] = 'private, no-store'
    return response
