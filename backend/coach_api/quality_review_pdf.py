"""PDF of one completed saved review version; no Microsoft or AI requests."""
from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle, Image

from .recordings_cache import recent_read
from .recordings_pdf import _fonts, _p, PURPLE, INK, MUTED, LINE, WIDTH
from .quality_review_template import TEMPLATE_ID
from .quality_form_definition import definition_for, clean_answers
from .quality_review_types import saved_type
from . import quality_review_store as store

LABELS = {'gold':'Gold', 'green':'Green', 'amber':'Amber', 'red':'Red', 'na':'N/A'}
TINTS = {'gold':'#FEF3C7','green':'#ECFDF5','amber':'#FFFBEB','red':'#FFF1F2','na':'#F1F5F9'}
SOURCES = {'recording':'Recording','transcript':'Transcript','ai':'AI analysis','portfolio':'LMS / portfolio','other':'Other evidence'}


def _title(text):
    value = _p(text,size=12,bold=True,color=PURPLE,space=10)
    value.keepWithNext = True
    return value


def _utc(value):
    return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone.utc).strftime('%d %b %Y %H:%M UTC')


def _render(review, images):
    _fonts()
    definition=definition_for(review)
    data=clean_answers(review['form'],'completed',definition)
    output=BytesIO()
    doc=SimpleDocTemplate(output,pagesize=A4,leftMargin=15*mm,rightMargin=15*mm,
      topMargin=19*mm,bottomMargin=17*mm,title=definition['title'],author='Kent Business College')
    logo=Path(__file__).resolve().parents[1]/'curriculum_api'/'templates'/'kbc-logo.png'
    brand=Table([[Image(str(logo),width=44*mm,height=22*mm,kind='proportional'),
      _p('QUALITY CHECK',size=11,bold=True,color=PURPLE,space=0)]],colWidths=[WIDTH*.65,WIDTH*.35])
    brand.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LINEBELOW',(0,0),(-1,-1),1.5,PURPLE),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story=[brand,Spacer(1,12),_p(definition['title'],size=19,bold=True,space=10),
      _p(f'Completed review - saved version {review["version"]} | Form version {definition["version"]}',size=9,bold=True)]
    header=data['header']
    details=[('Quality review type',saved_type(review) or 'Not classified'),('Coach / tutor observed',review['coach']['name']),('Observer',review['reviewer']['name']),
      ('Learner / cohort',review['learner']['name']),('Employer',header['employer']),
      ('Programme / standard',header['programme']),('Activity date',header['activityDate']),
      ('Start date',header['startDate']),('Planned end date',header['endDate']),
      ('Meeting',review['meeting']['title']),('Meeting start',_utc(review['meeting']['startsAt'])),
      ('Meeting end',_utc(review['meeting']['endsAt'])),('Saved',_utc(review['updatedAt']))]
    table=Table([[_p(a,size=8,bold=True,color=MUTED,space=0),_p(b,size=8.5,space=0)] for a,b in details],
      colWidths=[47*mm,WIDTH-47*mm],splitInRow=1)
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(0,-1),colors.HexColor('#F5F3FF')),
      ('LINEBELOW',(0,0),(-1,-1),.4,LINE),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story += [table,Spacer(1,12),_title('Review overview')]
    counts=Counter(value['rating'] for value in data['criteria'].values())
    story += [_p(' | '.join(f'{LABELS[key]}: {counts[key]}' for key in LABELS),bold=True),
      _p('Evidence relied on (declared by reviewer): '+(', '.join(SOURCES[key] for key in data['sources']) or 'Not recorded'),size=8),
      _p('The meeting is an evidence source. Judgements cover the learner experience across the apprenticeship.',size=8,color=MUTED)]
    story.append(_title('Rating descriptors'))
    story.extend(_p(f'{LABELS[key]} - {description}',size=7.5) for key,description in definition['ratings'].items())
    story.append(Spacer(1,10))
    def pictures(key):
        for image_id in data['images'].get(key,[]):
            story.append(_p('Supporting screenshot',size=8,bold=True,color=MUTED))
            picture=Image(BytesIO(bytes(images[image_id]['content'])))
            scale=min(WIDTH/picture.imageWidth,180*mm/picture.imageHeight,1)
            picture.drawWidth=picture.imageWidth*scale;picture.drawHeight=picture.imageHeight*scale
            picture.hAlign='LEFT'
            story.extend([picture,Spacer(1,10)])
    for section in definition['sections']:
        story.append(_title(section['title']))
        for index,item in enumerate(section['criteria'],1):
            heading=_p(f'{index}. {item["text"]}',size=9,bold=True)
            heading.keepWithNext=True
            if item['type']=='image':
                story.append(heading);pictures(item['id'])
                if not data['images'].get(item['id']):story.append(_p('No image attached.',size=8.5))
                continue
            if item['type']!='rating':
                answer=data['answers'].get(item['id'])
                text='Yes' if answer is True else 'No' if answer is False else ', '.join(answer) if isinstance(answer,list) else str(answer) if answer not in (None,'') else 'Not answered'
                story.extend([heading,_p(text,size=8.5),Spacer(1,10)])
                continue
            answer=data['criteria'][item['id']]
            badge=Table([[_p(LABELS.get(answer['rating'],'Not rated'),size=8,bold=True,space=0)]],colWidths=[WIDTH])
            badge.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor(TINTS.get(answer['rating'],'#F1F5F9'))),
              ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
            badge.keepWithNext=True
            evidence_label=_p('Evidence observed and impact on the learner',size=7,bold=True,color=MUTED)
            evidence_label.keepWithNext=True
            evidence_label.spaceBefore=5
            story += [heading,badge,evidence_label,
              _p(answer['evidence'] or 'Not applicable - no additional evidence recorded.',size=8.5),Spacer(1,10)]
        pictures(section['id'])
    story.append(_title(definition['actionsTitle']))
    if not data['actions']:
        story.append(_p('No follow-up actions were recorded by the reviewer.',size=8.5))
    for index,action in enumerate(data['actions'],1):
        story.append(_p(f'Action {index} - due {action["dueDate"]}',size=10,bold=True,color=PURPLE))
        for key,label in [('action','Target / action (SMART)'),('outcome','Planned outcome and learner impact'),('supportedBy','Supported by')]:
            story += [_p(label,size=7,bold=True,color=MUTED),_p(action[key],size=8.5)]
        story.append(Spacer(1,10))

    def page(canvas,document):
        canvas.saveState();canvas.setStrokeColor(PURPLE);canvas.setLineWidth(2)
        canvas.line(15*mm,A4[1]-12*mm,A4[0]-15*mm,A4[1]-12*mm)
        canvas.setFont('CoachingPDF',7);canvas.setFillColor(MUTED)
        canvas.drawString(15*mm,10*mm,'Kent Business College | Quality review | Version '+str(review['version']))
        canvas.drawRightString(A4[0]-15*mm,10*mm,str(document.page));canvas.restoreState()
    doc.build(story,onFirstPage=page,onLaterPages=page)
    return output.getvalue()


def review_pdf(review):
    if review['status']!='completed' or review['templateId']!=TEMPLATE_ID:
        raise store.ReviewConflict('Complete and save this review before exporting its PDF.')
    def load():
        images=store.read_images(review['id'],review['form']['images'])
        return _render(review,images)
    from .recordings_saved_evidence import source_dsn
    return recent_read('quality-review-pdf',[store.digest(source_dsn()),review['id'],review['version'],store.digest(definition_for(review)),2],load,timeout=600)


def stored_review_pdf(review):
    if review['status']!='completed':
        raise store.ReviewConflict('Complete and save this review before exporting its PDF.')
    def load():
        existing=store.read_document(review['id'],review['version'])
        if existing:
            return bytes(existing['content'])
        content=review_pdf(review)
        return bytes(store.save_document(review,content)['content'])
    from .recordings_saved_evidence import source_dsn
    return recent_read('quality-document',[store.digest(source_dsn()),review['id'],review['version']],load,timeout=600)
