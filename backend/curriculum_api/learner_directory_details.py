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
    """Count completed work within each denominator; future work cannot hide arrears."""
    due = []
    undated = 0
    for item in items:
        schedule = item.get('schedule') or {}
        if schedule.get('date_source') in {'introduction', 'extra_activity'}:
            continue
        delivery = schedule.get('delivery_week') or {}
        date = ((delivery.get('end') or schedule.get('week_end'))
                if str(schedule.get('due_timing') or '').casefold() == 'end of week'
                else schedule.get('date') or delivery.get('start'))
        try:
            day = datetime.strptime(str(date)[:10], '%Y-%m-%d').date()
        except ValueError:
            day = None
        if day is None or schedule.get('date_needs_review'):
            undated += 1
        elif day.isoformat() <= today:
            due.append(item)

    def metric(rows):
        completed = sum(bool(row['completed']) for row in rows)
        return {'completed': completed, 'total': len(rows),
                'percent': round(completed / len(rows) * 100, 1) if rows else None}

    return {'due': None if undated else metric(due), 'available': metric(items),
            'undatedActivities': undated, 'asOfDate': today, 'timeZone': str(UK)}


def learner_progress(source, profile_id, module_ids, today):
    from learner_api import canonical_learning as canonical
    from learner_api.my_learning import load_context, assemble_cards

    owner = canonical.require_profile(source.pk)
    if str(owner['id']) != str(profile_id):
        raise ServiceError('The learner identity needs review.', 'identity_review_required', 409)
    _, _, records, native, courses, definitions, done, started, hours, metadata, credits = load_context(source, owner)
    cards, _ = assemble_cards(native, metadata['current_subjects'], courses, definitions,
                             done, started, hours, metadata, records, metadata['modules'], credits,
                             include_activity_items=True)
    # Imported/replacement subjects are linked by verified identities, never titles.
    links = {**metadata['imported_courses'], **metadata['replacement_courses']}
    allowed = {f'current:{mid}' for mid in module_ids}
    allowed.update(old for current, old in links.items() if current in allowed)
    items = [item for card in cards
             if card['id'] in allowed or card.get('moduleId') in module_ids
             for item in card['_activityItems']]
    return activity_summary(items, today)


def target_rows(scope, identifier):
    from . import views
    with views.curriculum_read_scope(targeted_child_reads=True):
        return roster(scope, identifier, 'all')


@never_cache
@require_GET
@staff_only()
def progress(request):
    from . import views
    from learner_api.models import EnrolmentUser
    from learner_api.my_learning import SOURCE_FIELDS
    from learner_api.journal_sources import learner_journal_view

    scope, identifier = request.GET.get('scope', ''), request.GET.get('id', '').strip()
    ids = list(dict.fromkeys(request.GET.get('learnerIds', '').split(',')))
    if scope not in SCOPES or not identifier or len(identifier) > 200 or not 1 <= len(ids) <= 5 or any(not value.isascii() or not value.isdecimal() or len(value) > 18 for value in ids):
        return JsonResponse({'error': 'Choose a valid scope and up to five learners.'}, status=400)

    @learner_journal_view
    def read(request):
        try:
            rows = target_rows(scope, identifier)
            if rows is None:
                return JsonResponse({'error': 'This curriculum record could not be found.'}, status=404)
            by_id = {row['id']: row for row in rows}
            if any(value not in by_id for value in ids):
                return JsonResponse({'error': 'A learner is no longer in this scope. Reload the list.'}, status=409)
            with views.curriculum_read_scope(targeted_child_reads=True):
                module_ids = {str(row['module_catalogue_id']) for row in views.authoring_scope_module_rows(scope, identifier)}
            sources = {str(source.pk): source for source in EnrolmentUser.all_learners.only(*SOURCE_FIELDS).filter(
                pk__in=[by_id[value]['enrolmentId'] for value in ids if by_id[value].get('enrolmentId')])}
            today = timezone.now().astimezone(UK).date().isoformat()
            result = {}
            for value in ids:
                source = sources.get(str(by_id[value].get('enrolmentId')))
                try:
                    if source is None:
                        raise LookupError()
                    result[value] = learner_progress(source, value, module_ids, today)
                except (DatabaseError, ServiceError, LookupError):
                    result[value] = {'error': 'Progress is unavailable. Please retry or review the learner identity.'}
            return JsonResponse({'learners': result})
        except DatabaseError:
            return JsonResponse({'error': 'Progress is temporarily unavailable. Please retry.'}, status=503)
    return read(request)


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
