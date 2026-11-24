"""Concrete catalogue / infrastructure / record identity capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_id
from curriculum_api.catalogue.domain.read_contracts import STRUCTURE_REVISION_VOLATILE_COLUMNS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from datetime import datetime
import re
import uuid


def now_iso():
    return datetime.utcnow().isoformat()


def unique_prefixed_id(prefix, value='', existing_values=None):
    """Canonicalise a requested id, or mint a fresh one that is not taken.

    A canonical request is returned as-is: the id is the caller's assertion of
    identity, so an entity being updated keeps its id whether or not it is
    already stored. ``existing_values`` may be a callable, which is then only
    invoked on the mint path — the id lists for cohorts and groups cost a whole
    table read each (see unique_cohort_id/unique_group_id), and a tree save asks
    for one per cohort and per group while every request is already canonical.
    """
    requested = clean_str(value)
    if re.match(rf'^{re.escape(prefix)}-[A-Z0-9][A-Z0-9_-]*$', requested, re.I):
        return f'{prefix}-{requested.split("-", 1)[1]}'

    values = existing_values() if callable(existing_values) else existing_values
    existing = {clean_str(item) for item in (values or []) if clean_str(item)}
    while True:
        # Multiple unsaved siblings are minted before the bulk insert. Windows
        # clock resolution can give them the same microsecond timestamp, and
        # existing_values cannot contain rows that have not been inserted yet.
        candidate = f'{prefix}-{datetime.utcnow().strftime("%Y%m%d%H%M%S%f")}{uuid.uuid4().hex[:12].upper()}'
        if candidate not in existing:
            return candidate


def unique_timestamp_prefixed_id(prefix, existing_values=None):
    existing = {clean_str(value) for value in (existing_values or []) if clean_str(value)}
    while True:
        candidate = f'{prefix}-{datetime.utcnow().strftime("%Y%m%d%H%M%S%f")}{uuid.uuid4().hex[:12].upper()}'
        if candidate not in existing:
            return candidate


def unique_program_id(value, configs):
    return unique_prefixed_id('PROG', value, [programme_config_id(config) for config in configs if programme_config_id(config)])


def unique_ksb_profile_id(value='', existing_values=None):
    requested = clean_str(value)
    existing = {clean_str(value) for value in (existing_values or []) if clean_str(value)}
    if requested.startswith('PROG-'):
        requested = f'KSBP-{requested.removeprefix("PROG-")}'
    return unique_prefixed_id('KSBP', requested, existing)


def canonical_authoring_id(prefix, value=''):
    return unique_prefixed_id(prefix, value)


def unique_module_catalogue_id(value=''):
    requested = clean_str(value)
    try:
        existing = [row.get('module_catalogue_id') for row in authoring_fetch_all(AUTHORING_MODULES_TABLE)]
    except Exception:
        existing = []
    if re.match(r'^MOD-[A-Z0-9][A-Z0-9_-]*$', requested, re.I) and requested not in existing:
        return requested
    if requested in existing:
        return requested
    return unique_prefixed_id('MOD', '', existing)


def record_revision(sources):
    from curriculum_api.catalogue.infrastructure.record_revisions import record_revision as query
    return query(
        sources,
        authoring_fetch_all=authoring_fetch_all,
        STRUCTURE_REVISION_VOLATILE_COLUMNS=STRUCTURE_REVISION_VOLATILE_COLUMNS,
        logger=logger,
    )


def free_programme_course_id(module, existing=None):
    requested = clean_str(module.get('courseId') or module.get('course_id'))
    if re.match(r'^FREECOURSE-[0-9]{20}$', requested):
        return requested
    return unique_timestamp_prefixed_id('FREECOURSE', existing or [])
