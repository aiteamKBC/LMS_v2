"""Application archive queries. Explicit read capabilities preserve legacy contracts."""


def archived_cohort_learners(
    cohort_row, counts=None, *, active_learner_delivery_counts, clean_str, delivery_learner_count,
    normalise,
):
    """Live learners still placed in an archived cohort, by id or by name."""
    if counts is None:
        counts, _group_counts = active_learner_delivery_counts()
    return delivery_learner_count(counts, clean_str(cohort_row.get('cohort_id')), (
        normalise(cohort_row.get('programme_name')),
        normalise(cohort_row.get('cohort_name')),
    ))


def archived_group_learners(
    group_row, counts=None, *, active_learner_delivery_counts, clean_str, delivery_learner_count,
    normalise,
):
    """Live learners still placed in an archived group, by id or by name."""
    if counts is None:
        _cohort_counts, counts = active_learner_delivery_counts()
    return delivery_learner_count(counts, clean_str(group_row.get('group_id')), (
        normalise(group_row.get('programme_name')),
        normalise(group_row.get('cohort_name')),
        normalise(group_row.get('group_name')),
    ))


def archived_cohort_payload(
    row, archived_group_rows, cohort_learner_counts, holiday_rows=None, *, archive_stamp_fields,
    archived_cohort_learners, clean_str, serialize_cohort_authoring_detail,
):
    # ``holiday_rows`` is the calendar read once for the whole list. Left out,
    # each cohort reads both holiday tables again -- two round trips per row,
    # ~33 s of a 40 s archive read with 47 archived cohorts.
    detail = serialize_cohort_authoring_detail(row, holiday_rows)
    cohort_id = clean_str(row.get('cohort_id'))
    return {
        'id': cohort_id,
        'name': clean_str(row.get('cohort_name')),
        'programme': clean_str(row.get('programme_name')),
        'programmeId': clean_str(row.get('programme_id')),
        'startDate': detail['startDate'],
        'endDate': detail['endDate'],
        'practicalEndDate': detail['practicalEndDate'],
        'apprenticeshipEndDate': detail['apprenticeshipEndDate'],
        'epaMonths': detail['epaMonths'],
        'durationMonths': detail['durationMonths'],
        'color': detail['color'],
        'status': 'archived',
        # Archived groups only. These are the rows a restore would bring back
        # and a permanent delete would remove, so they are the ones worth
        # counting in front of either button.
        'groups': len([
            group for group in archived_group_rows
            if clean_str(group.get('cohort_id')) == cohort_id
        ]),
        'learners': archived_cohort_learners(row, cohort_learner_counts),
        **archive_stamp_fields(row),
    }


def archived_group_payload(
    row, cohort_rows_by_id, group_learner_counts, *, archive_stamp_fields, archived_group_learners,
    clean_str, curriculum_row_is_archived, serialize_group_authoring_detail,
):
    detail = serialize_group_authoring_detail(row)
    group_id = clean_str(row.get('group_id'))
    cohort_id = clean_str(row.get('cohort_id'))
    parent = cohort_rows_by_id.get(cohort_id)
    return {
        'id': group_id,
        'name': clean_str(row.get('group_name')),
        'cohortId': cohort_id,
        'cohort': clean_str(row.get('cohort_name')),
        'programmeId': clean_str(row.get('programme_id')),
        'programme': clean_str(row.get('programme_name')),
        'coach': detail['coach'],
        'weekDays': detail['weekDays'],
        'startTime': detail['startTime'],
        'endTime': detail['endTime'],
        'schedule': detail['schedule'],
        'color': detail['color'],
        'status': 'archived',
        'learners': archived_group_learners(row, group_learner_counts),
        # Whether the parent cohort is itself archived decides what a restore
        # can do here: a group cannot come back into a cohort that is not in the
        # list. A group with no cohort at all has nothing to wait for.
        'cohortArchived': bool(cohort_id) and (
            parent is None or curriculum_row_is_archived(parent)
        ),
        **archive_stamp_fields(row),
    }


def archived_module_payload(
    row, component_counts, *, archive_stamp_fields, archived_parent_programme, clean_str,
    module_stored_week_count, parse_int,
):
    """One archived module, with what a restore or a delete would move."""
    catalogue_id = clean_str(row.get('module_catalogue_id'))
    programme_id = clean_str(row.get('programme_id'))
    return {
        'id': catalogue_id,
        'catalogueId': catalogue_id,
        'title': clean_str(row.get('title')),
        'programmeId': programme_id,
        'programme': clean_str(row.get('programme_name')),
        'cohortId': clean_str(row.get('cohort_id')),
        'cohort': clean_str(row.get('cohort_name')),
        'groupId': clean_str(row.get('group_id')),
        'group': clean_str(row.get('group_name')),
        'tutor': clean_str(row.get('tutor_name')),
        'weeks': module_stored_week_count(row),
        'sessions': parse_int(row.get('sessions_number'), 0),
        'components': component_counts.get(catalogue_id, 0),
        'status': 'archived',
        # The catalogue is scoped by programme, so a module restored under an
        # archived programme comes back invisible. The view disables its Restore
        # on this rather than letting the endpoint refuse after the click.
        'programmeArchived': bool(archived_parent_programme(programme_id)),
        **archive_stamp_fields(row),
    }


def archive_stamp_fields(row, *, clean_str, format_created_at):
    """How a row came to be archived, in the shape the archive view reads."""
    return {
        'archivedAt': format_created_at(row.get('deleted_at')),
        # 'cohort-delete' / 'group-delete' / 'programme-delete' -- the write
        # handler that archived it, never a person: no authoring table records
        # who made the request.
        'archivedBy': clean_str(row.get('deleted_by')),
        # Set only where a parent's archive took this row down with it, and then
        # it holds that parent's id -- which is the record that has to be
        # restored to bring this one back.
        'archivedViaParent': clean_str(row.get('deleted_via_parent')),
    }
