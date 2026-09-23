"""Explicitly map one unsigned MCM Review Instance's existing summary field.

Dry-run is the default and prints an owner-reviewable report. Applying is an
intentional, one-instance/one-field data operation; this command is never run
automatically and refuses instances that have entered the signature stage.
"""
import json
from copy import deepcopy
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from ... import review_instances, review_types, reviews
from ... import views as curriculum_views


class Command(BaseCommand):
    help = "Report or explicitly map one unsigned MCM Review Instance Meeting Summary field."

    def add_arguments(self, parser):
        parser.add_argument("instance_id")
        parser.add_argument("field_id")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist this exact instance/field mapping. Without this flag the command is read-only.",
        )

    def handle(self, *args, **options):
        instance_id = curriculum_views.clean_str(options["instance_id"])
        field_id = curriculum_views.clean_str(options["field_id"])
        instance = review_instances.get_review_instance(instance_id)
        if not instance:
            raise CommandError("Review Instance not found.")
        self._validate_unsigned(instance)

        snapshot = curriculum_views.as_json_value(instance.get("definition_snapshot"), {})
        if snapshot.get("reviewTypeCode") != review_types.REVIEW_TYPE_CODE_MCM:
            raise CommandError("The selected frozen Review definition is not an MCM.")
        fields = self._fields(snapshot.get("sections", []))
        field = next((item for item in fields if curriculum_views.clean_str(item.get("id")) == field_id), None)
        if not field:
            raise CommandError("The exact field ID does not exist in this frozen Review definition.")
        if field.get("fieldType") not in {"text", "text_multiline"}:
            raise CommandError("The mapped Meeting Summary must be an existing text field.")
        conflicts = [
            item.get("id") for item in fields
            if (item.get("configuration") or {}).get("semanticKey") == reviews.MEETING_SUMMARY_SEMANTIC_KEY
            and item.get("id") != field_id
        ]
        if conflicts:
            raise CommandError(f"Another field is already mapped: {', '.join(conflicts)}")

        report = {
            "mode": "apply" if options["apply"] else "dry-run",
            "reviewInstanceId": instance_id,
            "status": instance.get("status"),
            "reviewTypeCode": "mcm",
            "fieldId": field_id,
            "fieldTitleForReviewOnly": field.get("title") or "",
            "semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY,
            "willModifyOnlyDefinitionSnapshot": bool(options["apply"]),
        }
        self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
        if not options["apply"]:
            self.stdout.write(self.style.WARNING("DRY RUN: no data was changed. Re-run with --apply only after owner approval."))
            return

        with transaction.atomic():
            locked = review_instances.get_review_instance(instance_id, for_update=True)
            if not locked:
                raise CommandError("Review Instance no longer exists.")
            self._validate_unsigned(locked)
            updated_snapshot = deepcopy(curriculum_views.as_json_value(locked.get("definition_snapshot"), {}))
            if updated_snapshot.get("reviewTypeCode") != review_types.REVIEW_TYPE_CODE_MCM:
                raise CommandError("The frozen Review definition changed and is no longer an MCM.")
            locked_fields = self._fields(updated_snapshot.get("sections", []))
            updated_field = next(
                (item for item in locked_fields if item.get("id") == field_id),
                None,
            )
            if not updated_field:
                raise CommandError("The frozen field changed while the mapping was being reviewed.")
            if updated_field.get("fieldType") not in {"text", "text_multiline"}:
                raise CommandError("The mapped field changed and is no longer a text field.")
            locked_conflicts = [
                item.get("id") for item in locked_fields
                if (item.get("configuration") or {}).get("semanticKey") == reviews.MEETING_SUMMARY_SEMANTIC_KEY
                and item.get("id") != field_id
            ]
            if locked_conflicts:
                raise CommandError(f"Another field was mapped first: {', '.join(locked_conflicts)}")
            updated_field["configuration"] = {
                **(updated_field.get("configuration") or {}),
                "semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY,
            }
            rows = curriculum_views.update_rows(
                review_instances.REVIEW_INSTANCES_TABLE,
                "id = %s and status not in (%s, %s)",
                [instance_id, review_instances.STATUS_AWAITING_SIGNATURE, review_instances.STATUS_COMPLETED],
                {
                    "definition_snapshot": curriculum_views.json_db_value(updated_snapshot),
                    "updated_by": "mcm-summary-explicit-mapping",
                    "updated_at": datetime.utcnow(),
                },
            )
            if not rows:
                raise CommandError("The Review entered the signature stage; no mapping was applied.")
        self.stdout.write(self.style.SUCCESS("Mapped the exact unsigned Review Instance field."))

    @staticmethod
    def _validate_unsigned(instance):
        if instance.get("status") in {
            review_instances.STATUS_AWAITING_SIGNATURE,
            review_instances.STATUS_COMPLETED,
        }:
            raise CommandError("Signed/submitted historical Review definitions cannot be mapped.")

    @classmethod
    def _fields(cls, sections):
        result = []

        def walk(fields):
            for field in fields or []:
                result.append(field)
                walk(field.get("yesFields"))
                walk(field.get("noFields"))

        for section in sections or []:
            walk(section.get("fields"))
        return result
