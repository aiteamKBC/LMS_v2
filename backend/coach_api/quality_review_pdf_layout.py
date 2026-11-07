"""Branded PDF presentation for reviews created with layout version 2.

Only saved answers and supplied evidence are rendered. The original renderer
remains in quality_review_pdf for reviews that predate this layout.
"""
from collections import Counter
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, SimpleDocTemplate, Spacer, Table, TableStyle

from .quality_form_definition import clean_answers, definition_for
from .quality_review_types import saved_type
from .recordings_pdf import _fonts, _p, WIDTH

INK = colors.HexColor('#17243B')
MUTED = colors.HexColor('#59677C')
PURPLE = colors.HexColor('#6133A4')
LINE = colors.HexColor('#DFE4ED')
SOFT = colors.HexColor('#F6F3FA')
WHITE = colors.white
RATINGS = {
    'gold': ('Gold', '#FFF4CE', '#775000'),
    'green': ('Green', '#E8F5EE', '#18643D'),
    'amber': ('Amber', '#FFF0DD', '#8C4B10'),
    'red': ('Red', '#FCEBEE', '#9C2941'),
    'na': ('N/A', '#EDF0F5', '#526074'),
}
SOURCES = {'recording': 'Recording', 'transcript': 'Transcript', 'ai': 'AI analysis',
           'portfolio': 'LMS / portfolio', 'other': 'Other evidence'}


def paragraph(value, *, size=9, bold=False, color=INK, space=6):
    return _p(value, size=size, bold=bold, color=color, space=space)


def label(value):
    result = paragraph(value, size=7, bold=True, color=MUTED, space=4)
    result.keepWithNext = True
    return result


def heading(value, number=None):
    if number is None:
        result = paragraph(value, size=14, bold=True, color=PURPLE, space=12)
    else:
        result = Table([[paragraph(f'{number:02d}', size=12, bold=True, color=WHITE, space=0),
                         paragraph(value, size=12, bold=True, color=PURPLE, space=0)]],
                       colWidths=[13 * mm, WIDTH - 13 * mm])
        result.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), PURPLE), ('BACKGROUND', (1, 0), (1, 0), SOFT),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ]))
        result.spaceAfter = 13
    result.keepWithNext = True
    return result


def formatted_date(value):
    return date.fromisoformat(value).strftime('%d %b %Y') if value else 'Not recorded'


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).strftime('%d %b %Y, %H:%M UTC')


def details_grid(pairs):
    cells = [[label(title), paragraph(value, size=9, space=0)] for title, value in pairs]
    rows = [cells[index:index + 2] for index in range(0, len(cells), 2)]
    if len(rows[-1]) == 1:
        rows[-1].append('')
    table = Table(rows, colWidths=[WIDTH / 2] * 2, splitInRow=1)
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F8F9FC')),
        ('LINEBELOW', (0, 0), (-1, -1), .5, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 11),
    ]))
    table.spaceAfter = 15
    return table


def picture(content):
    image = Image(BytesIO(bytes(content)))
    scale = min(WIDTH / image.imageWidth, 135 * mm / image.imageHeight, 1)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    image.hAlign = 'LEFT'
    return image


def render(review, images, attachments=()):
    _fonts()
    definition = definition_for(review)
    data = clean_answers(review['form'], 'completed', definition)
    output = BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=23 * mm, bottomMargin=20 * mm, title=definition['title'], author='Kent Business College')
    logo = Path(__file__).resolve().parents[1] / 'curriculum_api' / 'templates' / 'kbc-logo.png'
    brand = Table([[Image(str(logo), width=42 * mm, height=21 * mm, kind='proportional'),
        [paragraph('QUALITY ASSURANCE', size=9, bold=True, color=PURPLE, space=4),
         paragraph('Observation & feedback', size=8, color=MUTED, space=0)]]],
        colWidths=[WIDTH * .62, WIDTH * .38])
    brand.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LINEBELOW', (0, 0), (-1, -1), 1.5, PURPLE),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 13),
    ]))
    story = [brand, Spacer(1, 18), paragraph(definition['title'], size=23, bold=True, space=8),
        paragraph(f'COMPLETED REVIEW   /   Saved version {review["version"]}   /   Form version {definition["version"]}',
                  size=7.5, bold=True, color=PURPLE, space=14)]
    if definition.get('purpose'):
        story.append(paragraph(definition['purpose'], size=8.5, color=MUTED, space=14))
    if not saved_type(review).startswith('FORM_'):
        story.append(paragraph('Quality review type: ' + (saved_type(review) or 'Not classified'),
                               size=8, color=MUTED, space=10))
    header = data['header']
    story.append(details_grid([
        ('Coach / tutor observed', review['coach']['name']), ('Observer', review['reviewer']['name']),
        ('Learner / cohort', review['learner']['name']), ('Employer', header['employer']),
        ('Programme / standard', header['programme']), ('Activity date', formatted_date(header['activityDate'])),
        ('Start date', formatted_date(header['startDate'])), ('Planned end date', formatted_date(header['endDate'])),
    ]))
    story.extend([label('Meeting / activity'), paragraph(review['meeting']['title'], bold=True),
        paragraph(f'{instant(review["meeting"]["startsAt"])}  to  {instant(review["meeting"]["endsAt"])}',
                  size=8, color=MUTED, space=14)])
    counts = Counter(answer['rating'] for answer in data['criteria'].values())
    story.append(heading('Review at a glance'))
    if data['criteria']:
        tiles = Table([[[paragraph(str(counts[key]), size=18, bold=True, color=colors.HexColor(tone), space=3),
                        paragraph(name, size=8, bold=True, color=colors.HexColor(tone), space=0)]
                       for key, (name, _, tone) in RATINGS.items()]], colWidths=[WIDTH / 5] * 5)
        commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10)]
        commands.extend(('BACKGROUND', (index, 0), (index, 0), colors.HexColor(tint))
                        for index, (_, tint, _) in enumerate(RATINGS.values()))
        tiles.setStyle(TableStyle(commands))
        story.extend([tiles, Spacer(1, 10)])
    else:
        story.append(paragraph('This form contains no rated criteria.', size=8, color=MUTED))
    story.extend([
        paragraph(f'{len(data["criteria"])} rated criteria   /   {len(data["actions"])} follow-up actions', size=8, bold=True),
        label('Evidence relied on (declared by reviewer)'),
        paragraph(', '.join(SOURCES[key] for key in data['sources']) or 'Not recorded', size=8),
        paragraph('Judgements and evidence are recorded by the reviewer for this observation. '
                  'The counts above summarise the selected ratings; they are not an overall grade.', size=7.5, color=MUTED),
        paragraph('Saved ' + instant(review['updatedAt']), size=7.5, color=MUTED, space=0),
        PageBreak(),
    ])

    def keep_block(start):
        content = story[start:]
        # Avoid nesting KeepTogether inside a heading's automatic keep chain.
        # Blocks taller than a page must remain ordinary splittable flowables.
        height = sum(item.wrapOn(None, WIDTH - 12, doc.height)[1]
                     + item.getSpaceBefore() + item.getSpaceAfter() for item in content)
        if height <= doc.height - 24:
            story[start:] = [KeepTogether(content)]

    def pictures(key):
        for index, image_id in enumerate(data['images'].get(key, []), 1):
            story.extend([label(f'Supporting screenshot {index}'), picture(images[image_id]['content']), Spacer(1, 14)])

    def evidence_files(key):
        for evidence in attachments:
            if evidence['section'] != key:
                continue
            story.append(label(evidence['filename']))
            story.append(paragraph(f'{round(evidence["size"] / 1024, 1)} KB | Original file saved with this review',
                                   size=7.5, color=MUTED, space=8))
            if evidence.get('preview'):
                story.append(picture(evidence['preview']))
            story.append(Spacer(1, 10))

    for section_number, section in enumerate(definition['sections'], 1):
        section_start = len(story)
        story.append(heading(section['title'], section_number))
        for index, item in enumerate(section['criteria'], 1):
            entry_start = section_start if index == 1 else len(story)
            kind = item['type']
            question = paragraph(f'{index}. {item["text"]}', size=9.5, bold=True, space=7)
            question.keepWithNext = True
            if kind == 'rating':
                answer = data['criteria'][item['id']]
                name, tint, tone = RATINGS.get(answer['rating'], ('Not rated', '#EDF0F5', '#526074'))
                title = Table([[question, paragraph(name, size=8, bold=True, color=colors.HexColor(tone), space=0)]],
                              colWidths=[WIDTH - 26 * mm, 26 * mm])
                title.setStyle(TableStyle([
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LINEBELOW', (0, 0), (0, 0), .5, LINE),
                    ('BACKGROUND', (1, 0), (1, 0), colors.HexColor(tint)),
                    ('LEFTPADDING', (0, 0), (0, 0), 0), ('RIGHTPADDING', (0, 0), (0, 0), 12),
                    ('LEFTPADDING', (1, 0), (1, 0), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ]))
                title.keepWithNext = True
                title.spaceAfter = 7
                story.extend([title, label('Evidence observed and impact on the learner'),
                    paragraph(answer['evidence'] or 'Not applicable - no additional evidence recorded.', space=9)])
                description = (item.get('descriptors') or {}).get(answer['rating'])
                if description:
                    story.extend([label('Selected rating - reference criteria'),
                        paragraph(description, size=8, color=MUTED, space=9)])
            else:
                story.append(question)
                if kind == 'image':
                    pictures(item['id'])
                    if not data['images'].get(item['id']):
                        story.append(paragraph('No image attached.', color=MUTED))
                elif kind == 'file':
                    evidence_files(item['id'])
                    if not data.get('attachments', {}).get(item['id']):
                        story.append(paragraph('No evidence file attached.', color=MUTED))
                else:
                    answer = data['answers'].get(item['id'])
                    text = ('Yes' if answer is True else 'No' if answer is False else ', '.join(answer)
                            if isinstance(answer, list) else str(answer) if answer not in (None, '') else 'Not answered')
                    story.append(paragraph(text))
            story.append(Spacer(1, 10))
            # Keep ordinary observations together; unusually long evidence may
            # still split naturally across pages without dropping any content.
            keep_block(entry_start)
        pictures(section['id'])
        story.append(Spacer(1, 8))

    if any(file['section'] == 'evidence' for file in attachments):
        story.extend([heading('Evidence attachments'),
            paragraph('Original files remain available in the saved meeting review. Image previews are included below; '
                      'other files are listed in their original format.', size=8, color=MUTED)])
        evidence_files('evidence')
    actions_start = len(story)
    story.append(heading(definition['actionsTitle']))
    if not data['actions']:
        story.append(paragraph('No follow-up actions were recorded by the reviewer.', color=MUTED))
    for index, action in enumerate(data['actions'], 1):
        entry_start = actions_start if index == 1 else len(story)
        title = paragraph(f'Action {index:02d}', size=11, bold=True, color=PURPLE, space=9)
        title.keepWithNext = True
        story.append(title)
        metadata = details_grid([('Supported by', action['supportedBy']), ('By when', action['dueDate'])])
        metadata.keepWithNext = True
        story.append(metadata)
        for key, title in [('action', 'Target / action (SMART)'), ('outcome', 'Planned outcome and learner impact')]:
            story.extend([label(title), paragraph(action[key])])
        story.append(Spacer(1, 13))
        keep_block(entry_start)
    reference_start = len(story)
    story.extend([Spacer(1, 12), heading('Rating reference guide'),
        paragraph('Use these descriptors to interpret the selected judgements. Where a criterion has its own reference '
                  'description, the selected description appears alongside the observation.', size=8, color=MUTED, space=10)])
    for key, (name, tint, tone) in RATINGS.items():
        row = Table([[paragraph(name, size=8.5, bold=True, color=colors.HexColor(tone), space=0),
                      paragraph(definition['ratings'][key], size=8, space=0)]],
                    colWidths=[25 * mm, WIDTH - 25 * mm], splitInRow=1)
        row.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), colors.HexColor(tint)), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LINEBELOW', (0, 0), (-1, -1), .5, LINE),
            ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ]))
        story.append(row)
    keep_block(reference_start)

    def page(canvas, document):
        canvas.saveState()
        canvas.setFillColor(PURPLE)
        canvas.rect(0, A4[1] - 5 * mm, A4[0], 5 * mm, fill=1, stroke=0)
        canvas.setFont('CoachingPDF', 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(15 * mm, A4[1] - 14 * mm, 'KENT BUSINESS COLLEGE')
        canvas.drawRightString(A4[0] - 15 * mm, A4[1] - 14 * mm, 'QUALITY ASSURANCE / OBSERVATION RECORD')
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(.5)
        canvas.line(15 * mm, 15 * mm, A4[0] - 15 * mm, 15 * mm)
        canvas.drawString(15 * mm, 10 * mm, f'Quality review | Saved version {review["version"]} | Form version {definition["version"]}')
        canvas.drawRightString(A4[0] - 15 * mm, 10 * mm, f'Page {document.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=page, onLaterPages=page)
    return output.getvalue()
