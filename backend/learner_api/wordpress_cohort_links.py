"""Verify workbook learners against WordPress without changing learner-facing data."""

from hashlib import sha256

from audit_api.last_audit_ledger_views import _is_completed
from .subject_source import source_rows


def normal_email(value):
    return str(value or '').strip().casefold()


def identity_index(profiles, identities):
    """Accept saved source ID and email pairs; use email alone only without an ID."""
    by_email = {}
    for aptem_id, profile in profiles.items():
        email = normal_email(profile['email'])
        if not email or email in by_email:
            raise ValueError('Workbook learner emails must be present and unique.')
        by_email[email] = aptem_id

    exact, known_ids, with_identity = {}, {}, set()
    for aptem_id, source_id, source_email, primary in identities:
        aptem_id = str(aptem_id)
        if aptem_id not in profiles:
            continue
        if not str(source_id or '').isdigit() or int(source_id) <= 0 or not normal_email(source_email):
            raise ValueError('A saved WordPress identity is incomplete.')
        source_id = int(source_id)
        owner = known_ids.setdefault(source_id, aptem_id)
        if owner != aptem_id:
            raise ValueError('A WordPress learner ID belongs to multiple workbook learners.')
        with_identity.add(aptem_id)
        for email in ({normal_email(source_email), normal_email(profiles[aptem_id]['email'])}
                      if primary else {normal_email(source_email)}):
            key = (source_id, email)
            if key in exact and exact[key] != aptem_id:
                raise ValueError('A WordPress identity is shared by multiple learners.')
            exact[key] = aptem_id
    fallback = {normal_email(profile['email']): aptem_id for aptem_id, profile in profiles.items()
                if aptem_id not in with_identity}
    return exact, fallback, known_ids


def collect_page(payload, exact, fallback, known_ids, matches):
    """Keep only matched course progress; never retain source answers or other learners."""
    for group in payload['groups']:
        group_id = group.get('group_id')
        if type(group_id) is not int or group_id <= 0:
            raise ValueError('WordPress course identity is invalid.')
        for learner in group.get('learners') or []:
            source_id = learner.get('learner_id')
            email = normal_email(learner.get('learner_email'))
            if type(source_id) is not int or source_id <= 0 or not email:
                continue
            aptem_id = exact.get((source_id, email))
            if aptem_id is None and source_id not in known_ids:
                aptem_id = fallback.get(email)
            if aptem_id is None:
                continue
            if not isinstance(group.get('activities'), list) or not isinstance(learner.get('activity_results'), list):
                raise ValueError('A matched WordPress course has incomplete activity data.')
            result = matches.setdefault(aptem_id, {'source_ids': set(), 'courses': {}})
            result['source_ids'].add(source_id)
            course = result['courses'].setdefault(group_id, {
                'id': group_id, 'title': str(group.get('group_name') or ''), 'activities': {},
            })
            source_group = {'id': group_id, 'name': course['title'],
                            'activities': group['activities'], 'results': learner['activity_results']}
            for row in source_rows(source_group):
                completed = bool(_is_completed(row))
                started = completed or str(row.get('status') or '').strip().lower() not in ('', 'not_started', 'not started')
                started = started or any(row.get(flag) is True for flag in (
                    'video_started', 'reading_viewed', 'quiz_attempted'))
                item = course['activities'].setdefault(row['activity_id'], {
                    'id': row['activity_id'], 'title': str(row.get('title') or 'Untitled activity'),
                    'type': str(row.get('activity_type') or 'activity'),
                    'position': row['position'],
                    'completed': False, 'started': False,
                })
                item['completed'] |= completed
                item['started'] |= started


def verified_link(aptem_id, profile, match, *, fallback_identity=False):
    """One private snapshot per learner, including an explicit unmatched state."""
    source_ids = sorted(match['source_ids']) if match else []
    ambiguous = fallback_identity and len(source_ids) > 1
    status = 'ambiguous' if ambiguous else 'verified' if source_ids else 'not_found'
    courses = []
    enrolled_count = len(match['courses']) if match and not ambiguous else 0
    if match and not ambiguous:
        for course in match['courses'].values():
            activities = sorted(course['activities'].values(), key=lambda item: (item['position'], item['id']))
            completed_count = sum(item['completed'] for item in activities)
            if completed_count > 5:
                courses.append({
                    'id': course['id'], 'title': course['title'], 'activities': activities,
                    'completedActivities': completed_count,
                    'startedActivities': sum(item['started'] for item in activities),
                })
    courses.sort(key=lambda course: (course['title'].casefold(), course['id']))
    return {
        'aptem_id': int(aptem_id), 'profile_id': int(profile['id']),
        'enrolment_id': int(profile['enrolment_id']),
        'email_sha256': sha256(normal_email(profile['email']).encode()).hexdigest(),
        'match_status': status, 'source_learner_ids': source_ids,
        'enrolled_course_count': enrolled_count, 'eligible_course_count': len(courses),
        'courses': courses,
    }
