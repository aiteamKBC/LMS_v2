"""Tutor identity, assignment scope and workspace projection; session reads remain an existing capability."""


def tutor_profile_for_identity(email, name, *, get_staff_profile_rows, clean_str):
    """The tutor profile for a login account, and how it was found.

    Returns ``(row, matched_by)`` where matched_by is 'email', 'name' or ''.

    Email is tried first because it is the stronger key: two colleagues can
    share a name, and a rename does not change an address. Name is the fallback
    because in practice the profiles are created in the curriculum studio where
    the email field is optional, so a profile that has never been given one
    would otherwise be unreachable — which is exactly the state the only tutor
    profile here was in.

    Both comparisons ignore case and surrounding space: the account is created
    from a form ("test TUTOR" from a first/last name pair) while the profile is
    typed by hand, so they routinely differ in capitalisation alone.

    A blank stored email never matches, or every caller without a match would
    collide with it.
    """
    rows = get_staff_profile_rows('tutor', include_archived=False)

    wanted_email = clean_str(email).lower()
    if wanted_email:
        for row in rows:
            if clean_str(row.get('email')).lower() == wanted_email:
                return row, 'email'

    wanted_name = clean_str(name).lower()
    if wanted_name:
        for row in rows:
            if clean_str(row.get('name')).lower() == wanted_name:
                return row, 'name'

    return None, ''


def tutor_workspace_module_payload(row, *, clean_str, iso_or_blank):
    """One assigned module, as the workspace shows it."""
    return {
        'moduleCatalogueId': clean_str(row.get('module_catalogue_id')),
        'title': clean_str(row.get('title')),
        'description': clean_str(row.get('description')),
        'programmeName': clean_str(row.get('programme_name')),
        'cohortName': clean_str(row.get('cohort_name')),
        'groupName': clean_str(row.get('group_name')),
        'colour': clean_str(row.get('color')),
        'totalOtjh': row.get('total_otjh'),
        'sessionsNumber': row.get('sessions_number'),
        'startDate': iso_or_blank(row.get('start_date')),
        'endDate': iso_or_blank(row.get('end_date')),
        # The planned weekly slot, which is the module's intent. The live
        # sessions are the meetings actually scheduled against it.
        'sessionWeekDay': clean_str(row.get('session_week_day')),
        'sessionStartTime': clean_str(row.get('session_start_time')),
        'sessionEndTime': clean_str(row.get('session_end_time')),
    }


def tutor_workspace_payload(
    email, name, *, tutor_profile_for_identity, staff_profile_assignment_ids,
    tutor_workspace_next_session_by_module, read_module_rows, tutor_workspace_module_payload,
    clean_str,
):
    profile, matched_by = tutor_profile_for_identity(email, name)

    # A tutor's module scope is read from the explicit assignment grant when
    # present, with the current curriculum name/email assignment as the
    # directory-backed fallback.
    module_ids = list(staff_profile_assignment_ids('tutor', profile)) if profile else []

    if not profile:
        # Not an error: an account that matches no tutor profile is the
        # ordinary state until somebody assigns them something in Curriculum >
        # Staff profiles.
        return {
            'linked': False,
            'matchedBy': '',
            'tutor': None,
            'assignedModuleIds': [],
            'modules': [],
            'nextSession': None,
        }

    sessions_by_module = tutor_workspace_next_session_by_module(module_ids)

    modules = []
    if module_ids:
        module_rows = read_module_rows(module_ids)
        for row in module_rows:
            payload = tutor_workspace_module_payload(row)
            # Each module carries its own next session, so opening one does not
            # need a second request to find out when it next runs.
            payload['nextSession'] = sessions_by_module.get(payload['moduleCatalogueId'])
            modules.append(payload)

    headline = min(
        sessions_by_module.values(),
        key=lambda session: session['scheduledStart'],
        default=None,
    )

    return {
        'linked': True,
        # Which key resolved the tutor, so the page can say so and a support
        # question about "why can this account see these modules" is answerable.
        'matchedBy': matched_by,
        'tutor': {
            'id': clean_str(profile.get('id')) if profile else '',
            'name': clean_str(profile.get('name')) if profile else name,
            'email': clean_str(profile.get('email')) if profile else email,
            'jobTitle': clean_str(profile.get('job_title')) if profile else '',
        },
        # This is the source of truth for both this list and `modules`.
        'assignedModuleIds': module_ids,
        'modules': modules,
        'nextSession': headline,
    }
