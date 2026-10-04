"""Restore Aptem Auto Extract plan/date facts into the learner SSOT.

The command is deliberately a dry run unless ``--apply`` is supplied.  An
apply also requires an explicit ``--all`` or one or more ``--aptem-id`` values;
an unscoped request can therefore inventory the source but cannot perform a
bulk write by accident.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import json

import psycopg
from psycopg.rows import dict_row
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, transaction

from coach_api.views import get_aptem_connection_string
from curriculum_api.versioning import audit_context
from learner_api.aptem_schedule import normalise_source_row, plan_mirror_update
from learner_api.models import EnrolmentUser, LearnerProfile


class Command(BaseCommand):
    help = "Dry-run or safely sync Aptem Auto Extract planned hours and dates into SSOT."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Write only the explicitly scoped safe rows.",
        )
        parser.add_argument(
            "--all", action="store_true", dest="all_rows",
            help="Allow --apply to cover every matched Aptem id (never implicit).",
        )
        parser.add_argument(
            "--aptem-id", action="append", dest="aptem_ids", default=[],
            help="Scope --apply to one Aptem id; may be repeated.",
        )
        parser.add_argument(
            "--replace-conflicts", action="store_true",
            help="Replace differing SSOT values. Requires an explicit scope.",
        )

    def _source_rows(self):
        connection_string = get_aptem_connection_string()
        if not connection_string:
            raise CommandError("APTEMAUTOEXTRACTINGDATABASE is not configured.")
        with psycopg.connect(connection_string, row_factory=dict_row) as source:
            source.read_only = True
            with source.cursor() as cursor:
                cursor.execute(
                    '''select "ID"::text as aptem_id,
                              "Planned" as planned_hours,
                              "Start-Date" as start_date,
                              "End-Date" as end_date
                         from public.aptem_auto_extracting
                        where "ID" is not null
                        order by "ID"'''
                )
                return [normalise_source_row(row) for row in cursor.fetchall()]

    def _ssot_rows(self):
        try:
            enrolments = list(
                EnrolmentUser.all_learners.using("enrolment")
                .only("id", "aptem_id", "planned_hours", "start_date", "end_date")
            )
            profiles = {
                int(profile.enrolment_id): profile
                for profile in LearnerProfile.objects.using("enrolment")
                .filter(enrolment_id__isnull=False)
                .only("enrolment_id", "planned_hours", "start_date", "end_date", "coach_email")
            }
        except DatabaseError as exc:
            raise CommandError(f"Could not read the enrolment SSOT: {exc}") from exc
        by_aptem: dict[str, list] = defaultdict(list)
        for row in enrolments:
            if row.aptem_id not in (None, ""):
                by_aptem[str(row.aptem_id).strip()].append((row, profiles.get(int(row.id))))
        return by_aptem

    @staticmethod
    def _scope(options):
        ids = {str(value).strip() for value in options.get("aptem_ids") or [] if str(value).strip()}
        if options.get("apply") and not (options.get("all_rows") or ids):
            raise CommandError("--apply requires --all or at least one --aptem-id.")
        if options.get("replace_conflicts") and not (options.get("all_rows") or ids):
            raise CommandError("--replace-conflicts requires an explicit apply scope.")
        return ids

    def handle(self, *args, **options):
        scoped_ids = self._scope(options)
        source_rows = self._source_rows()
        source_by_id: dict[str, list[dict]] = defaultdict(list)
        for row in source_rows:
            if row["aptem_id"]:
                source_by_id[row["aptem_id"]].append(row)
        ssot_by_aptem = self._ssot_rows()

        counts = Counter()
        plans = []
        for aptem_id, rows in source_by_id.items():
            if scoped_ids and aptem_id not in scoped_ids:
                continue
            if len(rows) != 1:
                counts["ambiguous_source"] += 1
                continue
            matches = ssot_by_aptem.get(aptem_id, [])
            if len(matches) != 1:
                counts["ambiguous_ssot"] += 1
                continue
            source = rows[0]
            enrolment, profile = matches[0]
            plan = plan_mirror_update(
                source,
                enrolment,
                profile,
                replace_conflicts=bool(options.get("replace_conflicts")),
            )
            counts[plan["status"].lower()] += 1
            counts["planned_fields"] += len(plan["enrolment_fields"]) + len(plan["profile_fields"])
            plans.append((aptem_id, enrolment, profile, plan))

        report = {
            "mode": "apply" if options.get("apply") else "dry_run",
            "source_rows": len(source_rows),
            "scoped_source_rows": sum(
                1 for row in source_rows if not scoped_ids or row["aptem_id"] in scoped_ids
            ),
            "matched_rows": len(plans),
            "counts": dict(sorted(counts.items())),
            "fields": ["planned_hours", "start_date", "end_date"],
        }
        self.stdout.write(json.dumps(report, sort_keys=True))

        if not options.get("apply"):
            self.stdout.write(self.style.WARNING("Dry run: nothing was written."))
            return

        allowed = set(scoped_ids) if scoped_ids else None
        applied = 0
        for aptem_id, enrolment, profile, plan in plans:
            if allowed is not None and aptem_id not in allowed:
                continue
            if plan["status"] not in {"UPDATE", "CONFLICT"}:
                continue
            if not plan["enrolment_fields"] and not plan["profile_fields"]:
                continue
            try:
                with transaction.atomic(using="enrolment"):
                    with audit_context(
                        actor_type="job",
                        source="import",
                        action="update",
                        reason="aptem_auto_extract_schedule_sync",
                    ):
                        if plan["enrolment_fields"]:
                            EnrolmentUser.all_learners.using("enrolment").filter(
                                pk=enrolment.pk,
                            ).update(**plan["enrolment_fields"])
                        if profile is not None and plan["profile_fields"]:
                            LearnerProfile.objects.using("enrolment").filter(
                                pk=profile.pk,
                            ).update(**plan["profile_fields"])
                applied += 1
                coach_email = str(getattr(profile, "coach_email", "") or "").strip().lower()
                if coach_email:
                    from coach_api.dashboard_cache import invalidate_coach_dashboard_cache

                    invalidate_coach_dashboard_cache(coach_email)
            except DatabaseError as exc:
                raise CommandError(
                    f"Aptem schedule write failed for scoped id {aptem_id}; transaction rolled back."
                ) from exc

        self.stdout.write(self.style.SUCCESS(f"Applied {applied} idempotent SSOT update(s)."))
