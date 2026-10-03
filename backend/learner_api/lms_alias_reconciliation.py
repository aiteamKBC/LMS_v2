"""Consolidate historical LMS identities into the Learner SSOT.

The scanner is read-only.  Apply mode is intentionally branch guarded and
stores completion-only inventory without awarding OTJ hours or inventing dates,
durations, KSBs, or acceptance decisions.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import re
import uuid


SOURCE_SYSTEM = 'old_lms'
RUN_KIND = 'lms-alias-reconciliation-v1'
PRODUCTION_BRANCH_IDS = {'br-holy-band-abhispwg'}
LOCK_NAMESPACE = 193_650_771


def normalize_email(value):
    return str(value or '').strip().casefold()


def normalize_aptem(value):
    text = str(value or '').strip()
    return text.lstrip('0') or ('0' if text else '')


def normalized_activity_type(value):
    return re.sub(r'[^a-z0-9]+', '', str(value or '').casefold())


def result_is_completed(result):
    status = str(result.get('status') or '').strip().casefold()
    kind = normalized_activity_type(result.get('activity_type'))
    return (
        status in {'accepted', 'complete', 'completed', 'passed'}
        or (kind == 'video' and result.get('video_completed') is True)
        or (kind == 'readingquiz' and result.get('reading_viewed') is True
            and result.get('quiz_passed') is True)
    )


def result_has_completed_quiz(result):
    return (
        normalized_activity_type(result.get('activity_type')) == 'readingquiz'
        and result.get('reading_viewed') is True
        and result.get('quiz_passed') is True
    )


def verify_apply_branch(cursor, expected_branch_id):
    if not expected_branch_id:
        raise ValueError('Apply requires --expected-branch-id for a Neon Child Branch.')
    cursor.execute("SELECT current_setting('neon.branch_id', true)")
    actual = str(cursor.fetchone()[0] or '').strip()
    if not actual:
        raise ValueError('The database did not expose a Neon branch id; apply is blocked.')
    if actual in PRODUCTION_BRANCH_IDS or expected_branch_id in PRODUCTION_BRANCH_IDS:
        raise ValueError('Production is read-only for this reconciliation; use a Neon Child Branch.')
    if actual != expected_branch_id:
        raise ValueError('The connected Neon branch does not match --expected-branch-id.')
    return actual


def _rows(cursor, sql, params=None):
    cursor.execute(sql, params or [])
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, values)) for values in cursor.fetchall()]


def _json(value):
    def default(item):
        if isinstance(item, Decimal):
            return float(item)
        if isinstance(item, datetime):
            return item.isoformat()
        raise TypeError(f'Unsupported JSON value: {type(item).__name__}')
    return json.dumps(value, default=default, sort_keys=True, separators=(',', ':'))


def _candidate_identities(cursor):
    aliases = _rows(cursor, '''SELECT aptem_id,canonical_lms_id,lms_learner_id,
        aptem_email,lms_email,is_primary,first_seen,last_seen
        FROM "Learner".source_lms_learner_aliases
        ORDER BY aptem_id,is_primary DESC,lms_learner_id''')
    emails_by_aptem = defaultdict(set)
    aptems_by_email = defaultdict(set)
    aptems_by_source = defaultdict(set)
    for alias in aliases:
        aptem_id = int(alias['aptem_id'])
        for field in ('aptem_email', 'lms_email'):
            email = normalize_email(alias.get(field))
            if email:
                emails_by_aptem[aptem_id].add(email)
                aptems_by_email[email].add(aptem_id)
        aptems_by_source[str(alias['lms_learner_id'])].add(aptem_id)
    candidate_ids = sorted(
        aptem_id for aptem_id, emails in emails_by_aptem.items() if len(emails) > 1
    )
    candidate_set = set(candidate_ids)
    candidate_aliases = [alias for alias in aliases if int(alias['aptem_id']) in candidate_set]
    conflict_ids = {
        aptem_id
        for values in [*aptems_by_email.values(), *aptems_by_source.values()]
        if len(values) > 1
        for aptem_id in values
        if aptem_id in candidate_set
    }
    if not candidate_ids:
        return {
            'candidate_ids': [], 'eligible': {}, 'blocked_ids': set(),
            'aliases': [], 'identity_conflicts': 0,
        }
    owners = _rows(cursor, '''SELECT l.id AS learner_id,l.enrolment_id,l.programme_id,
        l.aptem_id,l.email AS owner_email,account.id AS account_id,
        account."Email" AS account_email,account.aptem_id AS account_aptem_id
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" account ON account.id=l.enrolment_id
        WHERE l.aptem_id=ANY(%s)
        ORDER BY l.aptem_id,l.id''', [candidate_ids])
    owners_by_aptem = defaultdict(list)
    aliases_by_aptem = defaultdict(list)
    for owner in owners:
        owners_by_aptem[int(owner['aptem_id'])].append(owner)
    for alias in candidate_aliases:
        aliases_by_aptem[int(alias['aptem_id'])].append(alias)
    eligible, blocked_ids = {}, set(conflict_ids)
    for aptem_id in candidate_ids:
        candidates = owners_by_aptem.get(aptem_id, [])
        source_aliases = aliases_by_aptem.get(aptem_id, [])
        canonical_ids = {str(alias['canonical_lms_id']) for alias in source_aliases}
        source_emails = {normalize_email(alias.get('lms_email')) for alias in source_aliases}
        source_emails.discard('')
        if len(candidates) != 1 or not source_aliases or len(canonical_ids) != 1:
            blocked_ids.add(aptem_id)
            continue
        owner = candidates[0]
        owner_email = normalize_email(owner.get('owner_email'))
        account_email = normalize_email(owner.get('account_email'))
        account_aptem = normalize_aptem(owner.get('account_aptem_id'))
        account_invalid = owner.get('account_id') is not None and (
            not owner_email or owner_email != account_email
            or (account_aptem and account_aptem != normalize_aptem(aptem_id))
        )
        if (account_invalid
                or any(not normalize_email(alias.get('lms_email')) for alias in source_aliases)):
            blocked_ids.add(aptem_id)
            continue
        eligible[aptem_id] = {'owner': owner, 'aliases': source_aliases}
    for aptem_id in blocked_ids:
        eligible.pop(aptem_id, None)
    return {
        'candidate_ids': candidate_ids,
        'eligible': eligible,
        'blocked_ids': blocked_ids,
        'aliases': candidate_aliases,
        'identity_conflicts': len(conflict_ids),
    }


def _catalogue(cursor, group_ids):
    if not group_ids:
        return {}, set()
    rows = _rows(cursor, '''SELECT c.id AS source_course_id,c.source_course_ref,
        c.source_course_title,c.curriculum_module_ref,a.id AS source_catalog_activity_id,
        a.source_activity_id,a.source_activity_kind,a.source_activity_title,
        a.source_activity_type,a.curriculum_component_ref,
        material.payload->>'quiz_id' AS material_quiz_id
        FROM curriculum.source_courses c
        JOIN curriculum.source_activities a ON a.source_course_id=c.id
          AND a.source_system=c.source_system AND a.deleted_at IS NULL
        LEFT JOIN curriculum.source_materials material
          ON material.material_id=a.source_material_id
          AND material.source_system=a.source_system AND material.deleted_at IS NULL
        WHERE c.source_system=%s AND c.deleted_at IS NULL
          AND c.source_course_ref=ANY(%s)
        ORDER BY c.id,a.id''', [SOURCE_SYSTEM, [str(value) for value in group_ids]])
    by_key = defaultdict(list)
    course_refs = set()
    for record in rows:
        ref = str(record['source_course_ref'])
        course_refs.add(ref)
        by_key[(ref, str(record['source_activity_id']))].append(record)
    return by_key, course_refs


def _completion_candidates(cursor, eligible):
    aliases_by_source = {}
    source_ids = []
    for aptem_id, bundle in eligible.items():
        for alias in bundle['aliases']:
            source_id = str(alias['lms_learner_id'])
            aliases_by_source[source_id] = (aptem_id, alias)
            source_ids.append(int(source_id))
    if not source_ids:
        return [], {'source_results': 0, 'unmapped_material_results': 0,
                    'unmapped_quiz_results': 0}
    results = _rows(cursor, '''SELECT group_id,learner_id,activity_id,activity_type,status,
        video_completed,reading_viewed,quiz_passed,quiz_score,quiz_maximum_score,
        quiz_attempt_number,updated_at
        FROM "Learner".source_lms_activity_results
        WHERE learner_id=ANY(%s)
        ORDER BY learner_id,group_id,activity_id''', [source_ids])
    group_ids = sorted({int(record['group_id']) for record in results})
    catalogue, _ = _catalogue(cursor, group_ids)
    candidates = {}
    unmapped_material = unmapped_quiz = 0

    def add_candidate(result, definition, candidate_kind, source_id):
        aptem_id, _ = aliases_by_source[source_id]
        owner = eligible[aptem_id]['owner']
        source_activity_id = str(definition['source_activity_id'])
        key = (int(owner['learner_id']), source_activity_id)
        candidate = candidates.get(key)
        if candidate is None:
            activity_type = 'quiz' if candidate_kind == 'quiz' else (
                definition.get('source_activity_type') or definition.get('source_activity_kind')
                or result.get('activity_type') or 'learning'
            )
            safe_type = re.sub(r'[^a-z0-9]+', '_', str(activity_type).casefold()).strip('_') or 'learning'
            candidate = {
                **definition,
                'learner_id': int(owner['learner_id']),
                'enrolment_id': owner.get('enrolment_id'),
                'programme_id': owner.get('programme_id'),
                'aptem_id': aptem_id,
                'candidate_kind': candidate_kind,
                'activity_type': safe_type,
                'activity_status': 'passed' if candidate_kind == 'quiz' else 'completed',
                'source_learner_ids': set(),
                'source_updated_at': result.get('updated_at'),
                'quiz_score': result.get('quiz_score') if candidate_kind == 'quiz' else None,
                'quiz_maximum_score': result.get('quiz_maximum_score') if candidate_kind == 'quiz' else None,
                'quiz_attempt_number': result.get('quiz_attempt_number') if candidate_kind == 'quiz' else None,
                'completion_signals': {
                    'status_completed': str(result.get('status') or '').strip().casefold() == 'completed',
                    'video_completed': result.get('video_completed') is True,
                    'reading_viewed': result.get('reading_viewed') is True,
                    'quiz_passed': result.get('quiz_passed') is True,
                },
            }
            candidates[key] = candidate
        candidate['source_learner_ids'].add(source_id)
        if result.get('updated_at') and (
                not candidate.get('source_updated_at')
                or result['updated_at'] > candidate['source_updated_at']):
            candidate['source_updated_at'] = result['updated_at']
        for signal, value in candidate['completion_signals'].items():
            candidate['completion_signals'][signal] = value or (
                signal == 'status_completed' and str(result.get('status') or '').strip().casefold() == 'completed'
                or signal == 'video_completed' and result.get('video_completed') is True
                or signal == 'reading_viewed' and result.get('reading_viewed') is True
                or signal == 'quiz_passed' and result.get('quiz_passed') is True
            )
        if candidate_kind == 'quiz':
            score = result.get('quiz_score')
            maximum = result.get('quiz_maximum_score')
            old_score = candidate.get('quiz_score')
            if score is not None and (old_score is None or Decimal(str(score)) > Decimal(str(old_score))):
                candidate['quiz_score'] = score
                candidate['quiz_maximum_score'] = maximum
            attempt = result.get('quiz_attempt_number')
            if attempt is not None:
                candidate['quiz_attempt_number'] = max(candidate.get('quiz_attempt_number') or 0, attempt)

    for result in results:
        source_id = str(result['learner_id'])
        if source_id not in aliases_by_source or not result_is_completed(result):
            continue
        group_ref = str(result['group_id'])
        material_id = f"material:{result['activity_id']}"
        material_defs = catalogue.get((group_ref, material_id), [])
        if len(material_defs) != 1:
            unmapped_material += 1
            continue
        material = material_defs[0]
        add_candidate(result, material, 'material', source_id)
        if result_has_completed_quiz(result):
            quiz_id = str(material.get('material_quiz_id') or '').strip()
            quiz_defs = catalogue.get((group_ref, f'quiz:{quiz_id}'), []) if quiz_id else []
            if len(quiz_defs) != 1:
                unmapped_quiz += 1
            else:
                add_candidate(result, quiz_defs[0], 'quiz', source_id)
    output = []
    for candidate in candidates.values():
        candidate['source_learner_ids'] = sorted(candidate['source_learner_ids'])
        candidate['canonical_activity_key'] = (
            f"old_lms:{candidate['learner_id']}:{candidate['source_course_ref']}:"
            f"{candidate['source_activity_id']}"
        )
        output.append(candidate)
    output.sort(key=lambda value: (
        value['learner_id'], str(value['source_course_ref']),
        str(value['source_activity_id']), value['candidate_kind'],
    ))
    return output, {
        'source_results': len(results),
        'unmapped_material_results': unmapped_material,
        'unmapped_quiz_results': unmapped_quiz,
    }


def _course_memberships(cursor, eligible):
    aliases_by_source = {}
    source_ids = []
    for aptem_id, bundle in eligible.items():
        for alias in bundle['aliases']:
            source_id = str(alias['lms_learner_id'])
            aliases_by_source[source_id] = (aptem_id, alias)
            source_ids.append(int(source_id))
    if not source_ids:
        return [], 0
    source_rows = _rows(cursor, '''SELECT learner_id,group_id
        FROM "Learner".source_lms_group_learners
        WHERE learner_id=ANY(%s)
        ORDER BY learner_id,group_id''', [source_ids])
    group_ids = sorted({int(record['group_id']) for record in source_rows})
    courses = _rows(cursor, '''SELECT id,source_course_ref
        FROM curriculum.source_courses
        WHERE source_system=%s AND deleted_at IS NULL
          AND source_course_ref=ANY(%s)
        ORDER BY source_course_ref,id''', [SOURCE_SYSTEM, [str(value) for value in group_ids]]) if group_ids else []
    courses_by_ref = defaultdict(list)
    for course in courses:
        courses_by_ref[str(course['source_course_ref'])].append(course)
    memberships, unmapped = {}, 0
    for source_row in source_rows:
        source_id = str(source_row['learner_id'])
        aptem_id, alias = aliases_by_source[source_id]
        owner = eligible[aptem_id]['owner']
        course_matches = courses_by_ref.get(str(source_row['group_id']), [])
        if len(course_matches) != 1:
            unmapped += 1
            continue
        course = course_matches[0]
        key = (int(owner['learner_id']), int(course['id']))
        incoming = {
            'learner_id': int(owner['learner_id']),
            'enrolment_id': owner.get('enrolment_id'),
            'source_course_id': int(course['id']),
            'source_learner_id': source_id,
            'is_primary': alias.get('is_primary') is True,
        }
        previous = memberships.get(key)
        if previous is None or (incoming['is_primary'], source_id) > (
                previous['is_primary'], previous['source_learner_id']):
            memberships[key] = incoming
    return list(memberships.values()), unmapped


def _existing_state(cursor, eligible, candidates, memberships):
    learner_ids = sorted(int(bundle['owner']['learner_id']) for bundle in eligible.values())
    source_ids = sorted({
        str(alias['lms_learner_id'])
        for bundle in eligible.values() for alias in bundle['aliases']
    })
    identities = _rows(cursor, '''SELECT learner_id,source_learner_id,source_payload
        FROM "Learner".learner_external_identities
        WHERE source_system=%s AND source_learner_id=ANY(%s) AND deleted_at IS NULL''',
        [SOURCE_SYSTEM, source_ids]) if source_ids else []
    identity_by_source = {str(record['source_learner_id']): record for record in identities}
    identity_conflicts = sum(
        int(record['learner_id']) != int(eligible[int(alias['aptem_id'])]['owner']['learner_id'])
        for bundle in eligible.values() for alias in bundle['aliases']
        if (record := identity_by_source.get(str(alias['lms_learner_id']))) is not None
    )
    existing_memberships = set()
    if learner_ids:
        existing_memberships = {
            (int(record['learner_id']), int(record['source_course_id']))
            for record in _rows(cursor, '''SELECT learner_id,source_course_id
                FROM "Learner".learner_source_course_memberships
                WHERE learner_id=ANY(%s) AND deleted_at IS NULL''', [learner_ids])
        }
    existing_sources = set()
    if learner_ids:
        existing_sources = {
            (int(record['learner_id']), str(record['source_activity_id']))
            for record in _rows(cursor, '''SELECT learner_id,source_activity_id
                FROM "Learner".learner_activity_sources
                WHERE learner_id=ANY(%s) AND source_system=%s AND deleted_at IS NULL''',
                [learner_ids, SOURCE_SYSTEM])
        }
    progress_rows = _rows(cursor, '''SELECT id,learner_id,source_system,source_activity_id,
        canonical_activity_key,source_payload
        FROM "Learner".learner_progress_entries
        WHERE learner_id=ANY(%s) AND deleted_at IS NULL
        ORDER BY learner_id,id''', [learner_ids]) if learner_ids else []
    direct_progress = defaultdict(set)
    canonical_progress = defaultdict(set)
    journal_progress = defaultdict(set)
    progress_by_id = {}
    for progress in progress_rows:
        learner_id = int(progress['learner_id'])
        progress_id = int(progress['id'])
        progress_by_id[progress_id] = progress
        if progress.get('source_system') == SOURCE_SYSTEM and progress.get('source_activity_id'):
            direct_progress[(learner_id, str(progress['source_activity_id']))].add(progress_id)
        if progress.get('canonical_activity_key'):
            canonical_progress[(learner_id, str(progress['canonical_activity_key']))].add(progress_id)
        payload = progress.get('source_payload')
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (TypeError, ValueError):
                payload = None
        if isinstance(payload, dict) and payload.get('original_source_ref'):
            journal_progress[(learner_id, str(payload['original_source_ref']))].add(progress_id)

    activity_actions = []
    ambiguous_links = 0
    for candidate in candidates:
        source_key = (candidate['learner_id'], str(candidate['source_activity_id']))
        if source_key in existing_sources:
            activity_actions.append({**candidate, 'action': 'existing_source', 'progress_id': None})
            continue
        routes = [direct_progress.get(source_key, set())]
        routes.append(canonical_progress.get(
            (candidate['learner_id'], candidate['canonical_activity_key']), set()
        ))
        if candidate['candidate_kind'] == 'material':
            material_id = str(candidate['source_activity_id']).partition(':')[2]
            routes.append(journal_progress.get((candidate['learner_id'],
                f"la:{candidate['source_course_ref']}:{material_id}"), set()))
        selected = None
        for route in routes:
            if route:
                selected = route
                break
        if selected and len(selected) != 1:
            ambiguous_links += 1
            activity_actions.append({**candidate, 'action': 'ambiguous', 'progress_id': None})
        elif selected:
            progress_id = next(iter(selected))
            activity_actions.append({**candidate, 'action': 'attach_source',
                                     'progress_id': progress_id,
                                     'progress': progress_by_id[progress_id]})
        else:
            activity_actions.append({**candidate, 'action': 'create_progress', 'progress_id': None})
    return {
        'identity_by_source': identity_by_source,
        'identity_conflicts': identity_conflicts,
        'missing_memberships': [record for record in memberships
            if (record['learner_id'], record['source_course_id']) not in existing_memberships],
        'activity_actions': activity_actions,
        'ambiguous_activity_links': ambiguous_links,
    }


def inspect(cursor):
    identities = _candidate_identities(cursor)
    candidates, completion = _completion_candidates(cursor, identities['eligible'])
    memberships, unmapped_memberships = _course_memberships(cursor, identities['eligible'])
    existing = _existing_state(cursor, identities['eligible'], candidates, memberships)
    actions = existing['activity_actions']
    summary = {
        'candidate_learners': len(identities['candidate_ids']),
        'eligible_learners': len(identities['eligible']),
        'blocked_learners': len(identities['blocked_ids']),
        'operational_accounts_missing': sum(
            bundle['owner'].get('account_id') is None
            for bundle in identities['eligible'].values()
        ),
        'alias_rows': sum(len(bundle['aliases']) for bundle in identities['eligible'].values()),
        'identity_conflicts': identities['identity_conflicts'] + existing['identity_conflicts'],
        'external_identities_missing': sum(
            str(alias['lms_learner_id']) not in existing['identity_by_source']
            for bundle in identities['eligible'].values() for alias in bundle['aliases']
        ),
        'course_memberships_missing': len(existing['missing_memberships']),
        'course_memberships_unmapped': unmapped_memberships,
        'source_results_scanned': completion['source_results'],
        'completed_activity_candidates': len(candidates),
        'activity_sources_existing': sum(action['action'] == 'existing_source' for action in actions),
        'activity_sources_to_attach': sum(action['action'] == 'attach_source' for action in actions),
        'progress_rows_to_create': sum(action['action'] == 'create_progress' for action in actions),
        'ambiguous_activity_links': existing['ambiguous_activity_links'],
        'unmapped_material_results': completion['unmapped_material_results'],
        'unmapped_quiz_results': completion['unmapped_quiz_results'],
    }
    return identities, existing, summary


def _identity_payload(alias):
    email = normalize_email(alias.get('lms_email'))
    return {
        'aptem_id': int(alias['aptem_id']),
        'learner_email': email,
        'source_email': email,
        'legacy_alias': True,
        'identity_import': RUN_KIND,
    }


def _source_payload(candidate):
    return {
        'identity_alias_reconciliation': RUN_KIND,
        'source_course_ref': str(candidate['source_course_ref']),
        'source_learner_ids': list(candidate['source_learner_ids']),
        'completion_signals': candidate['completion_signals'],
    }


def _insert_activity_source(cursor, candidate, progress_id, canonical_key, run_id):
    payload = _source_payload(candidate)
    fingerprint = hashlib.sha256(
        f"{candidate['learner_id']}|{candidate['source_activity_id']}|{progress_id}".encode()
    ).hexdigest()
    cursor.execute('''INSERT INTO "Learner".learner_activity_sources (
        learner_id,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,
        canonical_activity_key,activity_type,title,activity_status,completed,accepted,
        actual_seconds,actual_basis,source_payload,source_updated_at,sync_run_id,
        canonical_progress_id,source_fingerprint,curriculum_component_ref,
        source_course_ref,source_catalog_activity_id
    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,false,NULL,%s,%s::jsonb,%s,%s,
        %s,%s,%s,%s,%s)
    ON CONFLICT (learner_id,source_system,source_activity_id) WHERE deleted_at IS NULL
    DO NOTHING RETURNING id''', [
        candidate['learner_id'], candidate.get('enrolment_id'), candidate.get('programme_id'),
        candidate.get('aptem_id'), SOURCE_SYSTEM, candidate['source_activity_id'], canonical_key,
        candidate['activity_type'], candidate.get('source_activity_title') or 'LMS activity',
        candidate['activity_status'], 'lms:completion-only-no-verified-duration',
        _json(payload), candidate.get('source_updated_at'), run_id, progress_id, fingerprint,
        candidate.get('curriculum_component_ref'), str(candidate['source_course_ref']),
        candidate['source_catalog_activity_id'],
    ])
    return cursor.fetchone() is not None


def apply(cursor, expected_branch_id):
    branch_id = verify_apply_branch(cursor, expected_branch_id)
    identities, existing, summary = inspect(cursor)
    if summary['identity_conflicts']:
        raise ValueError('Identity conflicts remain; apply is blocked.')
    run_key = f"{RUN_KIND}:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}:{uuid.uuid4().hex[:12]}"
    cursor.execute('''INSERT INTO "Learner".activity_sync_runs
        (run_key,run_kind,status,dry_run,source_counts,prompt_version)
        VALUES (%s,%s,'running',false,%s::jsonb,%s) RETURNING id''',
        [run_key, RUN_KIND, _json(summary), RUN_KIND])
    run_id = int(cursor.fetchone()[0])
    for bundle in identities['eligible'].values():
        cursor.execute('SELECT pg_advisory_xact_lock(%s,%s)',
                       [LOCK_NAMESPACE, int(bundle['owner']['learner_id'])])

    identities_written = 0
    for bundle in identities['eligible'].values():
        owner = bundle['owner']
        for alias in bundle['aliases']:
            payload = _identity_payload(alias)
            cursor.execute('''INSERT INTO "Learner".learner_external_identities AS existing (
                learner_id,enrolment_id,source_system,source_learner_id,source_payload,
                first_seen_at,last_seen_at
            ) VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s)
            ON CONFLICT (source_system,source_learner_id) WHERE deleted_at IS NULL
            DO UPDATE SET
                enrolment_id=EXCLUDED.enrolment_id,
                source_payload=(CASE
                  WHEN jsonb_typeof(existing.source_payload)='object'
                  THEN existing.source_payload ELSE '{}'::jsonb END)
                  || EXCLUDED.source_payload,
                first_seen_at=least(existing.first_seen_at,EXCLUDED.first_seen_at),
                last_seen_at=greatest(existing.last_seen_at,EXCLUDED.last_seen_at)
            WHERE existing.learner_id=EXCLUDED.learner_id
            RETURNING id''', [
                owner['learner_id'], owner.get('enrolment_id'), SOURCE_SYSTEM,
                str(alias['lms_learner_id']), _json(payload),
                alias.get('first_seen') or datetime.now(timezone.utc),
                alias.get('last_seen') or datetime.now(timezone.utc),
            ])
            if cursor.fetchone() is None:
                raise ValueError('An external identity changed ownership during apply.')
            identities_written += 1

    memberships_inserted = 0
    for membership in existing['missing_memberships']:
        cursor.execute('''INSERT INTO "Learner".learner_source_course_memberships (
            learner_id,enrolment_id,source_course_id,source_learner_id,
            source_relationship,source_payload
        ) VALUES (%s,%s,%s,%s,'historical',%s::jsonb)
        ON CONFLICT (learner_id,source_course_id) WHERE deleted_at IS NULL
        DO NOTHING RETURNING id''', [
            membership['learner_id'], membership.get('enrolment_id'),
            membership['source_course_id'], membership['source_learner_id'],
            _json({'identity_alias_reconciliation': RUN_KIND}),
        ])
        memberships_inserted += cursor.fetchone() is not None

    next_orders = {}
    sources_attached = progress_created = source_races = 0
    for action in existing['activity_actions']:
        if action['action'] in {'existing_source', 'ambiguous'}:
            continue
        progress_id = action.get('progress_id')
        canonical_key = action['canonical_activity_key']
        if action['action'] == 'create_progress':
            learner_id = int(action['learner_id'])
            if learner_id not in next_orders:
                cursor.execute('''SELECT coalesce(max(entry_order),0)
                    FROM "Learner".learner_progress_entries
                    WHERE learner_id=%s''', [learner_id])
                next_orders[learner_id] = int(cursor.fetchone()[0])
            next_orders[learner_id] += 1
            payload = _source_payload(action)
            cursor.execute('''INSERT INTO "Learner".learner_progress_entries (
                id,learner_id,entry_order,kind,module_ref,module_title,component_ref,
                component_title,component_type,quiz_ref,attempt,achieved_score,total_score,
                passed,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,
                canonical_activity_key,activity_status,accepted,actual_seconds,actual_basis,
                reporting_month,source_payload,sync_run_id,curriculum_component_ref
            ) VALUES (nextval('"Learner".learner_progress_entries_id_seq'),
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                false,NULL,%s,'',%s::jsonb,%s,%s) RETURNING id''', [
                learner_id, next_orders[learner_id], action['activity_type'],
                action.get('curriculum_module_ref'), action.get('source_course_title') or '',
                action['source_activity_id'], action.get('source_activity_title') or 'LMS activity',
                action['activity_type'],
                action['source_activity_id'].partition(':')[2] if action['candidate_kind'] == 'quiz' else None,
                action.get('quiz_attempt_number'), action.get('quiz_score'),
                action.get('quiz_maximum_score'), True if action['candidate_kind'] == 'quiz' else None,
                action.get('enrolment_id'), action.get('programme_id'), action.get('aptem_id'),
                SOURCE_SYSTEM, action['source_activity_id'], canonical_key,
                action['activity_status'], 'lms:completion-only-no-verified-duration',
                _json(payload), run_id, action.get('curriculum_component_ref'),
            ])
            progress_id = int(cursor.fetchone()[0])
            progress_created += 1
        elif action.get('progress') and action['progress'].get('canonical_activity_key'):
            canonical_key = str(action['progress']['canonical_activity_key'])
        if _insert_activity_source(cursor, action, progress_id, canonical_key, run_id):
            sources_attached += 1
        else:
            source_races += 1
            if action['action'] == 'create_progress':
                raise ValueError('A source identity changed concurrently during apply.')

    result = {
        **summary,
        'external_identities_written': identities_written,
        'course_memberships_inserted': memberships_inserted,
        'activity_sources_attached': sources_attached,
        'progress_rows_created': progress_created,
        'source_conflict_races': source_races,
    }
    cursor.execute('''UPDATE "Learner".activity_sync_runs
        SET status='success',finished_at=now(),result_counts=%s::jsonb,updated_at=now()
        WHERE id=%s''', [_json(result), run_id])
    return {'branch_id': branch_id, 'run_id': run_id, 'run_key': run_key, **result}
