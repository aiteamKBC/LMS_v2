"""Scoped, demand-only progress reads and reversible programme membership edits."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from login.permissions import staff_only
from old_otjh.service import ServiceError
from .learner_directory import SCOPES, roster
from .learner_status_counts import status_key

UK = ZoneInfo('Europe/London')


def activity_summary(items, today):
    from curriculum_api.directory.domain.progress import activity_summary as implementation
    return implementation(items, today, UK=UK)


def learner_progress(source, profile_id, module_ids, today):
    from curriculum_api.directory.application.progress import learner_progress as implementation
    from learner_api import canonical_learning as canonical
    from learner_api.my_learning import load_context, assemble_cards
    return implementation(source, profile_id, module_ids, today, require_profile=canonical.require_profile,
        load_context=load_context, assemble_cards=assemble_cards,
        activity_summary=activity_summary, ServiceError=ServiceError,
    )


def target_rows(scope, identifier):
    from . import views
    with views.curriculum_read_scope(targeted_child_reads=True):
        return roster(scope, identifier, 'all')


@never_cache
@require_GET
@staff_only()
def progress(request):
    from curriculum_api.directory.api.progress import progress as implementation
    from . import views
    from learner_api.models import EnrolmentUser
    from learner_api.my_learning import SOURCE_FIELDS
    from learner_api.journal_sources import learner_journal_view
    from learner_api.identity_placement.public import with_placements
    from .directory.application.progress import read_progress
    from .directory.infrastructure.registration_reads import progress_sources
    def module_ids(scope, identifier):
        with views.curriculum_read_scope(targeted_child_reads=True):
            return {str(row['module_catalogue_id']) for row in views.authoring_scope_module_rows(scope, identifier)}
    def sources(enrolment_ids):
        return progress_sources(enrolment_ids, EnrolmentUser=EnrolmentUser,
                                SOURCE_FIELDS=SOURCE_FIELDS, with_placements=with_placements)
    def read(scope, identifier, ids):
        return read_progress(
            scope, identifier, ids, target_rows=target_rows, read_module_ids=module_ids,
            read_sources=sources, current_date=lambda: timezone.now().astimezone(UK).date().isoformat(),
            learner_progress=learner_progress, DatabaseError=DatabaseError, ServiceError=ServiceError,
        )
    return implementation(request, SCOPES=SCOPES, JsonResponse=JsonResponse, DatabaseError=DatabaseError,
        learner_journal_view=learner_journal_view, read_progress=read,
    )


@never_cache
@require_POST
@staff_only()
def membership(request):
    """Change only status columns; never rebuild plans, history or integrations."""
    from learner_api.models import EnrolmentUser, LearnerProfile
    from . import views
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        payload = None
    if not isinstance(payload, dict):
        return JsonResponse({'error': 'Send a valid membership action.'}, status=400)
    scope, identifier = payload.get('scope'), payload.get('id')
    learner_id, action = str(payload.get('learnerId') or ''), payload.get('action')
    if not isinstance(scope, str) or scope not in SCOPES or not isinstance(identifier, str) or not identifier or len(identifier) > 200 or not learner_id.isascii() or not learner_id.isdecimal() or len(learner_id) > 18 or not isinstance(action, str) or action not in {'remove', 'restore'}:
        return JsonResponse({'error': 'Choose a valid scope, learner and action.'}, status=400)
    try:
        rows = target_rows(scope, identifier)
        member = next((row for row in rows or [] if row['id'] == learner_id), None)
        if member is None or not member.get('enrolmentId'):
            return JsonResponse({'error': 'This learner membership could not be verified. Reload the list.'}, status=404)
        with transaction.atomic(using='enrolment'):
            source = EnrolmentUser.all_learners.select_for_update().filter(pk=member['enrolmentId']).first()
            profile = LearnerProfile.objects.using('enrolment').select_for_update().filter(pk=learner_id, enrolment_id=member['enrolmentId']).first()
            if source is None or profile is None:
                return JsonResponse({'error': 'The learner identity needs review.'}, status=409)
            # A stale screen must not withdraw a learner from a newly assigned programme.
            if not isinstance(payload.get('expectedProgramme'), str) or payload['expectedProgramme'].strip() != str(member['programme']).strip() or str(source.programme or '').strip() != str(member['programme']).strip() or str(profile.programme or '').strip() != str(member['programme']).strip():
                return JsonResponse({'error': 'The learner programme changed. Reload the list.'}, status=409)
            current = status_key(source.programme_status)
            expected = status_key(payload.get('expectedStatus'))
            if not expected or current != expected or status_key(profile.lifecycle_status or profile.programme_status) != expected:
                return JsonResponse({'error': 'The learner status changed. Reload the list before trying again.'}, status=409)
            if (action == 'restore' and current != 'withdrawn') or (action == 'remove' and current not in {'active', 'on break'}):
                return JsonResponse({'error': 'This action is not available for the current programme status.'}, status=409)
            status = 'Withdrawn' if action == 'remove' else 'Active'
            source.programme_status = status
            source.save(using='enrolment', update_fields=['programme_status'])
            profile.programme_status = status
            profile.lifecycle_status = status.lower()
            profile.save(using='enrolment', update_fields=['programme_status', 'lifecycle_status', 'updated_at'])
        views.invalidate_curriculum_cache()
        return JsonResponse({'learnerId': learner_id, 'status': status.lower()})
    except DatabaseError:
        return JsonResponse({'error': 'Could not update programme membership. Please retry.'}, status=503)
