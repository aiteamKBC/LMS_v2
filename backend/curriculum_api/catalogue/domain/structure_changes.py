"""Authored structure delta and assurance-flag decisions; no persistence."""

from curriculum_api.catalogue.domain.values import bool_payload as _default_bool_payload
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def merge_partial_module_structure(
    stored,
    payload,
    *,
    ModuleAuthoringValidationError,
    ModuleStructureDeltaConflict,
    clean_str=_default_clean_str,
):
    """Rebuild the whole module a full save would have sent, from a partial one.

    Module fields come from the payload alone -- as in a full save, where they
    come from the client and nowhere else. Weeks and components the author
    changed come from ``structureDelta``; everything else is the stored copy.
    The delta carries the order of every week and component, so moves,
    reorders and removals need no rows of their own.
    """
    delta = payload.get('structureDelta')
    if not isinstance(delta, dict):
        raise ModuleAuthoringValidationError([{'path': 'structureDelta', 'message': 'A partial save needs its changes.'}])
    stored_weeks = {clean_str(week.get('id')): week for week in (stored.get('weekStructure') or [])}
    stored_components = {
        clean_str(component.get('id')): component
        for week in stored_weeks.values()
        for component in (week.get('components') or [])
    }
    changed_weeks = delta.get('weeks') if isinstance(delta.get('weeks'), dict) else {}
    changed_components = delta.get('components') if isinstance(delta.get('components'), dict) else {}
    component_order = delta.get('componentOrder') if isinstance(delta.get('componentOrder'), dict) else {}
    week_order = delta.get('weekOrder') if isinstance(delta.get('weekOrder'), list) else []
    weeks = []
    for raw_week_id in week_order:
        week_id = clean_str(raw_week_id)
        source = changed_weeks.get(week_id) or stored_weeks.get(week_id)
        if not isinstance(source, dict):
            raise ModuleStructureDeltaConflict(f'Week {week_id} is not in the saved module.')
        components = []
        for raw_component_id in component_order.get(week_id) or []:
            component_id = clean_str(raw_component_id)
            component = changed_components.get(component_id) or stored_components.get(component_id)
            if not isinstance(component, dict):
                raise ModuleStructureDeltaConflict(f'Component {component_id} is not in the saved module.')
            components.append(component)
        weeks.append({**{key: value for key, value in source.items() if key != 'components'}, 'components': components})
    module_fields = {
        key: value for key, value in payload.items()
        if key not in {'saveMode', 'structureDelta', 'expectedRevision', 'expected_revision', 'weekStructure', 'weeks'}
    }
    return {**module_fields, 'weekStructure': weeks}


def component_assurance_flag(
    component,
    stored_row,
    camel_key,
    column,
    default,
    *,
    bool_payload=_default_bool_payload,
):
    """One assurance flag, resolved without inventing an answer.

    The three flags - reflection, tutor validation, coach validation - are
    authored on one screen and written by two different save paths, and the
    module-structure save rewrites every component in the module whether or not
    the author touched it. So the only safe reading of a payload that does not
    mention a flag is "not supplied", and the only safe response is to keep what
    the row already held.

    It used to read ``bool_payload(component.get('reflectionRequired'))``, which
    cannot tell an explicit ``false`` from an absent key and answered ``False``
    to both, while coach validation defaulted the other way and answered
    ``True``. A component object that had lost the two keys therefore came back
    from a save with reflection cleared and coach validation switched on -- and
    because the two defaults point in opposite directions, the pair flipped
    together in opposite directions, over and over, as the author moved between
    a screen that carried the flags and one that did not. It is visible in the
    revision log as ~1,100 paired flips across 600 components.

    The schema default is used only when there is no stored row to preserve,
    which is to say only when this component is being created.
    """
    for key in (camel_key, column):
        if key in component:
            return bool_payload(component.get(key))
    if stored_row is None:
        return default
    stored = stored_row.get(column)
    # A row written before the column existed reports None, and that means
    # "nobody ever set this", not "off" - the same reading component_coach_validation
    # applies to a narrowed read.
    return default if stored is None else bool_payload(stored)
