"""Versioned quality form definitions and typed answers, independent of Teams."""
from copy import deepcopy
from datetime import date
import math
import re
from uuid import UUID

from .quality_review_template import template, RATINGS, InvalidReview, _text
from .quality_review_types import review_type

FIELD_TYPES = ('rating', 'text', 'textarea', 'boolean', 'single_choice', 'checklist', 'date', 'number', 'image', 'file')


def default_definition(kind=''):
    from .quality_feedback_catalog import feedback_definition
    feedback = feedback_definition(kind)
    if feedback:
        return clean_definition(feedback)
    return _initial_definition({**template(), 'version': 1},kind)


def _initial_definition(value, kind):
    value=deepcopy(value)
    if kind:
        value['reviewType']=review_type(kind,allow_empty=False)
        excluded='progress' if kind=='MCM' else 'monthly'
        value['sections']=[row for row in value['sections'] if row['id']!=excluded]
        if not value['sections']:
            value['sections']=[row for row in template()['sections'] if row['id']!=excluded]
    return clean_definition(value)


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', value) or value in ('details','actions','constructor','prototype'):
        raise InvalidReview('Every section and question needs a valid stable identifier.')
    return value


def clean_definition(value):
    if not isinstance(value, dict) or set(value)-{'id','version','title','sections','ratings','actionsTitle','reviewType'}:
        raise InvalidReview('The quality form definition is invalid.')
    review_kind = review_type(value.get('reviewType', ''))
    title = _text(value.get('title', ''), 160)
    sections = value.get('sections')
    if not title or not isinstance(sections, list) or not 1 <= len(sections) <= 30:
        raise InvalidReview('Give the form a title and between 1 and 30 sections.')
    ratings = value.get('ratings', template()['ratings'])
    if not isinstance(ratings, dict) or set(ratings) != set(RATINGS):
        raise InvalidReview('Keep all five quality rating descriptors.')
    ratings = {key:_text(ratings[key],1000) for key in RATINGS}
    if not all(ratings.values()):
        raise InvalidReview('Enter a description for every rating.')
    seen = set(); result = []; total = 0
    for section in sections:
        if not isinstance(section, dict) or set(section)-{'id','title','screenshots','criteria'}:
            raise InvalidReview('A section is invalid.')
        key = _identifier(section.get('id'))
        heading = _text(section.get('title',''),160)
        items = section.get('criteria')
        if key in seen or not heading or not isinstance(items,list) or not items or type(section.get('screenshots',False)) is not bool:
            raise InvalidReview('Each section needs a unique identifier, title and at least one question.')
        seen.add(key); fields=[]
        for item in items:
            if not isinstance(item,dict) or set(item)-{'id','text','type','required','options','help','allowNa','descriptors'}:
                raise InvalidReview('A question is invalid.')
            identity = _identifier(item.get('id'))
            kind = item.get('type','rating'); text = _text(item.get('text',''),1200)
            required = item.get('required',True)
            if identity in seen or kind not in FIELD_TYPES or not text or type(required) is not bool:
                raise InvalidReview('Questions need unique identifiers, a title and a supported type.')
            seen.add(identity)
            options = item.get('options',[])
            if not isinstance(options,list) or len(options)>30:
                raise InvalidReview('Use up to 30 options per question.')
            options = [_text(option,160) for option in options]
            if len(set(options)) != len(options) or any(not option for option in options):
                raise InvalidReview('Options must be nonempty and unique.')
            if kind in ('single_choice','checklist') and len(options)<2:
                raise InvalidReview('Choice questions need at least two options.')
            if kind not in ('single_choice','checklist') and options:
                raise InvalidReview('Only choice questions can have options.')
            extra = {}
            if 'allowNa' in item:
                if type(item['allowNa']) is not bool:
                    raise InvalidReview('Choose whether N/A is allowed for this criterion.')
                extra['allowNa'] = item['allowNa']
            if 'descriptors' in item:
                descriptors = item['descriptors']
                if not isinstance(descriptors, dict) or set(descriptors)-set(RATINGS):
                    raise InvalidReview('The criterion rating descriptions are invalid.')
                extra['descriptors'] = {key:_text(text,6000) for key,text in descriptors.items()}
            fields.append({'id':identity,'text':text,'type':kind,'required':required,
                           'options':options,'help':_text(item.get('help',''),1000), **extra})
        total += len(fields)
        if total>100:
            raise InvalidReview('Use up to 100 questions in one form.')
        result.append({'id':key,'title':heading,'screenshots':bool(section.get('screenshots',False)), 'criteria':fields})
    return {'id':('feedback-' + review_kind.lower()) if review_kind.startswith('FORM_') else template()['id'] + (f'-{review_kind.lower()}' if review_kind else ''),'version':1,'title':title,'ratings':ratings,'sections':result,
            'actionsTitle':_text(value.get('actionsTitle','SMART action plan'),160) or 'SMART action plan',
            **({'reviewType':review_kind} if review_kind else {})}


def definition_for(review):
    value = review.get('definition') if review else None
    if not value:
        return default_definition()
    cleaned = clean_definition(value)
    cleaned['version'] = int(value.get('version',1))
    return cleaned


def image_keys(definition):
    return {section['id'] for section in definition['sections'] if section['screenshots']} | {
        item['id'] for section in definition['sections'] for item in section['criteria'] if item['type']=='image'}


def clean_answers(value, status, definition):
    if status not in ('draft','completed') or not isinstance(value,dict) or set(value)-{'header','criteria','actions','images','sources','answers','attachments'}:
        raise InvalidReview('Choose a valid review status and form.')
    header = value.get('header',{})
    header_keys = ('employer','programme','activityDate','startDate','endDate')
    if not isinstance(header,dict) or set(header)-set(header_keys):
        raise InvalidReview('The form header is invalid.')
    header = {key:_text(header.get(key,''),300) for key in header_keys}
    for key in ('activityDate','startDate','endDate'):
        if header[key]:
            try: date.fromisoformat(header[key])
            except ValueError: raise InvalidReview('Enter valid form dates.')
    if header['startDate'] and header['endDate'] and header['endDate'] < header['startDate']:
        raise InvalidReview('Planned end date must follow the start date.')
    fields = {item['id']:item for section in definition['sections'] for item in section['criteria']}
    ratings = value.get('criteria',{}); answers = value.get('answers',{})
    rating_ids = {key for key,item in fields.items() if item['type']=='rating'}
    answer_ids = {key for key,item in fields.items() if item['type'] not in ('rating','image','file')}
    if not isinstance(ratings,dict) or set(ratings)-rating_ids or not isinstance(answers,dict) or set(answers)-answer_ids:
        raise InvalidReview('The answers do not belong to this saved form version.')
    cleaned_ratings={}; cleaned_answers={}
    images=value.get('images',{})
    if not isinstance(images,dict) or set(images)-image_keys(definition):
        raise InvalidReview('A screenshot is assigned to an invalid section or question.')
    cleaned_images={}
    for key,identities in images.items():
        if not isinstance(identities,list) or len(identities)>2:
            raise InvalidReview('Use up to two screenshots per question or section.')
        try: cleaned_images[key]=list(dict.fromkeys(str(UUID(identity)) for identity in identities))
        except (ValueError,TypeError,AttributeError): raise InvalidReview('A screenshot identity is invalid.')
    if sum(map(len,cleaned_images.values()))>20:
        raise InvalidReview('Use up to 20 screenshots in one review.')
    attachments = value.get('attachments', {})
    attachment_keys = {'evidence'} | {key for key,item in fields.items() if item['type']=='file'}
    if not isinstance(attachments,dict) or set(attachments)-attachment_keys:
        raise InvalidReview('An evidence file is assigned to an invalid question.')
    cleaned_attachments = {}
    for key, identities in attachments.items():
        if not isinstance(identities,list) or len(identities)>30:
            raise InvalidReview('Use up to 30 evidence files in a review.')
        try: cleaned_attachments[key] = list(dict.fromkeys(str(UUID(identity)) for identity in identities))
        except (ValueError,TypeError,AttributeError): raise InvalidReview('An evidence file identity is invalid.')
    if sum(map(len,cleaned_attachments.values()))>30:
        raise InvalidReview('Use up to 30 evidence files in a review.')
    for key,item in fields.items():
        kind=item['type']; required=status=='completed' and item['required']
        if kind=='rating':
            answer=ratings.get(key,{})
            if not isinstance(answer,dict) or set(answer)-{'rating','evidence'} or answer.get('rating','') not in ('',*RATINGS):
                raise InvalidReview('Choose a valid quality rating.')
            rating=answer.get('rating',''); evidence=_text(answer.get('evidence',''),6000)
            if rating=='na' and item.get('allowNa') is False:
                raise InvalidReview('N/A is not allowed for this criterion.')
            if required and not rating or status=='completed' and rating not in ('','na') and not evidence:
                raise InvalidReview('Complete each required rating and explain its evidence.')
            cleaned_ratings[key]={'rating':rating,'evidence':evidence}
            continue
        if kind=='image':
            if required and not cleaned_images.get(key):
                raise InvalidReview('Attach an image for each required image question.')
            continue
        if kind=='file':
            if required and not cleaned_attachments.get(key):
                raise InvalidReview('Attach evidence for each required file question.')
            continue
        answer=answers.get(key, [] if kind=='checklist' else None if kind=='boolean' else '')
        if kind=='boolean':
            if answer is not None and type(answer) is not bool:
                raise InvalidReview('Choose Yes or No.')
        elif kind=='checklist':
            if not isinstance(answer,list) or any(not isinstance(option,str) or option not in item['options'] for option in answer):
                raise InvalidReview('Choose valid checklist options.')
            answer=list(dict.fromkeys(answer))
        elif kind=='number':
            if answer!='' and (type(answer) not in (int,float) or not math.isfinite(answer)):
                raise InvalidReview('Enter a valid number.')
        else:
            answer=_text(answer,6000 if kind=='textarea' else 1000)
            if kind=='single_choice' and answer and answer not in item['options']:
                raise InvalidReview('Choose a valid option.')
            if kind=='date' and answer:
                try: date.fromisoformat(answer)
                except ValueError: raise InvalidReview('Enter a valid question date.')
        if required and (answer is None or answer=='' or answer==[]):
            raise InvalidReview('Answer every required question before completing the review.')
        cleaned_answers[key]=answer
    actions=value.get('actions',[])
    if not isinstance(actions,list) or len(actions)>30:
        raise InvalidReview('Use up to 30 SMART actions.')
    plan=[]
    for row in actions:
        keys=('action','outcome','supportedBy','dueDate')
        if not isinstance(row,dict) or set(row)-set(keys):
            raise InvalidReview('An action row is invalid.')
        action={key:_text(row.get(key,''),3000 if key in ('action','outcome') else 300) for key in keys}
        if action['dueDate']:
            try: date.fromisoformat(action['dueDate'])
            except ValueError: raise InvalidReview('Enter a valid action deadline.')
        if any(action.values()):
            if status=='completed' and not all(action.values()):
                raise InvalidReview('Complete all four fields in each SMART action.')
            plan.append(action)
    sources=value.get('sources',[])
    if not isinstance(sources,list) or any(key not in ('recording','transcript','ai','portfolio','other') for key in sources):
        raise InvalidReview('Choose valid evidence sources.')
    return {'header':header,'criteria':cleaned_ratings,'answers':cleaned_answers,'actions':plan,
            'images':cleaned_images,'sources':list(dict.fromkeys(sources)),
            **({'attachments':cleaned_attachments} if 'attachments' in value else {})}


def initial_state(kind='', inherited=None):
    definition=default_definition(kind)
    draft=deepcopy(definition)
    if kind and not kind.startswith('FORM_'):
        for target, source in ((definition, (inherited or {}).get('published')), (draft, (inherited or {}).get('draft'))):
            if source:
                target.update(_initial_definition(source,kind))
            target['title']=f'{kind} · {target["title"]}'[:160]
    return {'id':definition['id'],'revision':0,'draft':deepcopy(definition),'published':definition,
            'publishedAt':None,'updatedAt':None, **({'draft':draft, 'reviewType':kind} if kind else {})}
