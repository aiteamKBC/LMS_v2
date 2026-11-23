"""Read-only ownership and visibility for the learner's plan routes."""
from curriculum_api.canonical_read_sql import current_status_sql


def scoped_plan(plan, rows):
    """Retain whole assigned modules, with children under their exact parent."""
    modules = {str(module) for module, _, _ in rows}
    weeks = {(str(module), str(week)) for module, week, _ in rows if week is not None}
    components = {(str(module), str(week), str(component))
                  for module, week, component in rows if component is not None}
    return [{**module, 'weeks': [
        {**week, 'components': [component for component in week.get('components', [])
            if (str(module['moduleId']), str(week['weekId']), str(component.get('componentId'))) in components]}
        for week in module.get('weeks', [])
        if (str(module['moduleId']), str(week.get('weekId'))) in weeks]}
        for module in plan if str(module.get('moduleId')) in modules]


def read_scope(cursor, learner_id, *, active_only):
    """An empty module/week stays assigned; a child cannot promote its parent."""
    cursor.execute(f'''SELECT m.module_catalogue_id,w.id,c.id
        FROM "Learner".learner_training_plan_modules pm
        JOIN curriculum.modules m ON m.module_catalogue_id=pm.curriculum_module_id
        LEFT JOIN "Learner".learner_training_plan_weeks pw ON pw.plan_module_id=pm.id
        LEFT JOIN curriculum.weeks w ON w.id=pw.curriculum_week_id
          AND w.module_catalogue_id=m.module_catalogue_id
          {'AND ' + current_status_sql('w') if active_only else ''}
        LEFT JOIN "Learner".learner_training_plan_components pc ON pc.plan_week_id=pw.id
        LEFT JOIN curriculum.components c ON c.id=pc.curriculum_component_id
          AND c.week_id=w.id AND c.module_catalogue_id=m.module_catalogue_id
          {'AND ' + current_status_sql('c') if active_only else ''}
        WHERE pm.learner_id=%s
          {'AND ' + current_status_sql('m') if active_only else ''}
        ORDER BY pm.position,pm.id,pw.position,pw.id,pc.position,pc.id''', [learner_id])
    return cursor.fetchall()
