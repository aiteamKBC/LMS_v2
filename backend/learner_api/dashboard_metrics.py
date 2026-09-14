"""Read-only programme totals using verified legacy results and local progress."""
import json
import logging

import psycopg
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from audit_api.last_audit_ledger_views import _is_completed
from login.permissions import learner_self_or_staff
from .learner_detail import SOURCE_MODELS
from .models import TrainingPlanDocument
from .progress_rules import progress_counts_as_achieved
from .student_activity_access import student_activity_available
from .student_activity import CURRENT_SUBJECTS_SQL, _direct_progress_records, _direct_progress_otjh
from .training_plan_dashboard import find_contract, number, rows
from .otjh_totals import completed_otjh

log = logging.getLogger(__name__)


def as_json(value, default):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return default
    return value if value is not None else default


def ratio(done, total):
    return {'completed': done, 'total': total,
            'percent': round(done / total * 100, 2) if total else None,
            'status': 'ready' if total else 'empty'}


def unavailable(reason):
    return {'completed': None, 'total': None, 'percent': None,
            'status': 'unavailable', 'reason': reason}


def point_codes(value):
    """A point belongs to a component; the same code in another one counts again."""
    entries = as_json(value, [])
    if not isinstance(entries, list):
        return None
    codes = set()
    for entry in entries:
        code = (entry.get('code') or entry.get('ksbCode') or entry.get('ksb_code')) if isinstance(entry, dict) else entry
        if not isinstance(code, str) or not code.strip():
            return None
        codes.add(code.strip().upper())
    return codes


def programme_totals(historical, native, progress, attempts, links):
    """Union placements by explicit export identity and preserve any completion."""
    completed_ids = {str(item.get('componentId')) for item in progress
                     if item.get('componentId') and progress_counts_as_achieved(item.get('kind'), item.get('passed'))}
    passed_quizzes = {str(item.get('quizId')) for item in progress
                      if item.get('quizId') and progress_counts_as_achieved(item.get('kind'), item.get('passed'))}
    activities = {}
    for item in historical:
        key = (str(item['group_id']), str(item['activity_id']))
        activities[key] = activities.get(key, False) or _is_completed(item) or key in attempts
    old_complete = sum(_is_completed(item) for item in {
        (str(row['group_id']), str(row['activity_id'])): row for row in historical
    }.values())
    for item in native:
        component = str(item['id'])
        key = links.get(component, ('native', component))
        done = component in completed_ids or bool(item.get('quiz_id') and str(item['quiz_id']) in passed_quizzes)
        activities[key] = activities.get(key, False) or done
    return {**ratio(sum(activities.values()), len(activities)), 'historicalCompleted': old_complete}


def ksb_totals(native, progress, historical=None, attempts=None, links=None):
    completed_ids = {str(item.get('componentId')) for item in progress
                     if item.get('componentId') and progress_counts_as_achieved(item.get('kind'), item.get('passed'))}
    passed_quizzes = {str(item.get('quizId')) for item in progress
                      if item.get('quizId') and progress_counts_as_achieved(item.get('kind'), item.get('passed'))}
    points = {}
    old_points = {}
    missing = 0
    attempts, links = attempts or set(), links or {}
    for item in historical or []:
        key = (str(item['group_id']), str(item['activity_id']))
        codes = point_codes(item.get('ksb_mappings')) if item.get('ksb_mappings') is not None else None
        if codes is None:
            missing += 1
            continue
        done = _is_completed(item) or key in attempts
        for code in codes:
            old_points[(*key, code)] = old_points.get((*key, code), False) or _is_completed(item)
            points[(*key, code)] = points.get((*key, code), False) or done
    historical_done = sum(old_points.values())
    for item in native:
        codes = point_codes(item.get('ksb_mappings'))
        if codes is None:
            missing += 1
            continue
        key = links.get(str(item['id']), ('native', str(item['id'])))
        done = str(item['id']) in completed_ids or key in attempts or bool(item.get('quiz_id') and str(item['quiz_id']) in passed_quizzes)
        for code in codes:
            points[(*key, code)] = points.get((*key, code), False) or done
    if missing:
        return {**unavailable('activity_points_missing'), 'unmappedActivities': missing,
                'mappedCompleted': sum(points.values()), 'mappedTotal': len(points)}
    by_code = {}
    for (*_, code), done in points.items():
        counts = by_code.setdefault(code, [0, 0])
        counts[0] += bool(done)
        counts[1] += 1
    return {**ratio(sum(points.values()), len(points)), 'historicalCompleted': historical_done,
            'codes': [{'code': code, **ratio(*counts)} for code, counts in sorted(by_code.items())]}


def read_planned_hours(source, kind, cursor):
    document = (TrainingPlanDocument.objects.using('enrolment')
                .filter(learner_id=source.pk, learner_kind=kind, status=TrainingPlanDocument.STATUS_ACTIVE)
                .order_by('-created_at', '-id').values('otjh').first())
    if document is not None:
        snapshot = as_json(document['otjh'], {})
        planned = number(snapshot.get('plannedTotal')) if isinstance(snapshot, dict) else None
        if planned is not None:
            return planned
    if student_activity_available(source.aptem_id):
        contract = find_contract(cursor, int(str(source.aptem_id).strip()))
        return number(contract.get('training_plan_planned_hours')) if contract else None
    return None


def activity_planned_hours(historical, native, links):
    """Sum the assigned activity plan when a document total is unavailable."""
    planned = {}
    for item in historical:
        key = (str(item['group_id']), str(item['activity_id']))
        hours = number(item.get('expected_hours'))
        if hours is not None or key not in planned:
            planned[key] = hours
    for item in native:
        component = str(item['id'])
        key = links.get(component, ('native', component))
        hours = number(item.get('expected_hours'))
        # The current authored value wins for explicitly linked activities;
        # a missing native value can still use the exact historical mapping.
        if hours is not None or key not in planned:
            planned[key] = hours
    # A partial mapped sum must not masquerade as the whole programme target.
    if not planned or any(value is None for value in planned.values()):
        return None
    return round(sum(planned.values()), 4)


def read_metrics(source, kind):
    migrated = student_activity_available(source.aptem_id)
    direct_progress = _direct_progress_records(source.pk)
    direct_hours = _direct_progress_otjh(direct_progress)
    historical, attempts, links = [], set(), {}
    history_ready, old_hours = not migrated, 0 if not migrated else None
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(CURRENT_SUBJECTS_SQL, [source.pk])
        module_ids = [row[0] for row in cursor.fetchall()]
        cursor.execute('''SELECT c.id,c.type,c.expected_otjh AS expected_hours,coalesce(nullif(c.ksb_mappings,'[]'::jsonb),
                (SELECT jsonb_agg(jsonb_build_object('code',k.ksb_code))
                 FROM curriculum.ksb_mappings k WHERE k.component_id=c.id
                   AND (k.deleted_at IS NULL OR k.deleted_via_parent IS NOT NULL)), '[]'::jsonb) AS ksb_mappings,
                coalesce((SELECT q.quiz_id::text FROM curriculum.quiz_component_links q
                          WHERE q.component_id=c.id ORDER BY q.id LIMIT 1),
                         c.settings_json->>'linkedQuizId') AS quiz_id
            FROM curriculum.components c
            WHERE c.module_catalogue_id=ANY(%s)
              AND (c.deleted_at IS NULL OR c.deleted_via_parent IS NOT NULL)''', [module_ids])
        native = rows(cursor)
        cursor.execute('''SELECT p.component_ref AS "componentId",p.quiz_ref AS "quizId",p.kind,p.passed
            FROM "Learner".learners l JOIN "Learner".learner_progress_entries p ON p.learner_id=l.id
            WHERE l.enrolment_id=%s AND p.kind<>'activity_event' ''', [source.pk])
        # Imported completions of explicitly assigned native components remain
        # achievements too. Only OTJ hours above exclude the imported mirror.
        progress = rows(cursor)
        planned = read_planned_hours(source, kind, cursor)
        if migrated:
            aptem_id = int(str(source.aptem_id).strip())
            cursor.execute('SELECT learner_email FROM "Last_audit".learners WHERE aptem_id=%s', [aptem_id])
            identity = cursor.fetchone()
            if identity and identity[0] and source.email and identity[0].strip().casefold() != source.email.strip().casefold():
                raise ValueError('The previous learning identity could not be verified.')
            history_ready = identity is not None
            # The owner confirmed this accepted monthly ledger as the baseline.
            cursor.execute('''SELECT SUM(actual_hours) FROM structured_manual_activities.manual_learner_activities
                WHERE aptem_id=%s AND accepted=true AND deleted_at IS NULL''', [aptem_id])
            raw_hours = cursor.fetchone()[0]
            old_hours = number(raw_hours)
            if history_ready:
                cursor.execute('''SELECT gl.group_id,ga.activity_id,r.status,r.video_completed,
                    r.reading_viewed,r.quiz_passed,a.quiz_id,a.reading_type,ph.planned_hours AS expected_hours,
                    CASE WHEN nullif(a.reading_iframe_url,'') IS NOT NULL THEN 'present' ELSE '' END AS reading_iframe_url,
                    CASE WHEN jsonb_typeof(a.quiz_questions)='array' AND a.quiz_questions<>'[]'::jsonb
                         THEN '[{}]'::jsonb ELSE '[]'::jsonb END AS quiz_questions,
                    jsonb_path_query_array(CASE WHEN lk.source_preference='learner' THEN lk.ksbs ELSE ak.ksbs END,
                                           '$[*].code') AS ksb_mappings
                    FROM "Last_audit".learners l
                    JOIN "Last_audit".group_learners gl ON gl.learner_id=l.learner_id
                    JOIN "Last_audit".group_activities ga ON ga.group_id=gl.group_id
                    JOIN "Last_audit".activities a ON a.activity_id=ga.activity_id
                    LEFT JOIN structured_manual_activities.learner_activity_ksbs lk
                        ON lk.aptem_id=l.aptem_id AND lk.activity_id=ga.activity_id
                    LEFT JOIN structured_manual_activities.activity_ksbs ak ON ak.activity_id=ga.activity_id
                    LEFT JOIN "Last_audit".activity_results r ON r.learner_id=l.learner_id
                        AND r.group_id=gl.group_id AND r.activity_id=ga.activity_id
                    LEFT JOIN "Last_audit".activity_planned_hours ph ON ph.learner_id=l.learner_id AND ph.aptem_id=l.aptem_id
                        AND ph.ref=ga.activity_id::text AND ph.kind=CASE lower(coalesce(a.activity_type,r.activity_type))
                            WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio' WHEN 'reading+quiz' THEN 'reading_quiz' END
                    WHERE l.aptem_id=%s''', [aptem_id])
                # Dashboard totals use the verified audit snapshot as their
                # stable baseline. The external LMS inventory is a separate
                # view and can contain newly published, unmapped activities;
                # mixing it here changes both the denominator and KSB status.
                historical = rows(cursor)
                cursor.execute('''SELECT DISTINCT group_id,activity_id FROM "Learner".subject_activity_attempts
                    WHERE enrolment_id=%s AND aptem_id=%s AND completed=true
                      AND submitted_at IS NOT NULL''', [source.pk, aptem_id])
                attempts = {(str(group), str(activity)) for group, activity in cursor.fetchall()}
                cursor.execute('''WITH exports AS (
                    SELECT course_id,CASE WHEN jsonb_typeof(curriculum)='string'
                        THEN (curriculum #>> '{}')::jsonb ELSE curriculum END AS payload
                    FROM "MBA".course_curriculum WHERE course_id=ANY(%s))
                    SELECT course_id,material->>'source_component_id',material->>'component_id'
                    FROM exports CROSS JOIN LATERAL jsonb_array_elements(
                        CASE WHEN jsonb_typeof(payload->'sections')='array' THEN payload->'sections' ELSE '[]'::jsonb END) section
                    CROSS JOIN LATERAL jsonb_array_elements(
                        CASE WHEN jsonb_typeof(section->'materials')='array' THEN section->'materials' ELSE '[]'::jsonb END) material''',
                               [sorted({int(item['group_id']) for item in historical})])
                candidates = {}
                for group, activity, component in cursor.fetchall():
                    if component and activity:
                        candidates.setdefault(str(component), set()).add((str(group), str(activity)))
                links = {component: next(iter(keys)) for component, keys in candidates.items() if len(keys) == 1}
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''SELECT activity_id, component_ref, status, actual_time_hours,
                    full_submission->>'submissionOrigin' = 'imported_legacy' AS imported
                FROM "Learner".learning_reflection_submissions
                WHERE learner_kind=%s AND learner_id=%s AND activity_type='assignment'
                ORDER BY submitted_at NULLS FIRST,id''', [kind, str(source.pk)])
            submissions = rows(cursor)
    except (DatabaseError, psycopg.Error, StopIteration):
        # Older installations may not have reflection submissions yet.
        submissions = []
    if planned is None and history_ready:
        planned = activity_planned_hours(historical, native, links)
    actual_hours = completed_otjh(native, direct_progress, submissions, old_hours)
    new_hours = (round(actual_hours - old_hours, 4)
                 if actual_hours is not None and old_hours is not None else round(direct_hours, 4))
    return {
        'migrated': migrated,
        'programme': programme_totals(historical, native, progress, attempts, links) if history_ready
                     else unavailable('historical_activities_missing'),
        'otjh': {'historical': old_hours, 'new': new_hours,
                 'actual': actual_hours,
                 'planned': planned},
        'ksb': ksb_totals(native, progress, historical, attempts, links) if history_ready
               else unavailable('historical_activities_missing'),
    }


@require_GET
@learner_self_or_staff(kwarg='pk')
def learner_metrics(request, kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Unknown learner kind.'}, status=404)
    try:
        source = model.all_learners.only('id', 'aptem_id', 'email').get(pk=pk)
        payload = read_metrics(source, kind)
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=409)
    except DatabaseError:
        log.warning('Learner metrics unavailable for %s', pk, exc_info=True)
        return JsonResponse({'error': 'Could not load programme totals. Please try again.'}, status=503)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    return response
