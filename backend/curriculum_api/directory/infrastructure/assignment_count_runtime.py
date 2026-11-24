"""Compose the existing profile/enrolment count modes without coupling normalized readers to legacy plans."""
from curriculum_api.catalogue.domain.values import clean_str


def attach_module_assignment_counts(modules, *, learner_profiles=False):
    from curriculum_api.directory.application.assignment_counts import attach_module_assignment_counts as implementation

    def load_status_counts():
        from curriculum_api.directory.infrastructure.membership_runtime import status_counts as read
        return read

    def load_assignment_counts():
        from curriculum_api.learner_assignment_counts_sql import bulk_assigned_learner_counts_sql as read
        return read
    return implementation(
        modules, learner_profiles=learner_profiles,
        clean_str=clean_str, load_assignment_counts=load_assignment_counts, load_status_counts=load_status_counts,
    )
