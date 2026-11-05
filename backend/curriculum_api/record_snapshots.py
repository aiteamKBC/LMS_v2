"""The stored record a drawer edits, read together with its revision token.

``/curriculum/revisions/`` hands a drawer a fresh token when it opens, but the
drawer's fields were filled from the curriculum overview -- a cached payload
that can be seconds (or, in a tab left in the background, minutes) behind the
table. A fresh token paired with stale fields is the one combination the guard
cannot see through: the save carries the current revision, so it is accepted,
and it writes back every value the reader was shown -- a colleague's whole save
undone by somebody who changed nothing.

So the drawer asks for the record and the token in one read and fills its
fields from that. The token is read FIRST. A write landing between the two
reads then leaves a token older than the record, and the save is refused and
merged -- the safe direction. The other order would let it overwrite.
"""

import logging

from django.http import JsonResponse
from django.views.decorators.http import require_GET

from . import views

logger = logging.getLogger(__name__)


def _module_record(identifier):
    # The record the module PATCH hands back on a refusal, so the drawer merges
    # a snapshot and a refusal through one shape.
    module_catalogue_id = views.resolve_stored_module_catalogue_id(identifier) or identifier
    return views.curriculum_module_from_authoring_payload(
        views.get_authoring_structure_payload(module_catalogue_id)
    )


#: The drawer-authored fields of each kind -- the same builders a 409 uses.
SNAPSHOT_READERS = {
    'programme': views.programme_conflict_record,
    'cohort': views.cohort_conflict_record,
    'group': views.group_conflict_record,
    'module': _module_record,
}


@require_GET
def curriculum_record_snapshot(request):
    """``?kind=cohort&id=COHORT-1`` -> ``{"revision": "...", "record": {...}}``.

    ``revision`` '' with no record means the record cannot be fingerprinted;
    the drawer saves unguarded, as it always has for such a record. A token
    that was read while the record could not be is answered 503 instead: a
    token with nothing to pair it with is the stale pairing this exists to
    prevent, and the drawer treats a failed read as "do not save unchecked".
    """
    kind = views.clean_str(request.GET.get('kind'))
    identifier = views.clean_str(request.GET.get('id'))
    read = SNAPSHOT_READERS.get(kind)
    if not read or not identifier:
        return views.json_error('Name a programme, cohort, group or module to read.', status=400)
    revision = views.curriculum_record_revision(kind, identifier)
    if not revision:
        return JsonResponse({'kind': kind, 'id': identifier, 'revision': '', 'record': None})
    try:
        record = read(identifier)
    except Exception:
        logger.warning('Unable to read the stored %s %s.', kind, identifier, exc_info=True)
        record = None
    if not record:
        return views.json_error(
            'The saved version of this record could not be read. Try again in a moment.',
            status=503,
        )
    return JsonResponse({'kind': kind, 'id': identifier, 'revision': revision, 'record': record})
