"""Revision reads for catalogue drawers and week templates.

Storage, schema guards and legacy identifier resolution are explicit capabilities.
The HTTP adapter retains response encoding and method restrictions.
"""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def programme_record_revision(
    identifier,
    *,
    ensure_module_authoring_tables,
    programme_config_by_identifier,
    programme_config_key_column,
    logger,
    clean_str=_default_clean_str,
    record_revision,
    quote_ident,
):
    """Fingerprint of the ``programmes`` row a programme PATCH rewrites.

    The name cascade onto cohorts, groups and modules is deliberately left out.
    It is derived from this row rather than authored, so folding it in would
    make a rename of the programme look like a change to every child -- and
    would refuse a colleague's unrelated cohort edit.
    """
    ensure_module_authoring_tables()
    config = programme_config_by_identifier(identifier)
    if not config:
        return ''
    try:
        key_column = programme_config_key_column()
    except Exception:
        logger.warning('Unable to resolve the programmes key column.', exc_info=True)
        return ''
    key_value = config.get(key_column)
    if not clean_str(key_value):
        return ''
    return record_revision((
        ('programme', 'programmes', quote_ident(key_column) + ' = %s', [key_value], key_column),
    ))


def cohort_record_revision(
    cohort_id,
    *,
    clean_str=_default_clean_str,
    ensure_module_authoring_tables,
    record_revision,
    COHORT_AUTHORING_DETAILS_TABLE,
):
    """Fingerprint of the single ``curriculum.cohorts`` row a cohort PATCH writes."""
    ident = clean_str(cohort_id)
    if not ident:
        return ''
    ensure_module_authoring_tables()
    return record_revision((
        ('cohort', COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [ident], 'cohort_id'),
    ))


def group_record_revision(
    group_id,
    *,
    clean_str=_default_clean_str,
    ensure_module_authoring_tables,
    record_revision,
    GROUPS_TABLE,
):
    """Fingerprint of the single ``curriculum.groups`` row a group PATCH writes.

    The delivery-slot cascade onto the group's module rows is left out for the
    reason the programme rename is: those rows inherit the slot, so including
    them would report a module's own schedule edit as a change to the group.
    The group row is what the group drawer authors, and it moves whenever the
    cascade has anything to do.
    """
    ident = clean_str(group_id)
    if not ident:
        return ''
    ensure_module_authoring_tables()
    return record_revision((
        ('group', GROUPS_TABLE, 'group_id = %s', [ident], 'group_id'),
    ))


def week_template_revision(
    template_id,
    *,
    clean_str=_default_clean_str,
    ensure_week_template_tables,
    record_revision,
    WEEK_TEMPLATES_TABLE,
    WEEK_TEMPLATE_COMPONENTS_TABLE,
    read_template_mapping_revision,
):
    """Fingerprint of the week template and the components it owns.

    Both tables, because a week template PATCH deletes every component row and
    re-inserts the list it was sent: the components are the part of the record
    an author spends an afternoon on, and a token that only covered the header
    row would let a colleague's whole component list be replaced unnoticed.
    """
    ident = clean_str(template_id)
    if not ident:
        return ''
    ensure_week_template_tables()
    revision = record_revision((
        ('template', WEEK_TEMPLATES_TABLE, 'id = %s', [ident], 'id'),
        ('components', WEEK_TEMPLATE_COMPONENTS_TABLE, 'week_template_id = %s', [ident], 'id'),
    ))
    if not revision:
        return ''
    mappings = read_template_mapping_revision(ident)
    return hashlib.sha256(json.dumps([revision,mappings],default=str).encode()).hexdigest()[:32]


def module_record_revision(
    identifier,
    *,
    clean_str=_default_clean_str,
    module_structure_revision,
    resolve_stored_module_catalogue_id,
):
    """Fingerprint of the module a drawer PATCH writes.

    Shared with the Module Builder rather than its own: the drawer writes
    through ``save_module_authoring_structure``, the same helper the structure
    PATCH uses, so one token means a drawer edit and a Builder save can never
    be told apart -- and either one refuses a stale copy of the other.
    """
    ident = clean_str(identifier)
    if not ident:
        return ''
    return module_structure_revision(resolve_stored_module_catalogue_id(ident) or ident)


def curriculum_record_revision(
    kind,
    identifier,
    *,
    CURRICULUM_RECORD_REVISIONS,
    logger,
):
    """The current token for one record, or '' if it cannot be read."""
    read = CURRICULUM_RECORD_REVISIONS.get(kind)
    if not read:
        return ''
    try:
        return read(identifier) or ''
    except Exception:
        logger.warning('Unable to read the %s revision for %s.', kind, identifier, exc_info=True)
        return ''


def read_record_revisions(
    values_for_kind,
    *,
    CURRICULUM_RECORD_REVISIONS,
    unique,
    clean_str,
    curriculum_record_revision,
):
    """Current tokens for the records named in the query string.

    The drawers open their record from the curriculum overview, which is a
    cached payload shared by every screen; a token minted there would be one
    more thing to keep fresh, and would go stale exactly when a colleague saved.
    So they ask for it here instead -- one indexed read per record, off the
    cache entirely, when the drawer opens and again whenever it adopts a stored
    version.

    ``?cohort=COHORT-1&cohort=COHORT-2&group=GROUP-9`` answers
    ``{"revisions": {"cohort": {"COHORT-1": "..."}, "group": {...}}}``. A record
    that cannot be fingerprinted is answered with '' rather than left out, so a
    caller can tell "unreadable" from "not asked for": a drawer holding ''
    sends no token and saves unguarded, which is what it did before any of this.
    """
    revisions = {}
    for kind in CURRICULUM_RECORD_REVISIONS:
        wanted = unique([
            clean_str(value) for value in values_for_kind(kind) if clean_str(value)
        ])
        if not wanted:
            continue
        revisions[kind] = {
            identifier: curriculum_record_revision(kind, identifier)
            for identifier in wanted
        }
    return {'revisions': revisions}

import hashlib
import json
