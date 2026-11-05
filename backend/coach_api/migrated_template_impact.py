"""Refuse template edits that would strand answers in its working reviews."""
from .migrated_reviews import EDITABLE_STATUSES
from .migrated_template_sync import TemplateSyncConflict, merge_snapshot
from .models import ImportedReviewInstance


def answer_conflicts(template):
    """Caller holds the family lock, as do coach/participant answer saves.

    Do not lock overlays here: their writers lock the overlay before the family.
    Taking those locks in reverse order would deadlock. Only inspect the saved
    snapshots/answers; never synchronize or rewrite reviews during authoring.
    """
    fields, affected = set(), 0
    reviews = ImportedReviewInstance.objects.filter(
        migrated_template_id=template.pk, status__in=EDITABLE_STATUSES,
    ).values_list("template_snapshot", "answers").iterator(chunk_size=200)
    for snapshot, answers in reviews:
        try:
            merge_snapshot(snapshot, answers or {}, template, template.review_family)
        except TemplateSyncConflict as exc:
            if not exc.fields:
                # Legacy assignments from another family are not edited here.
                continue
            fields.update(exc.fields)
            affected += 1
    if not affected:
        return None
    return {
        "code": "template_answer_conflict",
        "detail": (
            f"This change conflicts with saved answers in {affected} working "
            f"{'review' if affected == 1 else 'reviews'}. Keep the existing question "
            "type and options already used, or add a new question instead. "
            "Your template has not been changed."
        ),
        "fields": sorted(fields),
        "affectedReviews": affected,
    }
