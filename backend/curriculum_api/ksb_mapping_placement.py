"""Where a KSB mapping sits in the curriculum: its component's module and week.

``curriculum.ksb_mappings`` keeps ``component_id`` (foreign key, RESTRICT) and
``standard_ksb_id``. It no longer stores ``module_catalogue_id`` / ``week_id``
(the component's) or ``ksb_code`` / ``ksb_description`` (the standard KSB's).
A write that scopes mappings by module or week therefore scopes them through
their component, and a read that wants the placement joins it from there.

The SQLite test schema still stores the placement on the mapping; there the
plain column conditions are used, so both shapes select the same rows.
"""
from __future__ import annotations

PLACEMENT_FIELDS = ('module_catalogue_id', 'week_id')


def stores_placement():
    """True when ``ksb_mappings`` still carries its own module/week columns."""
    from . import views
    return views.has_column(views.AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id')


def where(module_ids=None, week_id=None, component_ids=None):
    """``(where_sql, params)`` selecting mappings by placement.

    ``module_ids`` is one id or a list; ``week_id`` narrows to one week;
    ``component_ids`` narrows to those components (and is enough on its own).
    Every argument given must match.
    """
    from . import views
    if isinstance(module_ids, str):
        module_ids = [module_ids]
    module_ids = [views.clean_str(value) for value in (module_ids or []) if views.clean_str(value)]
    component_ids = [views.clean_str(value) for value in (component_ids or []) if views.clean_str(value)]
    week_id = views.clean_str(week_id)

    if stores_placement():
        clauses, params = [], []
        if module_ids:
            clauses.append(f'module_catalogue_id in ({", ".join(["%s"] * len(module_ids))})')
            params += module_ids
        if week_id:
            clauses.append('week_id = %s')
            params.append(week_id)
        if component_ids:
            clauses.append(f'component_id in ({", ".join(["%s"] * len(component_ids))})')
            params += component_ids
        return ' and '.join(clauses) or '1 = 0', params

    clauses, params = [], []
    owner, owner_params = [], []
    if module_ids:
        owner.append(f'c.module_catalogue_id in ({", ".join(["%s"] * len(module_ids))})')
        owner_params += module_ids
    if week_id:
        owner.append('c.week_id = %s')
        owner_params.append(week_id)
    if owner:
        components = views.authoring_table_name(views.AUTHORING_COMPONENTS_TABLE)
        clauses.append(f'component_id in (select c.id from {components} c where {" and ".join(owner)})')
        params += owner_params
    if component_ids:
        clauses.append(f'component_id in ({", ".join(["%s"] * len(component_ids))})')
        params += component_ids
    return ' and '.join(clauses) or '1 = 0', params
