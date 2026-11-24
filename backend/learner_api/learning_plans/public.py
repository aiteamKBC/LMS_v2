"""Supported cross-capability learning-plan reads.

Writers are intentionally absent: ``training_plan_writes.reconcile_training_plan``
remains the sole normalized training-plan writer.
"""

from .application.module_membership import (
    module_member_enrolment_ids,
    module_member_enrolment_ids_by_module,
)
from .domain.effective_plan import effective_module_ids_from_state
from .domain.membership_policy import members_for_lineages
from .domain.stored_plan import clean_text, maybe_json, stored_training_plan


def effective_module_ids(learner, preset_cache=None, *, saved_plan=...):
    from .composition import effective_module_ids as implementation

    return implementation(learner, preset_cache, saved_plan=saved_plan)


def normalized_plan_snapshot(learner_id, *, using=None):
    from .composition import normalized_plan_snapshot as implementation

    return implementation(learner_id, using=using)


def learner_membership_facts(
    module_ids, profile_ids=None, *, connection, table_exists, columns_for,
):
    from .infrastructure.membership_facts import learner_facts

    return learner_facts(
        module_ids,
        profile_ids,
        connection=connection,
        table_exists=table_exists,
        columns_for=columns_for,
    )


def normalized_plan_profile_for(learner, *, learner_profile_model):
    from .infrastructure.plan_reads import profile_for

    return profile_for(learner, LearnerProfile=learner_profile_model)


def normalized_plan_has_rows(profile, *, plan_module_model):
    from .infrastructure.plan_reads import has_plan_rows

    return has_plan_rows(profile, LearnerTrainingPlanModule=plan_module_model)


def normalized_plan_has_module(profile, module_id, *, plan_module_model):
    from .infrastructure.plan_reads import has_module_row

    return has_module_row(
        profile,
        module_id,
        LearnerTrainingPlanModule=plan_module_model,
    )


__all__ = [
    "clean_text",
    "effective_module_ids",
    "effective_module_ids_from_state",
    "learner_membership_facts",
    "maybe_json",
    "members_for_lineages",
    "module_member_enrolment_ids",
    "module_member_enrolment_ids_by_module",
    "normalized_plan_has_module",
    "normalized_plan_has_rows",
    "normalized_plan_profile_for",
    "normalized_plan_snapshot",
    "stored_training_plan",
]
