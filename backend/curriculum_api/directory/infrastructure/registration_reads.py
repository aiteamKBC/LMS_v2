"""Registration source acquisition and display projection; profile identity is never an enrolment key."""


def _row(learner, assigned, module_count, *, placement_profile, clean_str):
    # The module card buckets by the profile's lifecycle status. Keep the
    # drawer on that same canonical status instead of re-labelling the legacy
    # programme status as lifecycle status in the browser.
    profile = placement_profile(learner)
    return {
        'id': str(learner.pk), 'name': clean_str(learner.username) or clean_str(learner.email),
        'email': clean_str(learner.email), 'programme': clean_str(learner.programme),
        'company': clean_str(learner.employer) or clean_str(learner.organization),
        'cohort': clean_str(learner.cohort), 'group': clean_str(learner.group),
        'programmeStatus': clean_str(learner.programme_status),
        'lifecycleStatus': clean_str(getattr(profile, 'lifecycle_status', '')),
        'learnerType': clean_str(learner.learner_type) or 'apprenticeship',
        'assigned': assigned, 'moduleCount': module_count,
    }


def assigned_sources(members, *, EnrolmentUser, with_placements):
    learners = with_placements(EnrolmentUser.all_learners.filter(pk__in=members).only(
        'id', 'username', 'email', 'programme_id', 'cohort_id', 'group_id',
        'employer', 'organization', 'programme_status', 'learner_type',
    ).order_by('username', 'id'))
    return learners


def progress_sources(enrolment_ids, *, EnrolmentUser, SOURCE_FIELDS, with_placements):
    return {str(source.pk): source for source in with_placements(
        EnrolmentUser.all_learners.only(*SOURCE_FIELDS).filter(pk__in=enrolment_ids))}
