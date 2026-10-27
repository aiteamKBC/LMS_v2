"""Curriculum-only quality reviews; no Graph, AI or calendar writes."""
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
import json
import logging
from uuid import UUID
from django.db import DatabaseError
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods, require_GET, require_POST
from learner_api.constants import ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN
from login.identity import accesses_for_staff
from login.permissions import require_access
from .recordings_api import _staff, _coaches, _learners, _authorised_record, _response, source_details
from .recordings_media import session_window
from .recordings_saved_evidence import online_identity
from . import quality_review_store as store
from .quality_review_template import TEMPLATE_ID, InvalidReview
from .quality_form_definition import clean_answers, definition_for, image_keys
from .recordings_links import occurrence_id
from .quality_review_types import review_type, saved_type

logger=logging.getLogger(__name__)


def document_state(saved):
    if saved['status']!='completed':
        return None
    try:
        from .quality_review_pdf import stored_review_pdf
        stored_review_pdf(saved)
        return {'state':'ready','version':saved['version']}
    except Exception as error:
        logger.warning('Quality review saved; PDF preparation failed (%s).',type(error).__name__)
        return {'state':'failed','version':saved['version'],'message':'Your review was saved. Its PDF could not be prepared. Use Preview PDF to retry.'}


def actor(request):
    staff = _staff(request.login_account)
    if not staff or not accesses_for_staff(staff) & {ACCESS_CURRICULUM,ACCESS_SUPER_ADMIN}:
        raise PermissionError()
    return {'id':f'staff:{staff.id}', 'name':staff.username or staff.email, 'email':staff.email}


def guarded(view):
    from functools import wraps
    @wraps(view)
    def wrapped(request,*args,**kwargs):
        try:
            request.quality_actor = actor(request)
            return view(request,*args,**kwargs)
        except PermissionError:
            return _response({'error':'Curriculum access is required.','code':'forbidden'},403)
        except InvalidReview as error:
            return _response({'error':str(error),'code':'invalid_review'},400)
        except (ValueError,TypeError,OverflowError):
            return _response({'error':'Check the form values, dates and save version.','code':'invalid_review'},400)
        except store.ReviewConflict as error:
            return _response({'error':str(error),'code':'review_conflict'},409)
        except (store.ReviewUnavailable,DatabaseError):
            return _response({'error':'The saved quality review is temporarily unavailable. Your edits have not been discarded.','code':'review_unavailable'},503)
    return wrapped


def context(request, learner_id, kind=None):
    record, failure = _authorised_record(request)
    if failure is not None:
        return None,failure
    begin,end = session_window(record)
    if not begin or not end or end<=begin:
        return None,_response({'error':'This meeting has no valid time window.','code':'invalid_meeting_window'},409)
    owner = record.owner_email.strip().casefold()
    coaches = {row['email']:row for row in _coaches()}
    learners = _learners(owner)
    selected = next((row for row in learners if str(row['id'])==str(learner_id)),None)
    if learner_id and not selected:
        return None,_response({'error':'Choose a learner from this coach’s current caseload.','code':'learner_not_found'},404)
    job = source_details(record)
    event = (job.result.get('event') or {}) if job else {}
    meeting = {'eventId':record.graph_event_id,'startsAt':begin.isoformat(),'endsAt':end.isoformat(),
               'onlineMeetingId':online_identity(job),'title':event.get('subject') or getattr(record,'title','') or 'Coach meeting'}
    meeting['id']=occurrence_id({'owner':owner,'event':record.graph_event_id,'start':begin.isoformat(),'end':end.isoformat()})
    kind=review_type(request.GET.get('reviewType','') if kind is None else kind)
    base = {'templateId':TEMPLATE_ID,'coach':coaches.get(owner,{'email':owner,'name':owner}),
            'meeting':meeting,'reviewType':kind,'learner':{'id':str(selected['id']),'name':selected['full_name'],
              'email':str(selected.get('email') or '').strip().casefold()} if selected else None}
    if selected:
        identity=[TEMPLATE_ID,owner,meeting['eventId'],meeting['startsAt'],meeting['endsAt'],str(selected['id'])]
        # Previous MCM/PR reviews retain their identity. New library forms are
        # independent per form, learner and verified meeting occurrence.
        base['identity'] = store.digest(identity + ([kind] if kind.startswith('FORM_') else []))
    return {'snapshot':base,'learners':[{'id':str(row['id']),'name':row['full_name']} for row in learners]},None


def body(request):
    if len(request.body)>150000:
        raise InvalidReview('The form is too large.')
    try:
        value = json.loads(request.body)
    except (ValueError,UnicodeDecodeError):
        raise InvalidReview('The form is invalid.')
    if not isinstance(value,dict) or set(value)-{'learnerId','expectedVersion','requestId','status','form','templateVersion','reviewType'}:
        raise InvalidReview('The save request is invalid.')
    if 'reviewType' in value:
        review_type(value['reviewType'],allow_empty=False)
    expected = value.get('expectedVersion')
    if type(expected) is not int or expected<0:
        raise InvalidReview('The save version is invalid.')
    if not isinstance(value.get('requestId'),str):
        raise InvalidReview('The save request needs a valid request ID.')
    value['requestId'] = str(UUID(value['requestId']))
    if request.method=='PUT' and (not isinstance(value.get('form'),dict)
          or set(value['form'])-{'header','criteria','actions','images','sources','answers','attachments'}
          or not {'header','criteria','actions','images','sources'} <= set(value['form'])):
        raise InvalidReview('Send the complete saved form when replacing a review.')
    return value


def validate_answers(value, definition):
    requested=value.get('templateVersion')
    if requested is not None and (type(requested) is not int or requested!=definition['version']):
        raise store.ReviewConflict('The published form changed. Reload it to use the new questions. Your edits are still here.')
    value['form']=clean_answers(value.get('form'),value.get('status'),definition)


def selected_definition(saved, kind):
    if saved and (not kind or saved_type(saved)==kind):
        return definition_for(saved)
    state=store.read_template(kind) if kind else store.read_template()
    if kind.startswith('FORM_') and not state.get('publishedAt'):
        from .quality_feedback_catalog import default_feedback
        if not default_feedback(kind):
            raise InvalidReview('Publish this form before using it for a meeting review.')
    return state['published']


@require_GET
@require_access(ACCESS_CURRICULUM)
@guarded
def review_context(request):
    value,failure = context(request,request.GET.get('learnerId',''))
    if failure is not None:
        return failure
    selected = value['snapshot']['learner']
    saved = store.read_review(identity=value['snapshot']['identity']) if selected else None
    kind=request.GET.get('reviewType')
    # New reviews require a deliberate card selection, never a title suggestion.
    kind=review_type(kind) if kind is not None else (saved_type(saved) if saved else '')
    value['snapshot']['reviewType']=kind
    definition=selected_definition(saved,kind)
    return _response({'template':definition,**value,'review':saved,'observer':request.quality_actor})


@require_http_methods(['GET','POST'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@guarded
def reviews(request):
    if request.method=='GET':
        if request.GET.get('meetingId'):
            import re
            identity=request.GET['meetingId']
            if not re.fullmatch(r'[a-f0-9]{32}',identity):
                raise InvalidReview('Choose a valid meeting identifier.')
            offset=int(request.GET.get('offset',0))
            if not 0<=offset<=100000:
                raise InvalidReview('Choose a valid review page.')
            rows,next_offset=store.reviews_for_meeting(identity,offset)
            return _response({'reviews':[{'id':str(row['id']),'learnerId':row['learner_id'],
              'learnerName':row['learner_name'],'status':row['status'],'version':row['version'],
              'reviewType':row.get('review_type',''),'formTitle':row.get('form_title'),'pdfVersion':row['pdf_version'],'updatedAt':row['updated_at'].isoformat()} for row in rows],'nextOffset':next_offset})
        from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
        try:
            zone=ZoneInfo(request.GET.get('timeZone','Europe/London'))
        except ZoneInfoNotFoundError:
            raise InvalidReview('Choose a valid calendar time zone.')
        start = datetime.combine(date.fromisoformat(request.GET.get('start','')),datetime.min.time(),zone).astimezone(timezone.utc)
        end = datetime.combine(date.fromisoformat(request.GET.get('end',''))+timedelta(days=1),datetime.min.time(),zone).astimezone(timezone.utc)
        offset = int(request.GET.get('offset',0))
        status = request.GET.get('status','')
        search=request.GET.get('search','').strip()
        kind=review_type(request.GET.get('reviewType',''))
        pdf=request.GET.get('pdf','')
        if pdf not in ('','available','missing'):
            raise InvalidReview('Choose a valid PDF filter.')
        if not start<end or end-start>timedelta(days=366,hours=1) or not 0<=offset<=100000 or status not in ('','draft','completed') or len(search)>200:
            raise InvalidReview('Choose a valid review period and filter.')
        args=(start,end,request.GET.get('coachEmail','').strip().casefold(),status,offset,search)
        rows,next_offset = store.list_reviews(*args,**({'review_type':kind,'pdf':pdf} if kind or pdf else {}))
        return _response({'reviews':[{'id':str(row['id']),'coachEmail':row['coach_email'],'coachName':row['coach_name'],
          'learnerId':row['learner_id'],'learnerName':row['learner_name'],'startsAt':row['starts_at'].isoformat(),
          'status':row['status'],'version':row['version'],'updatedAt':row['updated_at'].isoformat(),
          'title':row['title'],'reviewType':row.get('review_type',''),'formTitle':row.get('form_title'),'actionCount':row['action_count'],'pdfVersion':row.get('pdf_version')} for row in rows], 'nextOffset':next_offset,'coaches':_coaches()})
    value = body(request)
    data,failure = context(request,value.get('learnerId',''),value.get('reviewType'))
    if failure is not None:
        return failure
    if not data['snapshot']['learner']:
        raise InvalidReview('Choose one learner.')
    existing=store.read_review(identity=data['snapshot']['identity'])
    kind=value.get('reviewType',saved_type(existing) if existing else data['snapshot'].get('reviewType',''))
    data['snapshot']['reviewType']=kind
    definition=selected_definition(existing,kind)
    validate_answers(value,definition)
    saved = store.save_review({**data['snapshot'],'definition':definition,'form':value['form'],'status':value['status'],
      'reviewer':request.quality_actor},expected=value['expectedVersion'],request_id=value['requestId'],actor=request.quality_actor['id'])
    return _response({'review':saved,'document':document_state(saved)},201)


@require_http_methods(['GET','PUT'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@guarded
def review_detail(request,review_id):
    saved = store.read_review(review_id=str(review_id))
    if not saved:
        return _response({'error':'Review not found.','code':'not_found'},404)
    if request.method=='PUT':
        value = body(request)
        if str(value.get('learnerId',''))!=saved['learner']['id']:
            raise InvalidReview('The learner for a saved review cannot be changed.')
        # Context is taken from the saved record, never replaced by browser data.
        kind=value.get('reviewType',saved_type(saved))
        if saved_type(saved).startswith('FORM_') and kind!=saved_type(saved):
            raise InvalidReview('A saved review keeps its form. Start another review from the meeting to use a different form.')
        definition=selected_definition(saved,kind)
        validate_answers(value,definition)
        snapshot = {key:saved[key] for key in ('templateId','identity','coach','meeting','learner')}
        snapshot.update(definition=definition,reviewType=kind)
        saved = store.save_review({**snapshot,'form':value['form'],'status':value['status'],'reviewer':request.quality_actor},
          expected=value['expectedVersion'],request_id=value['requestId'],actor=request.quality_actor['id'])
    # A type switch previews the other published form without writing. Saving
    # creates a new revision of the same learner/meeting review and keeps PDFs.
    kind=(review_type(request.GET.get('reviewType','')) if request.method=='GET' else '') or saved_type(saved)
    return _response({'review':saved,'reviewType':kind,'template':selected_definition(saved,kind),**({'document':document_state(saved)} if request.method=='PUT' else {})})


@require_http_methods(['GET','POST'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@guarded
def review_image(request,review_id,image_id=None):
    if request.method=='GET':
        image = store.read_image(str(review_id),str(image_id)) if image_id else None
        if not image:
            return _response({'error':'Screenshot not found.'},404)
        response = HttpResponse(bytes(image['content']),content_type='image/jpeg')
        response['Cache-Control']='private, no-store'
        response['X-Content-Type-Options']='nosniff'
        return response
    if image_id is not None:
        raise InvalidReview('Choose the screenshot upload endpoint.')
    section = request.POST.get('section','')
    upload = request.FILES.get('image')
    saved=store.read_review(review_id=str(review_id))
    if not saved:
        return _response({'error':'Save the review before attaching images.'},404)
    if section not in image_keys(definition_for(saved)) or not upload or upload.size>5*1024*1024:
        raise InvalidReview('Choose a screenshot up to 5 MB for a screenshot section.')
    from PIL import Image,UnidentifiedImageError
    try:
        image = Image.open(upload)
        if image.format not in ('JPEG','PNG','WEBP') or image.width*image.height>16000000 or getattr(image,'n_frames',1)>1:
            raise ValueError()
        image.load()
        image = image.convert('RGB')
        image.thumbnail((1600,1600))
        output = BytesIO()
        image.save(output,format='JPEG',quality=82,optimize=True)
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError):
        raise InvalidReview('Choose a valid PNG, JPEG or WebP screenshot.')
    if len(output.getvalue())>1048576:
        raise InvalidReview('This screenshot is too large after processing.')
    identity = store.save_image(str(review_id),section,'screenshot.jpg',output.getvalue())
    return _response({'id':identity},201)


@require_GET
@require_access(ACCESS_CURRICULUM)
@guarded
def review_document(request,review_id):
    saved=store.read_review(review_id=str(review_id))
    if not saved:
        return _response({'error':'Review not found.'},404)
    if int(request.GET.get('version','0'))!=saved['version']:
        raise store.ReviewConflict('The saved version changed. Reopen the review to export its current PDF.')
    from .quality_review_pdf import stored_review_pdf
    content=stored_review_pdf(saved)
    response=HttpResponse(content,content_type='application/pdf')
    response['Content-Disposition']='inline; filename="portfolio-sampling-review.pdf"'
    response['Cache-Control']='private, no-store'
    response['X-Content-Type-Options']='nosniff'
    response['X-Frame-Options']='SAMEORIGIN'
    return response


@require_GET
@require_access(ACCESS_CURRICULUM)
@guarded
def review_attachment(request,review_id,version):
    saved=store.read_revision(str(review_id),version)
    if not saved:
        return _response({'error':'Saved review version not found.'},404)
    from .quality_review_pdf import stored_review_pdf
    content=stored_review_pdf(saved)
    response=HttpResponse(content,content_type='application/pdf')
    response['Content-Disposition']=f'inline; filename="quality-check-v{version}.pdf"'
    response['Cache-Control']='private, no-store'
    response['X-Content-Type-Options']='nosniff'
    response['X-Frame-Options']='SAMEORIGIN'
    return response


@require_http_methods(['GET','POST'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@guarded
def review_evidence_file(request,review_id,file_id=None):
    saved=store.read_review(review_id=str(review_id))
    if not saved:
        return _response({'error':'Save the review before attaching evidence.'},404)
    if request.method=='GET':
        evidence=store.evidence_file(str(review_id),str(file_id),preview=request.GET.get('preview')=='1') if file_id else None
        if not evidence:
            return _response({'error':'Evidence file not found.'},404)
        if request.GET.get('preview')=='1':
            if not evidence['preview']:
                return _response({'error':'This file has no image preview. Download the original file.'},404)
            response=HttpResponse(bytes(evidence['preview']),content_type='image/jpeg')
        else:
            from django.utils.http import content_disposition_header
            response=HttpResponse(bytes(evidence['content']),content_type='application/octet-stream')
            response['Content-Disposition']=content_disposition_header(True,evidence['filename'])
        response['Cache-Control']='private, no-store'
        response['X-Content-Type-Options']='nosniff'
        response['X-Frame-Options']='SAMEORIGIN'
        return response
    if file_id is not None:
        raise InvalidReview('Choose the evidence upload endpoint.')
    section=request.POST.get('section','evidence')
    definition=definition_for(saved)
    allowed={'evidence'} | {item['id'] for group in definition['sections'] for item in group['criteria'] if item['type']=='file'}
    upload=request.FILES.get('file')
    if section not in allowed or not upload or not 0<upload.size<=25*1024*1024:
        raise InvalidReview('Choose an evidence file up to 25 MB for this form.')
    from pathlib import PurePosixPath
    import re
    filename=PurePosixPath(upload.name.replace('\\','/')).name
    filename=re.sub(r'[\x00-\x1f\x7f]', '', filename)[:200] or 'evidence-file'
    content=upload.read(25*1024*1024+1)
    if len(content)!=upload.size:
        raise InvalidReview('The evidence file could not be read completely.')
    preview=None
    from PIL import Image,UnidentifiedImageError
    try:
        image=Image.open(BytesIO(content))
        if image.format in ('JPEG','PNG','WEBP') and image.width*image.height<=16000000 and getattr(image,'n_frames',1)==1:
            image.load(); image=image.convert('RGB'); image.thumbnail((1400,1400))
            output=BytesIO(); image.save(output,format='JPEG',quality=80,optimize=True)
            if len(output.getvalue())<=1048576:
                preview=output.getvalue()
    except (ValueError,OSError,UnidentifiedImageError,Image.DecompressionBombError):
        pass  # Non-image evidence is kept as opaque bytes, never rendered inline.
    metadata=store.save_evidence(str(review_id),section,filename,content,'application/octet-stream',preview)
    return _response(metadata,201)
