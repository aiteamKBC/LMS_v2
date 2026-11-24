"""Staff directory projections and curriculum assignment display queries."""
from datetime import date


class StaffDirectoryUnavailable(Exception):
    """The requested staff identity source could not be read."""

from curriculum_api.catalogue.domain.staff_identity import is_blank_staff_assignment as _default_is_blank_staff_assignment
from curriculum_api.catalogue.domain.staff_identity import module_matches_staff_assignment as _default_module_matches_staff_assignment
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key as _default_staff_assignment_key
from curriculum_api.catalogue.domain.staff_identity import staff_profile_email as _default_staff_profile_email
from curriculum_api.catalogue.domain.staff_identity import staff_profile_identity_key as _default_staff_profile_identity_key
from curriculum_api.catalogue.domain.staff_identity import staff_profile_is_archived as _default_staff_profile_is_archived
from curriculum_api.catalogue.domain.staff_identity import staff_profile_name as _default_staff_profile_name
from curriculum_api.catalogue.domain.staff_identity import staff_user_archived as _default_staff_user_archived
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import slugify as _default_slugify
from curriculum_api.catalogue.domain.values import truthy as _default_truthy
from curriculum_api.catalogue.domain.values import unique as _default_unique


def staff_user_profile_source(
    row,
    role,
    *,
    clean_str=_default_clean_str,
    slugify=_default_slugify,
    staff_user_archived=_default_staff_user_archived,
):
    row = row or {}
    public_id = clean_str(row.get('uuid')) or clean_str(row.get('id'))
    return {
        'id': public_id or f'{role}-{slugify(row.get("Username"))}',
        'staffUserId': clean_str(row.get('id')),
        'uuid': clean_str(row.get('uuid')),
        'role': role,
        'name': clean_str(row.get('Username')),
        'email': clean_str(row.get('Email')),
        'phone': clean_str(row.get('Phone_number')),
        'job_title': clean_str(row.get('Position')),
        'status': 'archived' if staff_user_archived(row) else 'active',
        'access': clean_str(row.get('Access')).lower(),
        'is_archived': staff_user_archived(row),
        'created_at': row.get('Created_at'),
        'updated_at': row.get('Updated_at'),
    }


def module_in_progress(module, *, clean_str=_default_clean_str, parse_date=_default_parse_date):
    status = clean_str(module.get('deliveryStatus') or module.get('status')).lower()
    if status in {'active', 'in_progress', 'in-progress'}:
        return True
    today = date.today()
    start = parse_date(module.get('startDate'))
    end = parse_date(module.get('endDate'))
    return bool(start and end and start <= today <= end)


def profile_module_summary(module, *, module_in_progress):
    return {
        'id': module.get('id'),
        'moduleId': module.get('moduleId'),
        'moduleCatalogueId': module.get('moduleCatalogueId'),
        'deliveryRowId': module.get('deliveryRowId'),
        'name': module.get('name') or '',
        'programmeId': module.get('programmeId') or '',
        'programme': module.get('programme') or '',
        'cohortId': module.get('cohortId') or '',
        'cohort': module.get('cohort') or '',
        'groupId': module.get('groupId') or '',
        'group': module.get('group') or '',
        'startDate': module.get('startDate') or '',
        'endDate': module.get('endDate') or '',
        'status': 'in_progress' if module_in_progress(module) else (module.get('deliveryStatus') or module.get('status') or 'unknown'),
    }


def assigned_modules_for_staff(
    name,
    role,
    modules,
    stored_ids=None,
    stored_group_ids=None,
    *,
    clean_str=_default_clean_str,
    module_matches_staff_assignment=_default_module_matches_staff_assignment,
    profile_module_summary,
    staff_assignment_key=_default_staff_assignment_key,
):
    key = staff_assignment_key(name)
    stored_ids = [clean_str(item) for item in (stored_ids or []) if clean_str(item)]
    stored_group_ids = {clean_str(item) for item in (stored_group_ids or []) if clean_str(item)}
    assigned = []
    for module in modules:
        module_staff = module.get('coach') if role == 'coach' else module.get('tutor')
        matched_by_staff = key and staff_assignment_key(module_staff) == key
        matched_by_stored_id = any(module_matches_staff_assignment(module, item) for item in stored_ids)
        matched_by_group_id = clean_str(module.get('groupId')) in stored_group_ids
        if matched_by_staff or matched_by_stored_id or matched_by_group_id:
            assigned.append(profile_module_summary(module))
    assigned.sort(key=lambda item: (item.get('startDate') or '', item.get('programme') or '', item.get('name') or ''))
    return assigned


def serialize_staff_profile(
    row,
    role,
    modules=None,
    groups=None,
    *,
    as_json_value=_default_as_json_value,
    assigned_modules_for_staff,
    clean_str=_default_clean_str,
    format_date=_default_format_date,
    group_coaches,
    slugify=_default_slugify,
    staff_assignment_key=_default_staff_assignment_key,
    staff_profile_name=_default_staff_profile_name,
    truthy=_default_truthy,
    unique=_default_unique,
):
    """One staff member, with the curriculum they hold.

    Who holds what is read off the curriculum by name: a tutor's modules are the
    modules naming them, a coach's groups are the groups naming them. The staff
    row itself carries no assignment -- it is the person, not the posting -- so
    ``stored*Ids`` only ever carry what a legacy row still happens to hold.
    """
    row = row or {}
    name = staff_profile_name(row)
    name_key = staff_assignment_key(name)
    stored_ids = as_json_value(row.get('assigned_module_ids') or row.get('assignedModuleIds'), []) if role == 'tutor' else []
    stored_group_ids = as_json_value(row.get('assigned_group_ids') or row.get('assignedGroupIds'), []) if role == 'coach' else []
    valid_group_ids = {
        clean_str(group.get('id') or group.get('groupId'))
        for group in groups or []
        if clean_str(group.get('id') or group.get('groupId'))
    }
    named_group_ids = [
        clean_str(group.get('id') or group.get('groupId'))
        for group in groups or []
        if role == 'coach' and name_key and name_key in {
            staff_assignment_key(coach)
            for coach in group_coaches.split_names(group.get('coaches') or group.get('coach'))
        }
        and clean_str(group.get('id') or group.get('groupId'))
    ]
    assigned_group_ids = unique([
        *named_group_ids,
        *[clean_str(item) for item in stored_group_ids if clean_str(item)],
    ])
    if groups is not None:
        assigned_group_ids = [item for item in assigned_group_ids if item in valid_group_ids]
    assigned_modules = assigned_modules_for_staff(name, role, modules or [], stored_ids, assigned_group_ids) if role == 'tutor' else []
    active_modules = [module for module in assigned_modules if module.get('status') == 'in_progress']
    profile = {
        'id': row.get('id') or f'{role}-{slugify(name)}',
        'role': role,
        'name': name,
        'email': row.get('email') or '',
        'phone': row.get('phone') or '',
        'jobTitle': row.get('job_title') or row.get('jobTitle') or row.get('role') or '',
        'status': row.get('status') or ('archived' if truthy(row.get('is_archived')) else 'active'),
        'specialisms': as_json_value(row.get('specialisms'), []),
        'notes': row.get('notes') or '',
        'isArchived': truthy(row.get('is_archived')),
        'updatedAt': format_date(row.get('updated_at')),
    }
    if clean_str(row.get('access')):
        profile['access'] = clean_str(row.get('access')).lower()
    if clean_str(row.get('staffUserId')):
        profile['staffUserId'] = clean_str(row.get('staffUserId'))
    if clean_str(row.get('uuid')):
        profile['uuid'] = clean_str(row.get('uuid'))
    if role == 'coach':
        profile.update({
            'assignedGroupIds': assigned_group_ids,
            'groupCount': len(assigned_group_ids),
        })
    else:
        profile.update({
            'assignedModuleIds': [module.get('id') for module in assigned_modules if module.get('id')],
            'storedAssignedModuleIds': stored_ids,
            'assignedModules': assigned_modules,
            'inProgressModules': active_modules,
            'moduleCount': len(assigned_modules),
            'inProgressCount': len(active_modules),
        })
    return profile


def build_staff_profiles(
    profile_rows,
    role,
    modules=None,
    groups=None,
    *,
    build_modules,
    clean_str=_default_clean_str,
    enrich_modules_with_authoring,
    get_module_rows,
    get_program_config_rows,
    get_training_rows,
    is_blank_staff_assignment=_default_is_blank_staff_assignment,
    serialize_staff_profile,
    staff_profile_identity_key=_default_staff_profile_identity_key,
):
    """Staff of one role, each carrying the curriculum they hold.

    Only the people in ``profile_rows`` -- the staff directory's own answer for
    this role -- are ever returned. A name typed onto a delivery row used to be
    merged in here as a stand-in profile, which meant curriculum could invent a
    tutor nobody had given tutor access to, and deleting the person in Users
    left the invented copy behind. Assignments are still read off the curriculum
    by name, so the list cannot disagree with what a module or group says.
    """
    if modules is None:
        modules = enrich_modules_with_authoring(build_modules(get_module_rows(), get_training_rows(), get_program_config_rows()))
    merged = {}
    for row in profile_rows or []:
        serialized = serialize_staff_profile(row, role, modules, groups)
        if is_blank_staff_assignment(serialized.get('name')) and is_blank_staff_assignment(serialized.get('email')):
            continue
        key = staff_profile_identity_key(serialized.get('name'), serialized.get('email')) or clean_str(serialized['id'])
        if key in merged:
            continue
        merged[key] = serialized

    return sorted(
        merged.values(),
        key=lambda item: (item.get('status') == 'archived', item.get('name', '').lower()),
    )


def build_staff_user_profile_collection(
    role,
    visibility='operational',
    *,
    authoring_modules_as_catalogue_rows,
    build_cohorts_and_groups,
    build_modules,
    build_staff_profiles,
    get_program_config_rows,
    get_staff_profile_rows,
    get_training_rows,
    is_operational_training_row,
):
    """The staff of one role, each with the curriculum they hold.

    The people come from the staff directory; the assignments are read off the
    curriculum itself, by name, so this cannot disagree with what a module or a
    group says its tutor and coach are.
    """
    profile_rows = get_staff_profile_rows(role, include_archived=visibility == 'all')
    if not profile_rows:
        return []

    training_rows = get_training_rows()
    if visibility != 'all':
        training_rows = [row for row in training_rows if is_operational_training_row(row)]
    if role != 'tutor':
        # A coach profile carries the groups that name the coach and nothing
        # module-shaped (see serialize_staff_profile), so building the module
        # catalogue here only cost round trips. [] rather than None: None
        # makes build_staff_profiles build the catalogue itself.
        _, groups = build_cohorts_and_groups(
            training_rows,
            get_program_config_rows(),
            include_archived=visibility == 'all',
        )
        return build_staff_profiles(profile_rows, role, [], groups)
    # Tutor profiles only expose module identities/dates/status. Week titles
    # and group statistics cannot affect those fields.
    catalogue = authoring_modules_as_catalogue_rows(week_rows=[])
    modules = build_modules(
        catalogue,
        training_rows,
        get_program_config_rows(),
        include_unused=visibility == 'all',
    )
    return build_staff_profiles(profile_rows, role, modules, [])


def build_curriculum_tutor_profile_collection(
    visibility='operational',
    *,
    authoring_modules_as_catalogue_rows,
    build_modules,
    build_staff_profiles,
    clean_str,
    get_program_config_rows,
    get_training_rows,
    is_operational_training_row,
    read_curriculum_tutor_rows,
):
    rows = read_curriculum_tutor_rows()
    profiles = []
    for row in rows:
        status = clean_str(row.get('status')).lower() or 'active'
        archived = status in {'archived', 'inactive', 'disabled'}
        if archived and visibility != 'all':
            continue
        profiles.append({
            'id': clean_str(row.get('id')),
            'staffUserId': '',
            'uuid': '',
            'role': 'tutor',
            'name': clean_str(row.get('name')),
            'email': clean_str(row.get('email')),
            'phone': clean_str(row.get('phone')),
            'job_title': 'Tutor',
            'status': 'archived' if archived else 'active',
            'access': 'tutor',
            'is_archived': archived,
        })
    if not profiles:
        return []
    training_rows = get_training_rows()
    if visibility != 'all':
        training_rows = [row for row in training_rows if is_operational_training_row(row)]
    catalogue = authoring_modules_as_catalogue_rows(week_rows=[])
    modules = build_modules(
        catalogue,
        training_rows,
        get_program_config_rows(),
        include_unused=visibility == 'all',
    )
    return build_staff_profiles(profiles, 'tutor', modules, [])


def find_staff_profile_row(
    role,
    identifier,
    include_archived=True,
    *,
    clean_str=_default_clean_str,
    get_staff_profile_rows,
    normalise=_default_normalise,
    slugify=_default_slugify,
    staff_assignment_key=_default_staff_assignment_key,
    staff_profile_email=_default_staff_profile_email,
    staff_profile_is_archived=_default_staff_profile_is_archived,
    staff_profile_name=_default_staff_profile_name,
):
    ident = clean_str(identifier)
    if not ident:
        return None
    rows = get_staff_profile_rows(role, include_archived=include_archived)
    for row in rows:
        if clean_str(row.get('id')) == ident:
            return row
    searchable_rows = [row for row in rows if not staff_profile_is_archived(row)] + [row for row in rows if staff_profile_is_archived(row)]
    email_key = normalise(ident)
    if email_key:
        for row in searchable_rows:
            if normalise(staff_profile_email(row)) == email_key:
                return row
    slug = slugify(ident)
    ident_key = staff_assignment_key(ident)
    for row in searchable_rows:
        name = staff_profile_name(row)
        if slugify(name) == slug or staff_assignment_key(name) == ident_key:
            return row
    return None


def find_staff_user_profile(
    role,
    identifier,
    *,
    build_staff_user_profile_collection,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    staff_assignment_key=_default_staff_assignment_key,
):
    """One tutor or coach, by whichever identifier a caller has for them.

    An id, the staff user's uuid or row id, an email, or the name a module or
    group holds them under: a curriculum screen has only ever had one of those,
    and they all name the same person in the staff directory.
    """
    ident = clean_str(identifier)
    if not ident:
        return None
    profiles = build_staff_user_profile_collection(role, 'all')
    for profile in profiles:
        candidates = [
            clean_str(profile.get('id')),
            clean_str(profile.get('uuid')),
            clean_str(profile.get('staffUserId')),
        ]
        if ident in [value for value in candidates if value]:
            return profile
    email_key = normalise(ident)
    if email_key:
        for profile in profiles:
            if normalise(profile.get('email')) == email_key:
                return profile
    name_key = staff_assignment_key(ident)
    if name_key:
        for profile in profiles:
            if staff_assignment_key(profile.get('name')) == name_key:
                return profile
    return None


def staff_profile_assignment_ids(
    role,
    row,
    *,
    as_json_value,
    clean_assignment_ids,
    clean_str,
    normalise,
    safe_authoring_module_rows,
    staff_assignment_key,
    staff_profile_email,
    staff_profile_name,
):
    """Return the canonical module IDs assigned to a tutor profile.

    Older staff-profile rows may still carry an explicit JSON assignment list.
    Current staff profiles come from the enrolment directory, so their
    curriculum assignment is represented by the tutor name/email stored on
    authoring modules. Supporting both shapes keeps the workspace compatible
    with existing data while the directory remains the identity source.
    """
    if role != 'tutor' or not row:
        return []

    stored_ids = clean_assignment_ids(as_json_value(
        row.get('assigned_module_ids') or row.get('assignedModuleIds'),
        [],
    ))

    profile_name = staff_profile_name(row)
    profile_email = staff_profile_email(row)
    if not profile_name and not profile_email:
        return stored_ids

    name_key = staff_assignment_key(profile_name)
    email_key = normalise(profile_email) if profile_email else ''
    assigned_ids = list(stored_ids)
    for module in safe_authoring_module_rows():
        module_id = clean_str(module.get('module_catalogue_id'))
        tutor_name_key = staff_assignment_key(module.get('tutor_name'))
        tutor_email_key = normalise(clean_str(module.get('tutor_email'))) if profile_email else ''
        if module_id and ((name_key and tutor_name_key == name_key) or (email_key and tutor_email_key == email_key)):
            assigned_ids.append(module_id)
    return clean_assignment_ids(assigned_ids)


def staffing_assignments(groups):
    """Display the already-resolved group assignments without reading or writing."""
    return [
            {
                'id': group['id'],
                'groupId': group['id'],
                'group': group['name'],
                'cohort': group['cohort'],
                'programme': group['programme'],
                'tutor': group['tutor'],
                'coach': group['coach'],
                'status': 'unassigned' if group['tutor'] == 'Unassigned' and group['coach'] == 'Unassigned' else 'assigned',
            }
            for group in groups
        ]


def canonical_staff_assignment_name(
    role, value, include_archived=True, *, clean_str, find_staff_profile_row,
    is_blank_staff_assignment, staff_profile_name,
):
    assignment = clean_str(value)
    # Blank and 'Unassigned' both mean "nobody". Comparing the *key* against
    # 'unassigned' never matched, so the sentinel used to survive as a name.
    if is_blank_staff_assignment(assignment):
        return ''
    row = find_staff_profile_row(role, assignment, include_archived=include_archived)
    return staff_profile_name(row) or assignment


def resolve_staff_assignment_email(
    role, value, include_archived=True, *, clean_str, find_staff_profile_row,
    is_blank_staff_assignment, staff_profile_email,
):
    """The staff directory email behind a tutor/coach name, or ''.

    Modules only ever store the assigned person as a *name* (``tutor_name``),
    matched here the same way ``canonical_staff_assignment_name`` matches it --
    by id, then email, then name/slug -- against ``enrolment.Staff_users``. A
    name with no matching staff profile (renamed, archived and excluded, or
    simply mistyped) resolves to '' rather than raising, since a module save
    must not fail just because the invite email could not be derived.
    """
    assignment = clean_str(value)
    if is_blank_staff_assignment(assignment):
        return ''
    row = find_staff_profile_row(role, assignment, include_archived=include_archived)
    return staff_profile_email(row) if row else ''
