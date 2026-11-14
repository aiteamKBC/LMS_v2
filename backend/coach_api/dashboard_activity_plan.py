"""Bounded reads of owned learners' distinct plan activities."""
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
import logging

from django.db import close_old_connections, connections
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from learner_api.journal_sources import learner_journal_reads
from learner_api.dashboard_tabs import install_request_caches
from learner_api.models import LearnerProfile
from learner_api.review_activity_facts import dashboard_activity_facts
from .auth import authenticated_coach_email, coach_access_required, normalize_email
from .views import fetch_source_schedule_rows, resolve_caseload_source_row

log = logging.getLogger(__name__)
BATCH_SIZE = 4
# One shared bound per process, rather than four new workers for every request.
_readers = ThreadPoolExecutor(max_workers=BATCH_SIZE, thread_name_prefix='coach-plan')


def activity_plan_profiles(owner_email, profile_ids):
    """Same caseload ownership/source resolution, without unrelated prefetches."""
    rows = [row for row in LearnerProfile.objects.annotate(coach_email_key=Lower(Trim('coach_email')))
            .filter(coach_email_key=normalize_email(owner_email), id__in=profile_ids)
            if str(row.username or '').strip()]
    commercial, enrolment = fetch_source_schedule_rows(rows)
    for row in rows:
        row._caseload_source = resolve_caseload_source_row(
            row, commercial_rows=commercial, enrolment_rows=enrolment)
    return rows


def plan_activity_counts(source, profile, *, as_of, include_record_counts=False):
    # Reuse Overview's assigned historical/native catalogue and identity rules.
    # Records without a catalogue card remain in the separate record count.
    install_request_caches(source)
    with learner_journal_reads():
        facts = dashboard_activity_facts(source, profile, as_of=as_of,
            **({'include_record_counts': True} if include_record_counts else {}))
    completed = total = 0
    for module in facts['modules']:
        done, planned = module['completed'], module['total']
        if (type(done) is not int or type(planned) is not int
                or not 0 <= done <= planned):
            raise ValueError('Inconsistent activity plan counts')
        completed += done
        total += planned
    result = {'completed': completed, 'total': total,
              'percent': round(completed / total * 100, 2) if total else None}
    if include_record_counts:
        result['completedRecords'] = facts['completedRecords']
    return result


@coach_access_required
@require_GET
def coach_dashboard_activity_plan(request, learner_id):
    try:
        rows = activity_plan_profiles(authenticated_coach_email(request), [learner_id])
        if len(rows) != 1 or rows[0].pk != learner_id:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        profile = rows[0]
        source = getattr(profile, '_caseload_source', None)
        if source is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        as_of = timezone.now()
        plan = plan_activity_counts(source, profile, as_of=as_of)
        response = JsonResponse({'learnerId': str(learner_id), 'activityPlan': plan,
                                 'calculatedAt': as_of.isoformat()})
        response['Cache-Control'] = 'private, no-store'
        return response
    except Exception:
        log.exception('coach_dashboard_activity_plan_unavailable')
        return JsonResponse({'error': 'Activity plan unavailable. Please retry.', 'retryable': True}, status=503)


def _read_plan(profile, as_of):
    # Match case-file parallel reads: each worker owns and releases its DB handles.
    close_old_connections()
    try:
        return plan_activity_counts(profile._caseload_source, profile, as_of=as_of)
    finally:
        connections.close_all()


@coach_access_required
@require_GET
def coach_dashboard_activity_plans(request):
    raw = request.GET.get('learnerIds', '').split(',')
    if (not 1 <= len(raw) <= BATCH_SIZE
            or any(len(value) > 19 or not value.isascii() or not value.isdecimal()
                   or not 0 < int(value) < 2**63 for value in raw)):
        return JsonResponse({'error': 'Supply up to four learner IDs.'}, status=400)
    ids = list(dict.fromkeys(map(int, raw)))
    try:
        profiles = activity_plan_profiles(authenticated_coach_email(request), ids)
    except Exception:
        log.exception('coach_dashboard_activity_plans_unavailable')
        return JsonResponse({'error': 'Activity plans unavailable. Please retry.', 'retryable': True}, status=503)
    # Re-authorise every batch, including retries. An ID in the URL is not ownership.
    owned = {p.pk: p for p in profiles if p.pk in ids and getattr(p, '_caseload_source', None) is not None}
    # Rows are materialised. Release the request's pooled handles before waiting
    # for worker reads, so concurrent coach requests cannot occupy the whole pool.
    connections.close_all()
    as_of = timezone.now()
    pending = {pk: _readers.submit(copy_context().run, _read_plan, profile, as_of) for pk, profile in owned.items()}
    results = []
    for pk in ids:
        item = {'learnerId': str(pk)}
        if pk not in pending:
            item.update(error='Learner not found.', retryable=False)
        else:
            try:
                item['activityPlan'] = pending[pk].result()
            except Exception:
                log.exception('coach_dashboard_activity_plan_unavailable')
                item.update(error='Activity plan unavailable. Please retry.', retryable=True)
        results.append(item)
    response = JsonResponse({'results': results, 'calculatedAt': as_of.isoformat()})
    response['Cache-Control'] = 'private, no-store'
    return response
