"""Add next-booking access to existing MCM and Progress Review templates.

Dry-run by default. Editable instances follow their live template on read;
signed and completed instance snapshots remain frozen.
"""
from django.core.management.base import BaseCommand, CommandError

from ... import review_types, reviews
from ...next_review_booking_question import (
    plan_mcm_participant_access, plan_sections,
    with_mcm_participant_access, with_next_booking_question,
)


class Command(BaseCommand):
    help = "Add next-booking question to Progress Reviews and learner answer access to MCMs. Dry-run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Update eligible templates.")
        parser.add_argument("--template-id", help="Limit to one MCM or Progress Review template.")

    def handle(self, *args, **options):
        template_id = options.get("template_id")
        type_index = review_types.review_type_index()
        rows = reviews.get_review_template_rows(
            "id = %s" if template_id else "1 = 1", [template_id] if template_id else [],
        )
        allowed_codes = {review_types.REVIEW_TYPE_CODE_MCM, review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW}
        relevant_rows = [row for row in rows if
                         (type_index.get(row.get("review_type_id")) or {}).get("code") in allowed_codes]
        if template_id and not relevant_rows:
            raise CommandError("The selected template is not an active MCM or Progress Review template.")
        for row in relevant_rows:
            definition = reviews.review_template_detail_payload(row, type_index=type_index)
            code = (type_index.get(row.get("review_type_id")) or {}).get("code")
            if code == review_types.REVIEW_TYPE_CODE_MCM:
                action = plan_mcm_participant_access(definition["sections"])
                updated_sections = with_mcm_participant_access
            else:
                action = plan_sections(definition["sections"])
                updated_sections = with_next_booking_question
            self.stdout.write(f"{row['id']} ({code}): {action}")
            if not options["apply"] or action not in {"add", "add_participant"}:
                continue
            _, errors = reviews.update_review(
                row["id"], {"sections": updated_sections(definition["sections"])},
                actor="next-review-booking-backfill",
            )
            if errors:
                raise CommandError(f"Template {row['id']} could not be updated: {errors}")
        if not options["apply"]:
            self.stdout.write("DRY RUN: no templates changed.")
