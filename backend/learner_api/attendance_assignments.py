"""Read attendance membership from the same effective plan as My Learning."""
from types import SimpleNamespace

from django.db import connections

from .learning_plan import _effective_plan_ids, request_preset_cache
from .models import LearnerProfile


def assigned_module_ids(source):
    # A saved [] and explicit selections remain authoritative. Never repair a
    # stale mirror by writing from a GET or resurrecting a cleared assignment.
    return list(dict.fromkeys(_effective_plan_ids(source, request_preset_cache(source))))


def roster_sources(alias='enrolment'):
    """Fetch membership keys, not every learner's nested weeks and activities."""
    projections = []
    for column in ('Training_plan', 'Learning_plan'):
        projections.append(f'''CASE WHEN jsonb_typeof(u."{column}"::jsonb)='array'
            THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'moduleId',entry->'moduleId','assignmentMode',entry->'assignmentMode')), '[]'::jsonb)
                FROM jsonb_array_elements(u."{column}"::jsonb) entry
                WHERE jsonb_typeof(entry)='object')
            ELSE u."{column}"::jsonb END''')
    # Created_users no longer stores programme/group names. Resolve them the way
    # EnrolmentUser.programme/.group do (_learner_placement_names): through the
    # learner profile linked by enrolment_id and its curriculum placement ids.
    # One row per enrolment; no profile or placement leaves the name NULL.
    with connections[alias].cursor() as cursor:
        cursor.execute('''SELECT u.id,u."Username",u."Email",placement.programme,placement.group_name,placement.programme_id,placement.cohort_id,placement.group_id,'''
                       + ','.join(projections) + ''' FROM enrolment."Created_users" u
            LEFT JOIN LATERAL (
                SELECT p.name AS programme, g.group_name, l.programme_id, l.cohort_id, l.group_id
                FROM "Learner".learners l
                LEFT JOIN curriculum.programmes p ON p.programme_id = l.programme_id
                LEFT JOIN curriculum.groups g ON g.group_id = l.group_id
                WHERE l.enrolment_id = u.id
                  AND (SELECT count(*) FROM "Learner".learners linked WHERE linked.enrolment_id = u.id) = 1
            ) placement ON TRUE''')
        return [SimpleNamespace(**dict(zip(
            ('pk', 'username', 'email', 'programme', 'group', 'programme_id', 'cohort_id', 'group_id', 'training_plan', 'learning_plan'), row,
        ))) for row in cursor.fetchall()]


def module_roster(module_id):
    """Effective members with existing profiles, without provisioning anything.

    Read presets in bulk so an inherited roster does not issue one query per
    learner. Resolve profile identity by enrolment id, never by a guessed name.
    """
    if not module_id:
        return []
    sources = roster_sources()
    from curriculum_api.learner_assignment_counts_sql import seed_preset_cache
    presets = seed_preset_cache([{'group_id': source.group_id} for source in sources])
    members = {source.pk: source for source in sources
               if module_id in _effective_plan_ids(source, presets)}
    if not members:
        return []
    profiles = LearnerProfile.objects.filter(enrolment_id__in=members).values(
        'id', 'enrolment_id', 'email', 'full_name',
    )
    return [{
        'learner_profile_id': profile['id'],
        'learner_email': str(members[profile['enrolment_id']].email or profile['email'] or '').strip().casefold(),
        'learner_name': members[profile['enrolment_id']].username or profile['full_name'] or '',
    } for profile in profiles]
