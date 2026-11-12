"""The shape a curriculum write stores: what each value means to the table.

- ``status``: the archived value is ``inactive``. Groups, modules, weeks,
  components, KSB mappings and staff rows CHECK status to ('active',
  'inactive') -- there it is only the archive flag. Writers still send display
  states (a group 'planned' from its cohort, a module 'draft'/'published');
  those are not a lifecycle change, so they are not stored: an insert takes the
  column default ('active') and an update leaves the archive state alone (a
  coerced 'active' would restore an archived row).
- Foreign keys: writers send '' for "none" (a module saved without a group, a
  group without a coach), which a key refuses. A nullable key stores NULL --
  the same "none", cleared on update as '' always cleared it; a NOT NULL key
  keeps what it has (the update leaves it alone).
- ``ksb_mappings``: a mapping names its KSB by code; the table stores the
  standard KSB's id (``ksb_mapping_placement.standard_ksb_id_for``).

The chosen tutor / coach is stored as its id by ``curriculum_names.store_staff``.
"""
from __future__ import annotations

from . import archive_state, ksb_mapping_placement

# Status is CHECKed to ('active', 'inactive') on these.
BINARY_STATUS_TABLES = frozenset({
    'groups', 'modules', 'weeks', 'components', 'ksb_mappings', 'coaches', 'tutors',
})
NULLABLE_FOREIGN_KEYS = {
    'cohorts': ('programme_id',),
    'groups': ('coach_id',),
    'modules': ('programme_id', 'cohort_id', 'group_id', 'tutor_id'),
    'weeks': ('module_catalogue_id', 'free_course_id'),
    'ksb_mappings': ('component_id',),
}
REQUIRED_FOREIGN_KEYS = {
    'groups': ('programme_id', 'cohort_id'),
    'components': ('week_id', 'module_catalogue_id'),
    'ksb_mappings': ('standard_ksb_id', 'component_id'),
}


def _blank(value):
    return isinstance(value, str) and not value.strip()


def normalise(table, payload, columns):
    """``(payload, columns that may be written as NULL)`` for one write. Returns a copy."""
    if not payload:
        return payload, set()
    columns = set(columns or ())
    payload = archive_state.normalise_write(table, dict(payload))
    nullable = set()

    if table in BINARY_STATUS_TABLES and 'status' in payload:
        value = str(payload.get('status') or '').strip().lower()
        if value in archive_state.INACTIVE_STATUSES:
            payload['status'] = archive_state.INACTIVE
        elif value == archive_state.ACTIVE:
            payload['status'] = archive_state.ACTIVE
        else:
            payload.pop('status')

    for column in NULLABLE_FOREIGN_KEYS.get(table, ()):
        if column in payload and column in columns and _blank(payload[column]):
            payload[column] = None
            nullable.add(column)
    for column in REQUIRED_FOREIGN_KEYS.get(table, ()):
        if column in payload and _blank(payload[column]):
            payload.pop(column)

    if table == 'ksb_mappings' and 'standard_ksb_id' in columns and not payload.get('standard_ksb_id'):
        if payload.get('ksb_id') or payload.get('ksb_code'):
            resolved = ksb_mapping_placement.standard_ksb_id_for(
                payload.get('ksb_id') or '', payload.get('ksb_code') or '',
                module_catalogue_id=payload.get('module_catalogue_id') or '',
                source_type=payload.get('source_type') or '', source_id=payload.get('source_id') or '',
            )
            if resolved is not None:
                payload['standard_ksb_id'] = resolved
    return payload, nullable
