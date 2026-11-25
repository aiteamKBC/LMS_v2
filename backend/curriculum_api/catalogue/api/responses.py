"""Concrete catalogue / api / responses capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import truthy
from django.http import JsonResponse
import json


def json_body(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


def json_error(message, status=400, **extra):
    payload = {'error': message}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def curriculum_visibility(request):
    if truthy(request.GET.get('include_archived')):
        return 'all'
    visibility = str(request.GET.get('visibility') or 'operational').strip().lower()
    return 'all' if visibility == 'all' else 'operational'


def csv_param(request, *names):
    """Read a repeated-or-comma-separated query parameter."""
    values = []
    for name in names:
        for raw in request.GET.getlist(name):
            values.extend(clean_str(part) for part in str(raw).split(',') if clean_str(part))
    return values


def record_conflict_response(expected_revision, current_revision, **extra):
    """The 409 a stale guarded save is refused with.

    Deliberately not a merge and not a server-side retry. The second editor is
    the one who can see both versions and decide, so their work stays in their
    browser and the stored record travels back for them to rebase onto. Nothing
    has been written when this is returned.
    """
    if not current_revision:
        # '' means the fingerprint could not be read at all, never that the
        # record is empty -- an empty record still hashes to a real value.
        # Carrying on would run this save unchecked, which is the overwrite the
        # caller asked to be protected from by sending a revision. No record
        # travels with this refusal: nothing was compared, so there is no other
        # version to show.
        return json_error(
            'This record could not be checked against the saved version, so nothing was '
            'written. Your changes are still here - try again in a moment.',
            status=409,
            conflict=True,
            expectedRevision=expected_revision,
            currentRevision='',
        )
    return json_error(
        'Someone else saved this while you were editing it. Nothing of yours has been '
        'overwritten - your changes are being merged with theirs.',
        status=409,
        conflict=True,
        expectedRevision=expected_revision,
        currentRevision=current_revision,
        **extra,
    )


def module_merge_conflict_response(expected_revision, current_revision, conflicts):
    """The 409 for a save that changed something someone else also changed.

    Nothing has been written. Only where the clash is and what kind it is
    travel back -- not either version of the content: the editor reads the
    stored module itself, folds it in, and asks the author to choose.
    """
    def short(value):
        if isinstance(value, (bool, int, float)):
            return value
        if isinstance(value, str) and len(value) <= 200:
            return value
        return None

    return json_error(
        'Someone else changed the same thing while you were editing it, so nothing was saved. '
        'Choose which version to keep for each item, then save again. Everything you typed is still here.',
        status=409,
        conflict=True,
        mergeConflicts=[
            {
                'path': conflict.get('path'),
                'kind': conflict.get('kind') or 'value',
                'local': short(conflict.get('local')),
                'remote': short(conflict.get('remote')),
            }
            for conflict in conflicts
        ],
        expectedRevision=expected_revision,
        currentRevision=current_revision,
    )
