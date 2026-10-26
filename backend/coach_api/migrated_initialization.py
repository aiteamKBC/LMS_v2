"""Canonical explicit initialization, shared by the coach and reconciliation."""
from django.db import transaction

from .models import ImportedReviewInstance
from .migrated_reviews import initial_local_status, review_family, validate_definition
from .migrated_templates import resolve_template, snapshot_for
from .migrated_template_sync import lock_template_family
from .migrated_signature_rules import requirements_for_definition


def initialize_imported_review(owner_email, definition):
    if not definition.get("canInitialize") or definition.get("readOnly") is False:
        raise ValueError("This imported review cannot be initialized.")
    family = review_family((definition.get("historicalReview") or {}).get("type"))
    source_id = int(definition["historicalReview"]["id"])
    with transaction.atomic():
        from .views import lock_learner_calendar
        from learner_api.models import LearnerProfile
        learner_id = definition['instance']['learnerId']
        lock_learner_calendar(learner_id)
        current_owner = LearnerProfile.objects.filter(pk=learner_id).values_list('coach_email', flat=True).first()
        if str(current_owner or '').strip().casefold() != owner_email.strip().casefold():
            raise ValueError('The learner assignment changed. Reload before initializing this review.')
        if ImportedReviewInstance.objects.filter(learner_id=learner_id, source_review_id=source_id).exclude(
                owner_email__iexact=owner_email.strip().casefold()).exists():
            raise ValueError('This review is still owned by a different Coach and requires handover.')
        lock_template_family(family)
        template = resolve_template(definition["migratedProgrammeKey"], family, lock=True)
        if template is None:
            raise ValueError("No approved migrated template is assigned.")
        validate_definition(template.definition_json)
        answers = {}
        status = initial_local_status(definition.get("sourceStatus"))
        if family == "PSP":
            from .personal_support_form import initial_answers
            answers = initial_answers(source_id, definition["instance"]["learnerId"], template.definition_json)
            if str(definition.get("sourceStatus", "")).casefold().replace(" ", "-") == "in-progress":
                status = "in-progress"
        overlay, created = ImportedReviewInstance.objects.get_or_create(
            owner_email=owner_email, event_key=definition["instance"]["id"],
            defaults={
                "learner_id": definition["instance"]["learnerId"], "source_review_id": source_id,
                "migrated_template": template, "template_snapshot": snapshot_for(template),
                "signature_requirements": requirements_for_definition(template.definition_json, family), "answers": answers,
                "status": status,
            },
        )
        if (overlay.learner_id != definition["instance"]["learnerId"]
                or overlay.source_review_id != source_id or not overlay.template_snapshot):
            raise ValueError("An existing overlay has a different source association.")
        return overlay, created
