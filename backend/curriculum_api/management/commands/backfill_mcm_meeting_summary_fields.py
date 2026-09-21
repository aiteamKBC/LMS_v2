"""Backfill the canonical Meeting Summary field on MCM definitions.

The command is deliberately dry-run by default.  ``--apply`` is an explicit
owner-run data operation which updates live MCM templates and only editable
Review Instance snapshots.  Awaiting-signature and completed instances are
reported but never changed, preserving signed historical definitions.

The operation is idempotent: an existing single ``meeting_summary`` marker is
left alone; an unambiguous existing Summary field is marked; otherwise a new,
optional text field is added to a Meeting Summary section.  The optional
backfill field avoids making an old, already-completed form invalid merely
because the integration was introduced later.  New templates may continue to
make the field required through the normal Form Builder.
"""
from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from ... import review_instances, review_types, reviews
from ... import views as curriculum_views


PROTECTED_STATUSES = frozenset({
    review_instances.STATUS_AWAITING_SIGNATURE,
    review_instances.STATUS_COMPLETED,
})
PROTECTED_STATUS_PARAMS = (
    review_instances.STATUS_AWAITING_SIGNATURE,
    review_instances.STATUS_COMPLETED,
)


def _normalise_title(value):
    return " ".join(str(value or "").strip().casefold().split())


def _walk_fields(sections):
    """Yield ``(section, field)`` for every field, including case children."""
    def walk(section, fields):
        for field in fields or []:
            yield section, field
            yield from walk(section, field.get("yesFields"))
            yield from walk(section, field.get("noFields"))

    for section in sections or []:
        yield from walk(section, section.get("fields"))


def _meeting_summary_candidates(sections):
    """Find fields that are safe to interpret as the formal summary field.

    A field titled ``Meeting Summary`` is always a candidate.  A field titled
    ``Summary`` is considered only inside a section titled ``Meeting Summary``;
    this prevents the legacy ``Previous Meeting Summary`` answer from being
    selected accidentally.
    """
    candidates = []
    for section, field in _walk_fields(sections):
        field_title = _normalise_title(field.get("title"))
        section_title = _normalise_title(section.get("title"))
        if field_title == "meeting summary" or (
            field_title == "summary" and section_title == "meeting summary"
        ):
            candidates.append(field)
    return candidates


def _semantic_fields(sections):
    return [
        field
        for _, field in _walk_fields(sections)
        if (field.get("configuration") or {}).get("semanticKey")
        == reviews.MEETING_SUMMARY_SEMANTIC_KEY
    ]


def _new_summary_section():
    # Optional for legacy snapshots: this cannot invalidate an otherwise
    # complete draft merely because the integration was added afterwards.
    return {
        "id": "",
        "title": "Meeting Summary",
        "estimatedMinutes": 0,
        "enabled": True,
        "fields": [{
            "id": "",
            "title": "Summary",
            "fieldType": "text_multiline",
            "required": False,
            "configuration": {
                "placeholder": "Summarise progress, key discussion points, risks, support and next steps...",
                "semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY,
            },
        }],
    }


def plan_definition(definition):
    """Return a non-mutating backfill plan for a template/snapshot payload."""
    definition = definition if isinstance(definition, dict) else {}
    sections = definition.get("sections") if isinstance(definition.get("sections"), list) else []
    semantic = _semantic_fields(sections)
    if len(semantic) == 1:
        return {"action": "already_mapped", "fieldId": semantic[0].get("id") or ""}
    if len(semantic) > 1:
        return {"action": "ambiguous_multiple_markers", "fieldIds": [f.get("id") or "" for f in semantic]}

    labelled = _meeting_summary_candidates(sections)
    candidates = [
        field for field in labelled
        if field.get("fieldType") in {"text", "text_multiline"}
    ]
    if labelled and not candidates:
        return {
            "action": "invalid_summary_field_type",
            "fieldIds": [field.get("id") or "" for field in labelled],
        }
    if len(candidates) == 1:
        return {"action": "mark_existing_field", "fieldId": candidates[0].get("id") or ""}
    if len(candidates) > 1:
        return {"action": "ambiguous_summary_fields", "fieldIds": [f.get("id") or "" for f in candidates]}
    return {"action": "add_new_field", "fieldId": "<generated>"}


def apply_definition_backfill(definition):
    """Mutate and return a definition according to :func:`plan_definition`."""
    updated = deepcopy(definition if isinstance(definition, dict) else {})
    sections = updated.setdefault("sections", [])
    plan = plan_definition(updated)
    if plan["action"] in {
        "already_mapped",
        "ambiguous_multiple_markers",
        "ambiguous_summary_fields",
        "invalid_summary_field_type",
    }:
        return updated, plan

    if plan["action"] == "mark_existing_field":
        for _, field in _walk_fields(sections):
            if field.get("id") == plan["fieldId"]:
                field["configuration"] = {
                    **(field.get("configuration") or {}),
                    "semanticKey": reviews.MEETING_SUMMARY_SEMANTIC_KEY,
                }
                break
        return updated, plan

    # Prefer an existing, unambiguous Meeting Summary section.  Otherwise the
    # new section is appended, preserving every existing display order.
    summary_sections = [
        section for section in sections
        if _normalise_title(section.get("title")) == "meeting summary"
    ]
    if len(summary_sections) == 1:
        summary_sections[0].setdefault("fields", []).append(_new_summary_section()["fields"][0])
    elif len(summary_sections) == 0:
        sections.append(_new_summary_section())
    else:
        return updated, {"action": "ambiguous_summary_sections"}
    return updated, plan


def materialise_snapshot_ids(definition):
    """Mint IDs for fields/sections newly added to a frozen JSON snapshot.

    ``reviews.update_review`` mints blank authoring IDs while it persists a
    template.  Review Instance snapshots are written directly as JSON, so
    they must be materialised here before persistence; an empty field ID would
    make answers impossible to address.
    """
    updated = deepcopy(definition if isinstance(definition, dict) else {})
    sections = updated.get("sections") if isinstance(updated.get("sections"), list) else []
    section_ids = {
        field_id
        for field_id in (
            section.get("id") for section in sections
            if isinstance(section, dict)
        )
        if field_id
    }
    field_ids = {
        field_id
        for _, field in _walk_fields(sections)
        for field_id in [field.get("id")]
        if field_id
    }

    for section in sections:
        if not section.get("id"):
            section["id"] = curriculum_views.unique_prefixed_id(
                "REVS", existing_values=lambda: section_ids
            )
            section_ids.add(section["id"])

        def materialise_fields(fields):
            for field in fields or []:
                if not field.get("id"):
                    field["id"] = curriculum_views.unique_prefixed_id(
                        "REVF", existing_values=lambda: field_ids
                    )
                    field_ids.add(field["id"])
                materialise_fields(field.get("yesFields"))
                materialise_fields(field.get("noFields"))

        materialise_fields(section.get("fields"))
    return updated


class Command(BaseCommand):
    help = "Report or explicitly backfill the canonical Meeting Summary field for MCM templates and editable instances."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Persist the planned backfill. Default is read-only.")
        parser.add_argument("--template-id", help="Limit the operation to one Review template.")
        parser.add_argument("--instance-id", help="Limit the operation to one Review Instance.")

    def handle(self, *args, **options):
        reviews.ensure_review_tables()
        review_instances.ensure_review_instance_tables()
        template_id = curriculum_views.clean_str(options.get("template_id"))
        instance_id = curriculum_views.clean_str(options.get("instance_id"))
        if template_id and instance_id:
            raise CommandError("Use --template-id or --instance-id, not both.")

        type_index = review_types.review_type_index()
        templates = reviews.get_review_template_rows(
            "id = %s" if template_id else "1 = 1",
            [template_id] if template_id else [],
        )
        mcm_templates = [
            row for row in templates
            if (type_index.get(row.get("review_type_id")) or {}).get("code")
            == review_types.REVIEW_TYPE_CODE_MCM
        ]

        if instance_id:
            instance = review_instances.get_review_instance(instance_id)
            if not instance:
                raise CommandError("Review Instance not found.")
            instance_rows = [instance]
            mcm_templates = [
                row for row in mcm_templates
                if row.get("id") == instance.get("review_template_id")
            ]
            if not mcm_templates:
                raise CommandError("The selected Review Instance is not attached to an MCM template.")
        else:
            where = "1 = 1"
            params = []
            if mcm_templates:
                placeholders = ", ".join(["%s"] * len(mcm_templates))
                where = f"review_template_id in ({placeholders})"
                params = [row.get("id") for row in mcm_templates]
            else:
                where = "1 = 0"
            instance_rows = curriculum_views.fetch_all(
                f"select * from {curriculum_views.table_name(review_instances.REVIEW_INSTANCES_TABLE)} where {where} order by id",
                params,
            )

        report = {
            "mode": "apply" if options["apply"] else "dry-run",
            "templates": [],
            "instances": [],
        }

        for row in mcm_templates:
            definition = reviews.review_template_detail_payload(row, type_index=type_index)
            plan = plan_definition(definition)
            report["templates"].append({
                "reviewTemplateId": row.get("id"),
                **plan,
                "name": row.get("name") or "",
            })
            if options["apply"] and plan["action"] in {"mark_existing_field", "add_new_field"}:
                updated, _ = apply_definition_backfill(definition)
                _, errors = reviews.update_review(
                    row.get("id"), updated, actor="mcm-meeting-summary-backfill",
                )
                if errors:
                    raise CommandError(f"Template {row.get('id')} was not updated: {errors}")

        for row in instance_rows:
            snapshot = curriculum_views.as_json_value(row.get("definition_snapshot"), {})
            plan = plan_definition(snapshot)
            item = {
                "reviewInstanceId": row.get("id"),
                "reviewTemplateId": row.get("review_template_id"),
                "status": row.get("status") or "",
                **plan,
            }
            if row.get("status") in PROTECTED_STATUSES:
                item["action"] = "protected_historical_instance"
            report["instances"].append(item)

            if not options["apply"] or row.get("status") in PROTECTED_STATUSES:
                continue
            if plan["action"] not in {"mark_existing_field", "add_new_field"}:
                continue
            with transaction.atomic():
                locked = review_instances.get_review_instance(row.get("id"), for_update=True)
                if not locked or locked.get("status") in PROTECTED_STATUSES:
                    continue
                current = curriculum_views.as_json_value(locked.get("definition_snapshot"), {})
                updated, current_plan = apply_definition_backfill(current)
                if current_plan["action"] not in {"mark_existing_field", "add_new_field"}:
                    continue
                updated = materialise_snapshot_ids(updated)
                rows_updated = curriculum_views.update_rows(
                    review_instances.REVIEW_INSTANCES_TABLE,
                    "id = %s and status not in (%s, %s)",
                    [row.get("id"), *PROTECTED_STATUS_PARAMS],
                    {
                        "definition_snapshot": curriculum_views.json_db_value(updated),
                        "updated_by": "mcm-meeting-summary-backfill",
                        "updated_at": datetime.utcnow(),
                    },
                )
                if not rows_updated:
                    raise CommandError(f"Instance {row.get('id')} entered the signature stage; no mapping was applied.")

        self.stdout.write(json.dumps(report, indent=2, sort_keys=True, default=str))
        if options["apply"]:
            self.stdout.write(self.style.SUCCESS("MCM Meeting Summary backfill applied to eligible definitions."))
        else:
            self.stdout.write(self.style.WARNING("DRY RUN: no data was changed. Re-run with --apply only after owner approval."))
