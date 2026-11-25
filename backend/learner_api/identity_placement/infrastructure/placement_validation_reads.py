"""Existing placement existence and lineage checks against canonical IDs."""

from django.apps import apps


def _model(name):
    return apps.get_model("learner_api", name)


def programme_exists(programme_id, *, using):
    return _model("PlacementProgramme").objects.using(using).filter(
        pk=programme_id,
    ).exists()


def cohort_exists(cohort_id, programme_id, *, using):
    return _model("PlacementCohort").objects.using(using).filter(
        pk=cohort_id,
        programme_id=programme_id,
    ).exists()


def group_exists(group_id, programme_id, cohort_id, *, using):
    return _model("PlacementGroup").objects.using(using).filter(
        pk=group_id,
        programme_id=programme_id,
        cohort_id=cohort_id,
    ).exists()
