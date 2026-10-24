"""Learner-assigned Modules -> Weeks -> Activities, read from the Learner schema only.

Reads the stored assignment mirror (learner_training_plan_modules/weeks/
components, kept in step by learning_plan.sync_learning_plan_mirror) and the
learner's KSB profile-version pointer. Returns exactly the
``LearnerProfile.training_plan`` shape, built in one round trip instead of one
query per module and week.

Scope, deliberately narrow (docs/f01-f02/12-consolidation-mapping.md):

* Caller has already authorized the target; no permission decision here.
* Keys are canonical ``"Learner".learners.id`` values, never enrolment/subject
  or login account IDs.
* This is the *stored* assignment. Live group inheritance and manual-roster
  exclusions (D11) and authored catalogue fields (D12) still resolve through
  ``selectors.assignments`` / curriculum; they have no Learner destination yet.
* KSB definitions live in curriculum.ksb_definitions (D17). Only the Learner-
  owned profile-version pointer is returned; definitions await a Database
  contract and are not read from curriculum here.
* No fallback, repair, or write. Database errors propagate to the caller.
"""

PLAN_SQL = '''SELECT m.learner_id, m.id AS module_row, m.module_ref, m.module_title,
    w.id AS week_row, w.week_ref, w.week_title,
    c.id AS component_row, c.component_ref, c.component_title
    FROM "Learner".learner_training_plan_modules m
    LEFT JOIN "Learner".learner_training_plan_weeks w ON w.plan_module_id = m.id
    LEFT JOIN "Learner".learner_training_plan_components c ON c.plan_week_id = w.id
    WHERE m.learner_id = ANY(%s)
    ORDER BY m.learner_id, m.position, m.id, w.position, w.id, c.position, c.id'''

KSB_SQL = '''SELECT learner_id, profile_version_id
    FROM "Learner".learner_ksb_assignments WHERE learner_id = ANY(%s)'''


def _learner_ids(learner_ids):
    ids = list(dict.fromkeys(learner_ids))
    if any(type(value) is not int or value <= 0 for value in ids):
        # bool is excluded on purpose: True must never read learner 1.
        raise ValueError('Canonical learner ids must be positive integers')
    return ids


def assigned_curricula(learner_ids, *, query):
    """``{learner_id: {'modules': [...], 'ksbProfileVersionId': int | None}}``.

    Every requested id is present. A learner with no stored plan gets
    ``modules == []``; one with no KSB assignment gets ``None``. Module, week
    and component order is (position, id), matching the model Meta ordering.
    Null refs and blank titles are returned as stored.
    """
    ids = _learner_ids(learner_ids)
    result = {learner_id: {'modules': [], 'ksbProfileVersionId': None} for learner_id in ids}
    if not ids:
        return result
    modules, weeks = {}, {}
    for row in query(PLAN_SQL, [ids]):
        learner = result[row['learner_id']]
        module = modules.get(row['module_row'])
        if module is None:
            module = modules[row['module_row']] = {
                'moduleId': row['module_ref'], 'moduleTitle': row['module_title'], 'weeks': []}
            learner['modules'].append(module)
        if row['week_row'] is None:
            continue
        week = weeks.get(row['week_row'])
        if week is None:
            week = weeks[row['week_row']] = {
                'weekId': row['week_ref'], 'weekTitle': row['week_title'], 'components': []}
            module['weeks'].append(week)
        if row['component_row'] is not None:
            week['components'].append({
                'componentId': row['component_ref'], 'componentTitle': row['component_title']})
    for row in query(KSB_SQL, [ids]):
        result[row['learner_id']]['ksbProfileVersionId'] = row['profile_version_id']
    return result


def assigned_curriculum(learner_id, *, query):
    """Single-learner form of ``assigned_curricula``."""
    return assigned_curricula([learner_id], query=query)[learner_id]
