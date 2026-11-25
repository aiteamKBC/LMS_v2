"""Staff identity and assignment matching; no database or framework dependencies."""
import re

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import truthy as _default_truthy


def staff_user_archived(row, *, clean_str=_default_clean_str):
    status = clean_str((row or {}).get(' Status') or (row or {}).get('status')).lower()
    return status in {'archived', 'inactive', 'disabled'}


def is_blank_staff_text(value, *, clean_str=_default_clean_str, normalise=_default_normalise):
    value = clean_str(value)
    return not value or normalise(value) in {'emptystring', 'unassigned'}


def staff_profile_name(profile, *, clean_str=_default_clean_str, is_blank_staff_text=is_blank_staff_text):
    if not profile:
        return ''
    for value in (
        profile.get('name'),
        profile.get('Tutor_name'),
        profile.get('Coach_name'),
        profile.get('email'),
    ):
        text = clean_str(value)
        if not is_blank_staff_text(text):
            return text
    return ''


def staff_profile_email(profile, *, clean_str=_default_clean_str, is_blank_staff_text=is_blank_staff_text):
    email = clean_str((profile or {}).get('email'))
    return '' if is_blank_staff_text(email) else email


def is_blank_staff_assignment(value, *, is_blank_staff_text=is_blank_staff_text):
    return is_blank_staff_text(value)


def staff_assignment_key(
    value,
    *,
    is_blank_staff_assignment=is_blank_staff_assignment,
    normalise=_default_normalise,
):
    if is_blank_staff_assignment(value):
        return ''
    return normalise(value)


def staff_profile_identity_key(
    name='',
    email='',
    *,
    is_blank_staff_text=is_blank_staff_text,
    normalise=_default_normalise,
    staff_assignment_key=staff_assignment_key,
):
    email_key = '' if is_blank_staff_text(email) else normalise(email)
    if email_key:
        return f'email:{email_key}'
    name_key = staff_assignment_key(name)
    if name_key and name_key != 'unassigned':
        return f'name:{name_key}'
    return ''


def staff_profile_is_archived(row, *, clean_str=_default_clean_str, truthy=_default_truthy):
    row = row or {}
    return truthy(row.get('is_archived')) or clean_str(row.get('status')).lower() == 'archived'


def module_assignment_ids(module, *, clean_str=_default_clean_str):
    """Every identifier one module answers to.

    A module is named differently by each screen that holds it -- catalogue id,
    delivery row, source id -- so anything matching a module against an
    identifier somebody typed or stored has to compare against all of them.
    """
    values = [
        module.get('id'),
        module.get('moduleId'),
        module.get('moduleCatalogueId'),
        module.get('module_catalogue_id'),
        module.get('deliveryRowId'),
        module.get('delivery_row_id'),
        module.get('deliveryModuleId'),
        module.get('delivery_module_id'),
        module.get('catalogueId'),
        module.get('catalogue_id'),
        module.get('sourceId'),
        module.get('source_id'),
    ]
    ids = set()
    for value in values:
        text = clean_str(value)
        if not text:
            continue
        ids.add(text)
        canonical_match = re.search(r'(MOD-[A-Z0-9][A-Z0-9_-]*)', text, re.IGNORECASE)
        if canonical_match:
            ids.add(canonical_match.group(1))
    return ids


def module_matches_staff_assignment(
    module,
    assignment_id,
    *,
    clean_str=_default_clean_str,
    module_assignment_ids=module_assignment_ids,
):
    requested = clean_str(assignment_id)
    if not requested:
        return False
    candidates = {requested}
    canonical_match = re.search(r'(MOD-[A-Z0-9][A-Z0-9_-]*)', requested, re.IGNORECASE)
    if canonical_match:
        candidates.add(canonical_match.group(1))
    return bool(candidates.intersection(module_assignment_ids(module)))


def clean_assignment_ids(values, *, clean_str=_default_clean_str):
    seen = set()
    result = []
    for value in values or []:
        text = clean_str(value)
        if not text:
            continue
        expanded = [text]
        canonical_match = re.search(r'(MOD-[A-Z0-9][A-Z0-9_-]*)', text, re.IGNORECASE)
        if canonical_match:
            expanded.append(canonical_match.group(1))
        for item in expanded:
            if item in seen:
                continue
            seen.add(item)
            result.append(item)
    return result
