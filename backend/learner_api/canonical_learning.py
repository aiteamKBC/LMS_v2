"""Shared reads of the consolidated learning record.

Source snapshots are lineage, not additional hours. Reads never sync, run AI,
repair data, or create records. Route identities are verified before reading.
"""
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo
import re

from old_otjh.repository import query
from old_otjh.service import ServiceError
from .monthly_log_sources import decoded, number, row
from .current_learning import current_records, current_records_bulk

UK = ZoneInfo('Europe/London')


def is_legacy_record(record):
    """Return the row's lineage classification, never its counting policy."""
    return str(record.get('source_system') or '').strip().casefold() == 'old_lms'


def counts_as_actual(record):
    """Accepted canonical rows count regardless of their source lineage.

    Duplicate source observations are removed by ``canonical_activity_key`` in
    the SSOT query.  ``source_system`` says where the surviving canonical row
    came from; it is not a reason to throw that learner evidence away.
    """
    return record.get('accepted') is True


def enabled(learner_id):
    return profile(learner_id) is not None


def require_profile(learner_id):
    """Resolve the SSOT owner or fail closed; learner pages have no legacy fallback."""
    owner = profile(learner_id)
    if owner is None:
        raise ServiceError(
            'The learner is not linked to the consolidated learning record.',
            'ssot_identity_required',
            409,
        )
    return owner


def profile(learner_id):
    records = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=%s''', [learner_id])
    if not records:
        return None
    if len(records) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return _validated_profile(records[0])


def _validated_profile(owner):
    email = str(owner.get('email') or '').strip().casefold()
    account_email = str(owner.get('account_email') or '').strip().casefold()
    aptem = str(owner.get('account_aptem_id') or '').strip().lstrip('0')
    if (owner.get('account_record_id') is None or not email or email != account_email
            or (aptem and aptem != str(owner.get('aptem_id') or '').lstrip('0'))):
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return owner


def profile_by_aptem(aptem_id):
    """For already-authorized Audit callers; never use an Aptem ID as a PK."""
    records = query('''SELECT id,enrolment_id,aptem_id,programme_id,full_name AS name,
        programme,coach_name,coach_email,email,start_date,end_date,learner_type
        FROM "Learner".learners WHERE aptem_id=%s''', [aptem_id])
    if len(records) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return records[0]


def entries(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    return entries_for(owner)


def entries_for(owner):
    records = query('''WITH candidates AS (
        SELECT progress.*,
            row_number() OVER (
                PARTITION BY coalesce(nullif(progress.canonical_activity_key,''),concat('progress:',progress.id))
                ORDER BY progress.actual_seconds DESC NULLS LAST,progress.id
            ) AS canonical_rank
        FROM "Learner".learner_progress_entries progress
        WHERE progress.learner_id=%s AND progress.deleted_at IS NULL
    ), canonical AS (
        SELECT * FROM candidates WHERE canonical_rank=1
    )
        SELECT to_jsonb(p) AS payload,
        coalesce((SELECT jsonb_agg(k.ksb_code ORDER BY k.position)
          FROM "Learner".learner_progress_ksbs k WHERE k.progress_id=p.id),'[]'::jsonb) AS ksbs,
        coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.segment_order,s.id)
          FROM "Learner".learner_activity_reporting_segments s
          WHERE s.progress_id=p.id AND s.learner_id=p.learner_id),'[]'::jsonb) AS segments,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
            'source_id',s.id,'source_system',s.source_system,'source_activity_id',s.source_activity_id,
            'source_course_ref',c.source_course_ref,'source_course_id',c.id,
            'course_title',c.source_course_title,'catalogue_id',a.id,
            'component_ref',coalesce(nullif(s.curriculum_component_ref,''),a.curriculum_component_ref),
            'module_ref',c.curriculum_module_ref,'group_ref',c.curriculum_group_ref,
            'source_activity_kind',a.source_activity_kind) ORDER BY s.id)
          FROM "Learner".learner_activity_sources s
          LEFT JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id AND a.deleted_at IS NULL
          LEFT JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
          WHERE s.canonical_progress_id=p.id AND s.learner_id=p.learner_id
            AND s.deleted_at IS NULL),'[]'::jsonb) AS sources,
        coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id)
          FROM "Learner".learner_progress_historical_components link
          JOIN curriculum.historical_components h ON h.id=link.historical_component_ref
            AND h.deleted_at IS NULL AND h.historical_only=true
          WHERE link.progress_id=p.id),'[]'::jsonb) AS historical_components
        FROM canonical p
        ORDER BY p.reporting_month,p.reporting_started_at NULLS LAST,p.id''',
        [owner['id']])
    return current_records(owner, [{**decoded(record['payload'], {}), **{
        field: decoded(record.get(field), [])
        for field in ('ksbs', 'segments', 'sources', 'historical_components')}} for record in records])


def allocations(entry):
    """Segments replace the parent's allocation; source observations never add time."""
    segments = entry.get('segments') or []
    if not segments:
        return [entry]
    return [{**entry, **{key: segment.get(key) for key in (
        'actual_seconds', 'reporting_month', 'reporting_started_at', 'reporting_ended_at')},
        'segment_id': segment['id']} for segment in segments]


def recorded_seconds(entry):
    return sum(number(part.get('actual_seconds')) for part in allocations(entry))


def local_instant(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.astimezone(UK) if value else None


def activity_rows(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    return rows_for(owner)


def rows_for(owner, records=None):
    result = []
    for entry in (part for record in (records if records is not None else entries_for(owner)) for part in allocations(record)):
        source = decoded(entry.get('source_payload'), {})
        at = local_instant(entry.get('reporting_started_at') or entry.get('reporting_ended_at'))
        ref = f"canonical:{entry['id']}"
        if entry.get('segment_id') is not None:
            ref += f":segment:{entry['segment_id']}"
        item = row(ref, at, entry.get('component_title'),
                   (entry.get('component_type') or entry.get('kind') or 'Learning').replace('_', ' ').title(),
                   hours=number(entry.get('actual_seconds')) / 3600,
                   planned=entry.get('expected_otjh') if entry.get('expected_otjh') is not None else source.get('planned_hours'),
                   note=source.get('completion_note') or entry.get('feedback'),
                   group=entry.get('module_title') or entry.get('group_title'), ksbs=entry['ksbs'])
        item.update(accepted=entry.get('accepted') is True,
                    source_system=entry.get('source_system'),
                    reporting_month=entry.get('reporting_month'),
                    timestamp_label=entry.get('reporting_timestamp_label') or source.get('timestamp_label') or '',
                    actual_hours_recorded=entry.get('actual_seconds') is not None,
                    progress_id=entry['id'])
        result.append(item)
    by_id = {}
    for item in result:
        by_id.setdefault(item['progress_id'], []).append(item)
    documents = query('''SELECT id,progress_id,display_name,content_type
        FROM "Learner".learner_activity_documents
        WHERE learner_id=%s AND deleted_at IS NULL ORDER BY id''', [owner['id']])
    for document in documents:
        for item in by_id.get(document['progress_id'], []):
            item['documents'].append({'id': document['id'], 'display_name': document['display_name'],
                'content_type': document['content_type'],
                'url': f"/learner_api/monthly-logs/{owner['enrolment_id']}/canonical-documents/{document['id']}/" if owner.get('enrolment_id') else None})
    return result


def targets(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return {}
    return targets_for(owner)


def targets_for(owner):
    """Return one exact Training Plan target per month for this enrolment."""
    return {record['report_month']: float(record['target_hours']) for record in query('''
        SELECT DISTINCT ON (report_month) report_month,target_hours
        FROM "Learner".learner_monthly_targets
        WHERE learner_id=%s
          AND coalesce(programme_profile_id,'')=''
          AND (enrolment_id IS NULL OR enrolment_id IS NOT DISTINCT FROM %s)
          AND (programme_id IS NULL OR programme_id IS NOT DISTINCT FROM %s)
        ORDER BY report_month,
          (enrolment_id IS NOT DISTINCT FROM %s) DESC,
          (programme_id IS NOT DISTINCT FROM %s) DESC,
          updated_at DESC,id DESC''', [
            owner['id'], owner.get('enrolment_id'), owner.get('programme_id'),
            owner.get('enrolment_id'), owner.get('programme_id'),
        ]) if record['target_hours'] is not None}


def curriculum_module_ids_for(owner):
    """Current curriculum module ids linked through the consolidated source catalogue."""
    return [record['module_id'] for record in query('''
        SELECT DISTINCT c.curriculum_module_ref AS module_id
        FROM "Learner".learner_source_course_memberships membership
        JOIN curriculum.source_courses c ON c.id=membership.source_course_id
        WHERE membership.learner_id=%s AND membership.deleted_at IS NULL
          AND c.deleted_at IS NULL AND nullif(c.curriculum_module_ref,'') IS NOT NULL
        ORDER BY c.curriculum_module_ref''', [owner['id']])]


def otjh_activities(records):
    """Project the complete accepted SSOT ledger for the OTJ activity log."""
    result = []
    for record in records:
        if not counts_as_actual(record):
            continue
        parts = allocations(record)
        for index, part in enumerate(parts):
            seconds = number(part.get('actual_seconds'))
            if seconds <= 0:
                continue
            at = local_instant(part.get('reporting_started_at') or part.get('reporting_ended_at'))
            result.append({
                'id': f"{record['id']}:{part.get('segment_id') or 0}",
                'kind': record.get('kind') or 'learning',
                'componentId': record.get('curriculum_component_ref') or record.get('component_ref'),
                'quizId': record.get('quiz_ref'),
                'componentTitle': record.get('component_title') or 'Activity',
                'componentType': record.get('component_type') or record.get('kind') or 'learning',
                'moduleTitle': record.get('module_title') or record.get('group_title'),
                'actualSeconds': seconds,
                'expectedOtjh': record.get('expected_otjh') if index == 0 else None,
                'submittedAt': at.isoformat() if at else None,
                'passed': record.get('passed'),
                'ksbs': list(record.get('ksbs') or []),
            })
    return result


def signatures(learner_id):
    owner = profile(learner_id)
    if owner is None:
        return []
    return signatures_for(owner)


def signatures_for(owner):
    return query('''SELECT report_month,signer_role,signer_name,signed_at,snapshot_digest AS snapshot_hash,
        coalesce(signature_url,signature_data) AS url
        FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND review_confirmed IS TRUE ORDER BY signed_at DESC,id DESC''', [owner['id']])


def content(item):
    note = item.get('completion_note')
    return {'id': item['id'], 'parts': [{'id': item['id'], 'title': item['title'],
        'category': item['category'], 'url': None, 'quiz': None,
        'html': f'<p>{escape(note)}</p>' if note else '<p>No additional activity text was recorded.</p>'}]}


def source_subjects(learner_id, summarize):
    """Recorded learner activities, with full catalogue counts kept separate."""
    owner = profile(learner_id)
    if owner is None:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    courses = query('''SELECT DISTINCT c.id,c.source_course_ref,c.source_course_title,c.curriculum_module_ref
        FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_courses c ON c.id=m.source_course_id AND c.deleted_at IS NULL
        WHERE m.learner_id=%s AND m.deleted_at IS NULL AND c.source_system='old_lms'
          AND c.source_course_ref ~ '^[0-9]+$'
        ORDER BY c.source_course_title,c.id''', [owner['id']])
    catalogue = query('''SELECT a.id,a.source_course_id,a.source_activity_id,a.source_activity_kind,
        a.source_activity_title,a.source_activity_type,a.source_section_title,a.curriculum_component_ref,
        c.source_course_ref,c.source_course_title,c.curriculum_module_ref,a.source_position AS position
        FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
        WHERE a.source_course_id=ANY(%s) AND a.deleted_at IS NULL
          AND a.source_system='old_lms'
        ORDER BY c.id,a.source_position NULLS LAST,a.id''', [[c['id'] for c in courses]]) if courses else []
    records = entries_for(owner)
    items, subjects, links = recorded_course_items(courses, catalogue, records)
    result = {'source': 'canonical', 'source_status': 'historical',
        'progress_basis': 'recorded_activities',
        'learner_name': owner['name'], 'aptem_id': owner['aptem_id'],
        'subjects': subjects, **summarize(items)}
    total = round(sum(recorded_seconds(r) for r in records if counts_as_actual(r)) / 3600, 4)
    result.update(recorded_otjh_total=total, audit_lms_actual=total,
        audit_ksb_evidenced=len({k for r in records if counts_as_actual(r) for k in r['ksbs']}),
        direct_otjh_activities=[], canonical_otjh_activities=otjh_activities(records))
    result['activity_sources'] = {key: values[0] for key, values in links.items() if len(values) == 1}
    result['activity_source_issues'] = {key: 'ambiguous_lineage' for key, values in links.items() if len(values) != 1}
    canonical_modules = {
        str(record.get('module_ref') or record.get('module_title') or '').strip()
        for record in records
        if str(record.get('module_ref') or record.get('module_title') or '').strip()
    }
    result['module_count'] = max(len(subjects), len(canonical_modules))
    result['unresolved_source_routes'] = sum(len(values) != 1 for values in links.values())
    monthly_targets = targets_for(owner)
    result['audit_tp_planned'] = sum(monthly_targets.values()) if monthly_targets else None
    return result


def recorded_course_items(courses, catalogue, records):
    """Allocate a final record once per course, using exact catalogue lineage.

    Historical/component guesses do not substitute for learner source links.
    A quiz and material sharing a numeric ID remain distinct activities.
    """
    definitions = {(str(d['source_course_ref']), d['source_activity_id']): d for d in catalogue}
    by_course = {str(c['source_course_ref']): [] for c in courses}
    links = {}
    for record in records:
        placements = {}
        for source in record.get('sources') or []:
            key = (str(source.get('source_course_ref')), source.get('source_activity_id'))
            if source.get('source_system') == 'old_lms' and key in definitions:
                placements.setdefault(key[0], definitions[key])
        # Imported journal rows and new attempts retain a typed course/material
        # reference in the consolidated payload. Explicit source links take
        # precedence, even when their course is outside this learner's catalogue.
        has_source_route = any(s.get('source_system') == 'old_lms'
            and s.get('source_course_ref') and s.get('source_activity_id')
            for s in record.get('sources') or [])
        if not has_source_route:
            ref = str(decoded(record.get('source_payload'), {}).get('original_source_ref') or '')
            match = re.fullmatch(r'la:(\d+):(\d+)', ref)
            key = (match[1], 'material:' + match[2]) if match else None
            if key in definitions:
                placements.setdefault(key[0], definitions[key])
        for course, definition in placements.items():
            kind, _, ident = definition['source_activity_id'].partition(':')
            numeric = ident.isdigit()
            at = local_instant(record.get('reporting_started_at') or record.get('reporting_ended_at'))
            accepted = counts_as_actual(record)
            item = {'activity_id': f"record:{course}:{record['id']}",
                'source_activity_id': int(ident) if numeric else 0, 'group_id': int(course),
                'group_name': definition['source_course_title'],
                'activity': record.get('component_title') or definition['source_activity_title'],
                'category': definition.get('source_activity_type') or kind,
                'catalogue_kind': kind, 'can_open_material': numeric and kind == 'material',
                'section_title': definition.get('source_section_title'),
                'position': definition.get('position') or 0,
                'date': at.date().isoformat() if at else None,
                'month': record.get('reporting_month'), 'date_source': 'consolidated_record',
                'completed': record.get('completed', accepted) is True,
                'historical_completed': accepted,
                'actual': recorded_seconds(record) / 3600 if accepted else 0,
                'hours_mapped': accepted and any(p.get('actual_seconds') is not None for p in allocations(record)),
                'planned': 0, 'planned_hours_mapped': False, 'has_result': True,
                'status': record.get('activity_status'),
                'quiz_score': float(record['achieved_score']) if record.get('achieved_score') is not None else None,
                'quiz_maximum_score': float(record['total_score']) if record.get('total_score') is not None else None}
            by_course[course].append(item)
            component = definition.get('curriculum_component_ref')
            module = definition.get('curriculum_module_ref')
            if component and module and item['can_open_material']:
                link = {'module_id': module, 'group_id': int(course), 'activity_id': int(ident)}
                if link not in links.setdefault(component, []):
                    links[component].append(link)
    subjects, items = [], []
    for course in courses:
        ref = str(course['source_course_ref'])
        activity = by_course[ref]
        if not activity:
            continue
        subjects.append({'id': int(ref), 'name': course['source_course_title'],
            'module_id': course.get('curriculum_module_ref'),
            'catalogue_count': sum(str(d['source_course_ref']) == ref for d in catalogue),
            'accepted_hours': round(sum(a['actual'] for a in activity), 6)})
        items.extend(activity)
    return items, subjects, links


def _metrics_from_records(records, monthly_targets):
    """Count final activity records once, using accepted evidence only for hours.

    KSB points retain the shared activity/code definition; they are not a claim
    that the learner has achieved the entire programme's KSB framework.
    """
    counted = list(records)
    accepted = [item for item in counted if counts_as_actual(item)]
    completed = [item for item in counted if item.get('completed', item.get('accepted')) is True]
    def ratio(done, total):
        return {'completed': done, 'total': total,
                'percent': round(done / total * 100, 2) if total else None,
                'status': 'ready' if total else 'empty'}
    codes = {}
    for item in counted:
        for code in set(item.get('ksbs') or []):
            counts = codes.setdefault(code, [0, 0])
            counts[0] += counts_as_actual(item)
            counts[1] += 1
    actual = round(sum(recorded_seconds(item) for item in accepted) / 3600, 4)
    planned = round(sum(monthly_targets.values()), 4) if monthly_targets else None
    return {
        'migrated': True, 'aptem_planned_total': planned,
        'programme': {**ratio(len(completed), len(counted)), 'historicalCompleted': len(accepted)},
        'otjh': {'historical': actual, 'new': 0, 'actual': actual,
                 'completed_actual': actual, 'planned': planned},
        'ksb': {**ratio(sum(v[0] for v in codes.values()), sum(v[1] for v in codes.values())),
                'historicalCompleted': sum(v[0] for v in codes.values()),
                'codes': [{'code': code, **ratio(*counts)} for code, counts in sorted(codes.items())]},
        '_ksb_evidence_sources': [],
    }


def metrics(learner_id):
    owner = require_profile(learner_id)
    return _metrics_from_records(entries_for(owner), targets_for(owner))


def metrics_bulk(learner_ids):
    """Return canonical metrics for a caseload without per-learner queries.

    Keys present with ``None`` identify a canonical record that failed identity
    validation.  Callers must not fall back to a different identity source for
    those learners; this preserves the single-learner fail-closed behaviour.
    """
    enrolment_ids = list(dict.fromkeys(
        int(value) for value in (learner_ids or []) if value is not None
    ))
    if not enrolment_ids:
        return {}

    owners = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=ANY(%s)''', [enrolment_ids])
    owner_candidates = {}
    for owner in owners:
        owner_candidates.setdefault(int(owner['enrolment_id']), []).append(owner)

    result = {enrolment_id: None for enrolment_id in owner_candidates}
    valid_owners = {}
    for enrolment_id, candidates in owner_candidates.items():
        if len(candidates) != 1:
            continue
        try:
            valid_owners[enrolment_id] = _validated_profile(candidates[0])
        except ServiceError:
            continue
    if not valid_owners:
        return result

    learner_profile_ids = [int(owner['id']) for owner in valid_owners.values()]
    progress_rows = query('''WITH candidates AS (
        SELECT p.*,
          row_number() OVER (
            PARTITION BY p.learner_id,coalesce(nullif(p.canonical_activity_key,''),concat('progress:',p.id))
            ORDER BY p.actual_seconds DESC NULLS LAST,p.id
          ) AS canonical_rank
        FROM "Learner".learner_progress_entries p
        WHERE p.learner_id=ANY(%s) AND p.deleted_at IS NULL
    )
        SELECT p.learner_id AS owner_id,p.id,p.kind,
        p.module_title,p.component_ref,p.component_title,p.component_type,p.quiz_ref,
        p.passed,p.feedback,p.reported_time,p.submitted_at,p.started_at,
        p.time_tracking_source,p.claimed_seconds,p.verified_seconds,p.expected_otjh,
        p.source_system,p.component_link_source,p.actual_seconds,p.accepted,
        p.reporting_started_at,p.reporting_ended_at,p.reporting_month,
        p.achieved_score,p.total_score,p.activity_status,
        CASE WHEN p.source_payload ? 'original_source_ref'
             THEN jsonb_build_object('original_source_ref',p.source_payload->>'original_source_ref')
             ELSE '{}'::jsonb END AS source_payload
        FROM candidates p
        WHERE p.canonical_rank=1
        ORDER BY p.learner_id,p.reporting_month,p.reporting_started_at NULLS LAST,p.id''',
        [learner_profile_ids])
    records_by_learner = {profile_id: [] for profile_id in learner_profile_ids}
    records_by_progress = {}
    for payload in progress_rows:
        owner_id = int(payload.pop('owner_id'))
        payload.update(ksbs=[], segments=[], sources=[], historical_components=[])
        records_by_learner.setdefault(owner_id, []).append(payload)
        records_by_progress[int(payload['id'])] = payload

    progress_ids = list(records_by_progress)
    if progress_ids:
        for item in query('''SELECT progress_id,ksb_code
            FROM "Learner".learner_progress_ksbs
            WHERE progress_id=ANY(%s) ORDER BY progress_id,position''', [progress_ids]):
            record = records_by_progress.get(int(item['progress_id']))
            if record is not None:
                record['ksbs'].append(item['ksb_code'])
        for item in query('''SELECT progress_id,to_jsonb(s) AS payload
            FROM "Learner".learner_activity_reporting_segments s
            WHERE progress_id=ANY(%s) ORDER BY progress_id,segment_order,id''', [progress_ids]):
            record = records_by_progress.get(int(item['progress_id']))
            if record is not None:
                record['segments'].append(decoded(item['payload'], {}))
        for item in query('''SELECT s.canonical_progress_id AS progress_id,
            s.id AS source_id,s.source_system,s.source_activity_id,
            c.source_course_ref,c.id AS source_course_id,
            c.source_course_title AS course_title,a.id AS catalogue_id,
            coalesce(nullif(s.curriculum_component_ref,''),a.curriculum_component_ref) AS component_ref,
            c.curriculum_module_ref AS module_ref,c.curriculum_group_ref AS group_ref,
            a.source_activity_kind
            FROM "Learner".learner_activity_sources s
            LEFT JOIN curriculum.source_activities a
              ON a.id=s.source_catalog_activity_id AND a.deleted_at IS NULL
            LEFT JOIN curriculum.source_courses c
              ON c.id=a.source_course_id AND c.deleted_at IS NULL
            WHERE s.canonical_progress_id=ANY(%s) AND s.deleted_at IS NULL
            ORDER BY s.canonical_progress_id,s.id''', [progress_ids]):
            progress_id = int(item.pop('progress_id'))
            record = records_by_progress.get(progress_id)
            if record is not None:
                record['sources'].append(item)
        for item in query('''SELECT link.progress_id,to_jsonb(h) AS payload
            FROM "Learner".learner_progress_historical_components link
            JOIN curriculum.historical_components h ON h.id=link.historical_component_ref
              AND h.deleted_at IS NULL AND h.historical_only=true
            WHERE link.progress_id=ANY(%s) ORDER BY link.progress_id,h.id''', [progress_ids]):
            record = records_by_progress.get(int(item['progress_id']))
            if record is not None:
                record['historical_components'].append(decoded(item['payload'], {}))

    current_by_enrolment = current_records_bulk(valid_owners.values(), records_by_learner)
    target_rows = query('''SELECT DISTINCT ON (t.learner_id,t.report_month)
        t.learner_id,t.report_month,t.target_hours
        FROM "Learner".learner_monthly_targets t
        JOIN "Learner".learners l ON l.id=t.learner_id
        WHERE t.learner_id=ANY(%s) AND coalesce(t.programme_profile_id,'')=''
          AND (t.enrolment_id IS NULL OR t.enrolment_id IS NOT DISTINCT FROM l.enrolment_id)
          AND (t.programme_id IS NULL OR t.programme_id IS NOT DISTINCT FROM l.programme_id)
        ORDER BY t.learner_id,t.report_month,
          (t.enrolment_id IS NOT DISTINCT FROM l.enrolment_id) DESC,
          (t.programme_id IS NOT DISTINCT FROM l.programme_id) DESC,
          t.updated_at DESC,t.id DESC''', [learner_profile_ids])
    targets_by_learner = {profile_id: {} for profile_id in learner_profile_ids}
    for target in target_rows:
        if target.get('target_hours') is not None:
            targets_by_learner.setdefault(int(target['learner_id']), {})[target['report_month']] = float(target['target_hours'])

    for enrolment_id, owner in valid_owners.items():
        result[enrolment_id] = _metrics_from_records(
            current_by_enrolment.get(enrolment_id, []),
            targets_by_learner.get(int(owner['id']), {}),
        )
    return result


def overlay_subjects(payload, records, summarize):
    """Use canonical progress, retaining owned course/material definitions.

    Match explicit namespaced course/activity lineage or a verified Curriculum
    component. Titles and unscoped numeric IDs are not links.
    """
    component_placements = {}
    for item in payload['activities']:
        if item.get('curriculum_component_ref'):
            component_placements.setdefault(item['curriculum_component_ref'], set()).add(
                (int(item['group_id']), int(item['source_activity_id'])))
    mapped = {}
    for record in records:
        keys = set()
        component = record.get('curriculum_component_ref') or record.get('component_ref')
        candidates = component_placements.get(component, set())
        if len(candidates) == 1:
            keys.update(candidates)
        for link in [*(record.get('sources') or []), *(record.get('historical_components') or [])]:
            course = str(link.get('source_course_ref') or '')
            activity = re.fullmatch(r'material:(\d+)', str(link.get('source_activity_id') or ''))
            if link.get('source_system') == 'old_lms' and course.isdigit() and activity:
                keys.add((int(course), int(activity[1])))
            component = link.get('component_ref') or link.get('curriculum_component_ref')
            candidates = component_placements.get(component, set())
            if len(candidates) == 1:
                keys.update(candidates)
        source = decoded(record.get('source_payload'), {})
        match = re.fullmatch(r'la:(\d+):(\d+)', str(source.get('original_source_ref') or ''))
        key = (int(match[1]), int(match[2])) if match else None
        if not keys and key:
            keys.add(key)
        for key in keys:
            mapped.setdefault(key, []).append(record)
    items = []
    for original in payload['activities']:
        item = dict(original)
        matches = mapped.get((int(item['group_id']), int(item['source_activity_id'])), [])
        # Definitions remain available for learning, but imported results must
        # not override the final consolidated status/hours for this rollout.
        item.update(completed=False, historical_completed=False, has_result=bool(matches),
                    actual=0, hours_mapped=False, quiz_score=None, quiz_maximum_score=None,
                    best_score_percent=None, status='Not started')
        if matches:
            latest = max(matches, key=lambda r: (r.get('reporting_month') or '',
                         str(r.get('reporting_ended_at') or r.get('reporting_started_at') or ''), str(r['id'])))
            accepted = [r for r in matches if counts_as_actual(r)]
            recorded = [r for r in accepted if any(part.get('actual_seconds') is not None for part in allocations(r))]
            at = local_instant(latest.get('reporting_started_at') or latest.get('reporting_ended_at'))
            item.update(completed=any(r.get('completed', r.get('accepted')) is True for r in matches),
                        historical_completed=bool(accepted),
                        actual=sum(recorded_seconds(r) for r in recorded) / 3600,
                        hours_mapped=bool(recorded), status=latest.get('activity_status'),
                        month=latest.get('reporting_month'), date=at.date().isoformat() if at else None,
                        date_source='consolidated_record', week_start=None, week_end=None)
            if item['completed']:
                item['status'] = 'Completed'
            if latest.get('achieved_score') is not None:
                item.update(quiz_score=float(latest['achieved_score']),
                            quiz_maximum_score=float(latest['total_score']) if latest.get('total_score') is not None else None)
        items.append(item)
    result = {**payload, **summarize(items)}
    total = sum(recorded_seconds(r) for r in records if counts_as_actual(r)) / 3600
    result.update(recorded_otjh_total=round(total, 4), audit_lms_actual=round(total, 4),
                  audit_tp_planned=None, audit_ksb_evidenced=len({k for r in records if counts_as_actual(r) for k in r['ksbs']}),
                  direct_otjh_activities=[], canonical_otjh_activities=otjh_activities(records))
    return result
