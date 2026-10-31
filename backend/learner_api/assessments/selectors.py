"""Read-only selectors for learner quiz entitlement.

Login accounts identify learners in ``enrolment.Created_users``.  Learner plan
records use the independent ``Learner.learners`` primary-key space, so the
``enrolment_id`` bridge is mandatory here; equal numeric primary keys and email
matches are deliberately not fallbacks.
"""
from dataclasses import dataclass
from typing import Any

from coach_api.weekly_learning import assignment_projection

from ..learning_plan import effective_training_plan, request_preset_cache
from ..models import EnrolmentUser, LearnerProfile, attach_programme_name
from ..weekly_learning import build_learning_content_summary


QUIZ_SOURCE_FIELDS = (
    "id", "learner_type", "cohort", "group",
    "modules", "weeks", "components",
)


@dataclass(frozen=True)
class QuizLearnerContext:
    source: Any
    profile: LearnerProfile
    enrolment_id: int
    kind: str


def resolve_quiz_learner(enrolment_id):
    """Resolve one active learner using only the verified identity bridge."""
    try:
        enrolment_id = int(str(enrolment_id).strip())
    except (TypeError, ValueError):
        return None
    if enrolment_id <= 0:
        return None

    # The stored plans can contain thousands of historical component snapshots.
    # Authorization needs only current module membership and assignment mode;
    # project those keys in SQL instead of transferring the whole JSON row.
    source_query = assignment_projection(
        EnrolmentUser.all_learners.using("enrolment").only(*QUIZ_SOURCE_FIELDS)
    )
    source = source_query.filter(pk=enrolment_id).first()
    if source is None:
        return None
    attach_programme_name(source)
    source.training_plan = source._weekly_training_plan
    source.learning_plan = source._weekly_learning_plan

    profile = (
        LearnerProfile.objects.using("enrolment")
        .only("id", "enrolment_id", "lifecycle_status")
        .filter(enrolment_id=enrolment_id, lifecycle_status__iexact="active")
        .first()
    )
    if profile is None:
        return None

    source_kind = str(getattr(source, "learner_type", "") or "").strip().lower()
    kind = "commercial" if source_kind == "commercial" else "apprenticeship"
    return QuizLearnerContext(
        source=source,
        profile=profile,
        enrolment_id=enrolment_id,
        kind=kind,
    )


def learner_has_quiz_entitlement(context, quiz_id):
    """Whether the canonical learner workspace exposes ``quiz_id``.

    This intentionally reuses the same effective-plan and Curriculum placement
    projection as My Learning.  A smaller bespoke join would drift from group
    inheritance, component links, module links, and legacy plan placement.
    Passing an empty progress tuple keeps this selector read-only and avoids
    loading attempts that cannot affect assignment membership.
    """
    assigned = effective_training_plan(
        context.source,
        request_preset_cache(context.source),
    )
    if not assigned:
        return False

    content = build_learning_content_summary(
        context.source,
        context.enrolment_id,
        assigned_modules=assigned,
        strict=True,
        identities_only=True,
        preserve_legacy=True,
        progress=([], [], []),
        quiz_id=quiz_id,
    )
    expected = str(quiz_id)
    return any(
        str((component.get("quizMeta") or {}).get("quizId")) == expected
        for component in content.get("components", [])
        if isinstance(component, dict) and isinstance(component.get("quizMeta"), dict)
    )
