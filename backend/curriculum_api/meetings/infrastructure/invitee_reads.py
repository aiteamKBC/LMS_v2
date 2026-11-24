"""Existing module presenter and normalized learner-plan reads."""


def module_invitee_sources(module_catalogue_id, *, authoring_fetch_all,
                           AUTHORING_MODULES_TABLE, LearnerTrainingPlanModule, LearnerProfile, clean_str):
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    module_row = module_rows[0] if module_rows else {}
    tutor_email = clean_str(module_row.get('tutor_email'))
    mirror_emails = list(
        LearnerTrainingPlanModule.objects
        .filter(curriculum_module_id=module_catalogue_id)
        .exclude(learner__email='')
        .values_list('learner__email', flat=True)
        .distinct()
    )
    plan_emails = list(
        LearnerProfile.objects
        .filter(plan_modules__curriculum_module_id=module_catalogue_id)
        .exclude(email='')
        .values_list('email', flat=True)
        .distinct()
    )
    return tutor_email, plan_emails, mirror_emails
