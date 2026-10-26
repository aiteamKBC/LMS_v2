"""Curriculum staff edit/publish the quality form; no calendar operations."""
import json
from uuid import UUID

from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from learner_api.constants import ACCESS_CURRICULUM
from login.permissions import require_access
from .quality_review_api import guarded, _response
from .quality_form_definition import clean_definition, FIELD_TYPES, InvalidReview
from .quality_review_types import review_type
from . import quality_review_store as store


@require_http_methods(['GET','PUT'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@guarded
def quality_form(request):
    kind=review_type(request.GET.get('reviewType',''))
    if request.method=='GET':
        return _response({'template':store.read_template(kind) if kind else store.read_template(),'fieldTypes':list(FIELD_TYPES)})
    if len(request.body)>250000:
        raise InvalidReview('The form definition is too large.')
    try: value=json.loads(request.body)
    except (ValueError,UnicodeDecodeError): raise InvalidReview('The form save request is invalid.')
    if not isinstance(value,dict) or set(value)!={'definition','expectedRevision','requestId','publish'}:
        raise InvalidReview('Send the definition, expected revision and save identifier.')
    if type(value['expectedRevision']) is not int or value['expectedRevision']<0 or type(value['publish']) is not bool:
        raise InvalidReview('The form revision or publication choice is invalid.')
    if not isinstance(value['requestId'],str):
        raise InvalidReview('Use a valid form save identifier.')
    request_id=str(UUID(value['requestId']))
    definition=clean_definition(value['definition'])
    if kind != definition.get('reviewType',''):
        raise InvalidReview('The form type does not match the selected MCM or PR editor.')
    saved=store.save_template(definition,expected=value['expectedRevision'],request_id=request_id,
                              actor=request.quality_actor['id'],publish=value['publish'])
    return _response({'template':saved,'fieldTypes':list(FIELD_TYPES)})
