"""Standalone courses are additional learning, not apprenticeship plan targets.

This policy only selects planned learning. Assignment, estimated activity time,
completion and accepted actual hours retain their existing rules.
"""


def learner_type(source, owner=None):
    value = getattr(source, 'learner_type', None) or (owner or {}).get('learner_type')
    return str(value or 'apprenticeship').strip().casefold()


def planned_modules(modules, kind):
    if kind == 'apprenticeship':
        return [module for module in modules if not module.get('isFreeCourse')]
    return list(modules)
