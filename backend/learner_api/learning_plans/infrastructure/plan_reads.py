"""Existing normalized plan existence and enrolment bridge reads; no repair or writes."""


def profile_for(learner, *, LearnerProfile):
    """The one learner profile linked to this enrolment row, or None."""
    return (LearnerProfile.objects.using(learner._state.db or 'default')
            .only('id', 'enrolment_id').filter(enrolment_id=learner.pk).first())


def has_plan_rows(profile, *, LearnerTrainingPlanModule):
    return profile is not None and LearnerTrainingPlanModule.objects.filter(learner=profile).exists()


def has_module_row(profile, module_id, *, LearnerTrainingPlanModule):
    return profile is not None and LearnerTrainingPlanModule.objects.filter(
        learner=profile, curriculum_module_id=module_id).exists()
