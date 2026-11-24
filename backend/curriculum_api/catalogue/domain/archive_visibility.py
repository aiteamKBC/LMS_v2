"""Domain archive visibility. Explicit read capabilities preserve legacy contracts."""


def curriculum_row_is_archived(row, *, clean_str, curriculum_row_effectively_deleted):
    """Is this cohort/group row one the active lists leave out?

    Deliberately the exact complement of what ``build_cohorts_and_groups`` skips:
    the soft-delete stamps ``curriculum_row_effectively_deleted`` already covers,
    plus a legacy row carrying only ``status = 'archived'``. Anything the live
    list hides has to be reachable from the archive or it is invisible in both,
    which is the state this whole section exists to end.
    """
    return curriculum_row_effectively_deleted(row) or clean_str((row or {}).get('status')).lower() == 'archived'
