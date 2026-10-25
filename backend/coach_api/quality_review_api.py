"""Curriculum-only quality reviews; no Graph, AI or calendar writes."""
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
import json
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
from .quality_review_template import TEMPLATE_ID, IMAGE_SECTIONS, InvalidReview, template, validate_form


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


def context(request, learner_id):
    record, failure = _authorised_record(request)
    if failure is not None:
        return None,failure
    begin,end = session_window(record)
    if not begin or not end or end>datetime.now(timezone.utc):
        return None,_response({'error':'Choose an ended meeting to record an observation.','code':'meeting_not_ended'},409)
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
    base = {'templateId':TEMPLATE_ID,'coach':coaches.get(owner,{'email':owner,'name':owner}),
            'meeting':meeting,'learner':{'id':str(selected['id']),'name':selected['full_name'],
              'email':str(selected.get('email') or '').strip().casefold()} if selected else None}
    if selected:
        base['identity'] = store.digest([TEMPLATE_ID,owner,meeting['eventId'],meeting['startsAt'],meeting['endsAt'],str(selected['id'])])
    return {'snapshot':base,'learners':[{'id':str(row['id']),'name':row['full_name']} for row in learners]},None


def body(request):
    if len(request.body)>150000:
        raise InvalidReview('The form is too large.')
    try:
        value = json.loads(request.body)
    except (ValueError,UnicodeDecodeError):
        raise InvalidReview('The form is invalid.')
    if not isinstance(value,dict) or set(value)-{'learnerId','expectedVersion','requestId','status','form'}:
        raise InvalidReview('The save request is invalid.')
    expected = value.get('expectedVersion')
    if type(expected) is not int or expected<0:
        raise InvalidReview('The save version is invalid.')
    if not isinstance(value.get('requestId'),str):
        raise InvalidReview('The save request needs a valid request ID.')
    value['requestId'] = str(UUID(value['requestId']))
    if request.method=='PUT' and (not isinstance(value.get('form'),dict)
          or set(value['form'])!={'header','criteria','actions','images','sources'}):
        raise InvalidReview('Send the complete saved form when replacing a review.')
    value['form'] = validate_form(value.get('form'),value.get('status'))
    return value


@require_GET
@require_access(ACCESS_CURRICULUM)
@guarded
def review_context(request):
    value,failure = context(request,request.GET.get('learnerId',''))
    if failure is not None:
        return failure
    selected = value['snapshot']['learner']
    saved = store.read_review(identity=value['snapshot']['identity']) if selected else None
    return _response({'template':template(),**value,'review':saved,'observer':request.quality_actor})


@require_http_methods(['GET','POST'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@guarded
def reviews(request):
    if request.method=='GET':
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
        if not start<end or end-start>timedelta(days=366,hours=1) or not 0<=offset<=100000 or status not in ('','draft','completed') or len(search)>200:
            raise InvalidReview('Choose a valid review period and filter.')
        rows,next_offset = store.list_reviews(start,end,request.GET.get('coachEmail','').strip().casefold(),status,offset,search)
        return _response({'reviews':[{'id':str(row['id']),'coachEmail':row['coach_email'],'coachName':row['coach_name'],
          'learnerId':row['learner_id'],'learnerName':row['learner_name'],'startsAt':row['starts_at'].isoformat(),
          'status':row['status'],'version':row['version'],'updatedAt':row['updated_at'].isoformat(),
          'title':row['title'],'actionCount':row['action_count']} for row in rows], 'nextOffset':next_offset,'coaches':_coaches()})
    value = body(request)
    data,failure = context(request,value.get('learnerId',''))
    if failure is not None:
        return failure
    if not data['snapshot']['learner']:
        raise InvalidReview('Choose one learner.')
    saved = store.save_review({**data['snapshot'],'form':value['form'],'status':value['status'],
      'reviewer':request.quality_actor},expected=value['expectedVersion'],request_id=value['requestId'],actor=request.quality_actor['id'])
    return _response({'review':saved},201)


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
        snapshot = {key:saved[key] for key in ('templateId','identity','coach','meeting','learner')}
        saved = store.save_review({**snapshot,'form':value['form'],'status':value['status'],'reviewer':request.quality_actor},
          expected=value['expectedVersion'],request_id=value['requestId'],actor=request.quality_actor['id'])
    return _response({'review':saved,'template':template()})


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
    if section not in IMAGE_SECTIONS or not upload or upload.size>5*1024*1024:
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
    from .quality_review_pdf import review_pdf
    content=review_pdf(saved)
    response=HttpResponse(content,content_type='application/pdf')
    response['Content-Disposition']='inline; filename="portfolio-sampling-review.pdf"'
    response['Cache-Control']='private, no-store'
    response['X-Content-Type-Options']='nosniff'
    response['X-Frame-Options']='SAMEORIGIN'
    return response
