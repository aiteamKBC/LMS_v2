"""Compact assignment counts for the employer overview; no evidence or writes."""
from django.db import connections


def module_assignments(source, kind, modules, *, components=()):
    # The historical Overview catalogue can suppress native activities for an
    # imported module. Its assignment submissions still belong to the authored
    # components, so use those identities when they exist for this module.
    native = {}
    for component in components:
        if str(component.get('type') or '').strip().lower() == 'assignment' and component.get('componentId'):
            native.setdefault(component.get('moduleId'), []).append({
                'id': component['componentId'], 'dedupe': f"component:{component['componentId']}",
            })
    candidates = {module['id']: [activity for activity in module['_subject']['activities']
                  if 'assignment' in str(activity.get('category') or '').lower()]
                  for module in modules}
    authored = set()
    for module in modules:
        activities = native.get(module.get('moduleId')) if module.get('moduleId') else None
        if activities:
            candidates[module['id']] = activities
            authored.add(module['id'])
    refs = {str(ref) for activities in candidates.values() for activity in activities
            for ref in activity.get('nativeRefs') or [activity.get('nativeRef') or activity['id']]}
    submitted = set()
    if refs:
        with connections['enrolment'].cursor() as cur:
            cur.execute('''SELECT DISTINCT activity_id
                FROM "Learner".learning_reflection_submissions
                WHERE learner_kind=%s AND learner_id=%s AND activity_type='assignment'
                  AND activity_id=ANY(%s)
                  AND (status <> 'draft' OR CASE
                    WHEN jsonb_typeof(full_submission->'assignmentAttemptHistory')='array'
                    THEN jsonb_array_length(full_submission->'assignmentAttemptHistory') > 0
                    ELSE FALSE END)''', [kind, str(source.pk), sorted(refs)])
            submitted = {str(row[0]) for row in cur.fetchall()}
    seen = set()
    result = {}
    for module in sorted(modules, key=lambda row: (row['title'].casefold(), row['id'])):
        total = done = 0
        for activity in candidates[module['id']]:
            key = activity.get('dedupe') or (module['id'], str(activity['id']))
            if key in seen:
                continue
            seen.add(key)
            total += 1
            native_refs = activity.get('nativeRefs') or [activity.get('nativeRef') or activity['id']]
            # Imported completion is the existing canonical historical fact.
            historical = module['id'] not in authored and module['id'].startswith('legacy:') and activity.get('completed')
            done += bool(historical or any(str(ref) in submitted for ref in native_refs))
        result[module['id']] = {'submitted': done, 'total': total}
    return result
