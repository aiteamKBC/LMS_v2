"""Populate learner monthly targets from the matched Aptem plan snapshot.

The command is dry-run by default.  Applying requires ``--all`` or explicit
``--aptem-id`` values so a broad database write cannot happen accidentally.
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, transaction

from learner_api.monthly_target_sync import build_target_rows


UPSERT_SQL = '''
    INSERT INTO "Learner".learner_monthly_targets
        (learner_id,enrolment_id,programme_id,programme_profile_id,report_month,
         target_hours,source_system,source_ref,basis,updated_by,created_at,updated_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now())
    ON CONFLICT ON CONSTRAINT learner_monthly_targets_scope_uniq DO UPDATE
       SET target_hours=EXCLUDED.target_hours,
           source_system=EXCLUDED.source_system,
           source_ref=EXCLUDED.source_ref,
           basis=EXCLUDED.basis,
           updated_by=EXCLUDED.updated_by,
           updated_at=now()
'''


class Command(BaseCommand):
    help = "Sync monthly Training Plan targets from Audit.learner_match."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write the planned target rows.")
        parser.add_argument(
            "--all", action="store_true", dest="all_rows",
            help="Allow --apply to cover every matched learner.",
        )
        parser.add_argument(
            "--aptem-id", action="append", dest="aptem_ids", default=[],
            help="Limit --apply to one Aptem id; may be repeated.",
        )

    @staticmethod
    def _scope(options):
        ids = {str(value).strip() for value in options.get("aptem_ids") or [] if str(value).strip()}
        if options.get("apply") and not (options.get("all_rows") or ids):
            raise CommandError("--apply requires --all or at least one --aptem-id.")
        return ids

    @staticmethod
    def _read_source_rows():
        with connections["enrolment"].cursor() as cur:
            cur.execute('''
                SELECT id AS learner_id,enrolment_id,aptem_id,programme_id
                FROM "Learner".learners
                WHERE aptem_id IS NOT NULL
            ''')
            learners = [dict(zip((column[0] for column in cur.description), row)) for row in cur.fetchall()]
            cur.execute('''
                SELECT lm.aptem_id,
                       jsonb_build_object('months', jsonb_agg(
                           jsonb_build_object(
                               'date', month_entry->>'date',
                               'month', month_entry->>'month',
                               'hours', month_entry->'hours'
                           )
                           ORDER BY coalesce(month_entry->>'date', month_entry->>'month')
                       )) AS programme_structure
                FROM "Audit".learner_match lm
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(lm.programme_structure::jsonb->'months') = 'array'
                         THEN lm.programme_structure::jsonb->'months'
                         ELSE '[]'::jsonb END
                ) AS month_entry
                WHERE lm.programme_structure IS NOT NULL
                GROUP BY lm.aptem_id
            ''')
            matches = [dict(zip((column[0] for column in cur.description), row)) for row in cur.fetchall()]
            cur.execute('''
                SELECT learner_id AS aptem_id,planned_hours_monthly
                FROM fetching_evidence.learner_hours_monthly
                WHERE planned_hours_monthly IS NOT NULL
            ''')
            fallbacks = [dict(zip((column[0] for column in cur.description), row)) for row in cur.fetchall()]
        return learners, matches, fallbacks

    def handle(self, *args, **options):
        scoped_ids = self._scope(options)
        try:
            learners, matches, fallbacks = self._read_source_rows()
            rows, stats = build_target_rows(learners, matches, fallbacks, scoped_ids)
        except DatabaseError as exc:
            raise CommandError(f"Could not read monthly target sources: {exc}") from exc

        report = {
            "mode": "apply" if options.get("apply") else "dry_run",
            "scope": sorted(scoped_ids) if scoped_ids else "all",
            "learners": len(learners),
            "learner_match_rows": len(matches),
            "fallback_rows": len(fallbacks),
            **stats,
        }
        self.stdout.write(json.dumps(report, sort_keys=True, default=str))
        if not options.get("apply"):
            self.stdout.write(self.style.WARNING("Dry run: nothing was written."))
            return

        try:
            with transaction.atomic(using="enrolment"):
                with connections["enrolment"].cursor() as cur:
                    params = [[
                            row["learner_id"], row["enrolment_id"], row["programme_id"],
                            row["programme_profile_id"], row["report_month"], row["target_hours"],
                            row["source_system"], row["source_ref"], row["basis"], row["updated_by"],
                        ] for row in rows]
                    cur.executemany(UPSERT_SQL, params)
        except DatabaseError as exc:
            raise CommandError(f"Monthly target sync failed; transaction rolled back: {exc}") from exc

        self.stdout.write(self.style.SUCCESS(f"Applied {len(rows)} monthly target row(s)."))
