"""Reconcile the existing Aptem mirror into the LMS identity/status records."""

import json
import time
from collections import Counter, defaultdict
from contextlib import nullcontext

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, transaction
from django.utils import timezone

from coach_api.read_model import enqueue_coach_dashboard_refresh
from curriculum_api.versioning import audit_context
from learner_api.aptem_learner_sync import aptem_id, plan_update
from learner_api.models import EnrolmentUser, LearnerProfile
from login.models import LoginAccount


ALIAS = "enrolment"


class Command(BaseCommand):
    help = (
        "Dry-run or sync Aptem names and explicit withdrawal/break/completion/EPA states into "
        "existing learner records. Never imports activities or activates accounts."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        scope = parser.add_mutually_exclusive_group()
        scope.add_argument("--all", action="store_true", dest="all_rows")
        scope.add_argument("--aptem-id", action="append", default=[], dest="aptem_ids")
        parser.add_argument("--watch", action="store_true", help="Run as one supervised polling worker.")
        parser.add_argument("--interval-seconds", type=int, default=900,
                            help="Polling interval with --watch (minimum 60; default 900).")

    def _sources(self, scoped_ids, *, lock=False):
        # API-for-aptem intentionally separates Active/OnBreak from the other
        # statuses. Reading only Aptem_users loses explicit withdrawals.
        rows = []
        with connections[ALIAS].cursor() as cursor:
            for table in ('"LMS"."Aptem_users"', '"LMS"."non_active_users"'):
                sql = f'SELECT "ID"::text, "FullName", "Program-Status" FROM {table}'
                params = []
                if scoped_ids:
                    sql += ' WHERE "ID" = ANY(%s)'
                    params.append([int(ident) for ident in sorted(scoped_ids)])
                sql += ' ORDER BY "ID"'
                if lock:
                    sql += " FOR SHARE"
                cursor.execute(sql, params)
                rows.extend(dict(zip(("aptem_id", "full_name", "programme_status"), row))
                            for row in cursor.fetchall())
        return rows

    @staticmethod
    def _group(rows, key):
        grouped = defaultdict(list)
        for row in rows:
            grouped[key(row)].append(row)
        return grouped

    def _records(self, *, lock=False):
        # Read all linked enrolments before scoping so differently formatted
        # duplicate Aptem ids cannot be hidden by a textual ORM filter.
        query = EnrolmentUser.all_learners.using(ALIAS).only(
            "id", "aptem_id", "username", "programme_status",
        )
        if lock:
            query = query.select_for_update()
        return list(query.order_by("pk"))

    def _related(self, records, *, lock=False):
        ids = [row.pk for row in records]
        profiles = LearnerProfile.objects.using(ALIAS).filter(enrolment_id__in=ids).only(
            "id", "enrolment_id", "aptem_id", "full_name", "programme_status",
            "lifecycle_status", "coach_email",
        )
        accounts = LoginAccount.objects.using(ALIAS).filter(
            subject_type="learner", subject_id__in=ids,
        ).only("id", "subject_type", "subject_id", "display_name")
        if lock:
            profiles = profiles.select_for_update()
            accounts = accounts.select_for_update()
        return list(profiles.order_by("pk")), list(accounts.order_by("pk"))

    @staticmethod
    def _write(enrolment, profile, account, plan):
        now = timezone.now()
        if plan["enrolment"]:
            EnrolmentUser.all_learners.using(ALIAS).filter(pk=enrolment.pk).update(**plan["enrolment"])
        if plan["profile"]:
            LearnerProfile.objects.using(ALIAS).filter(pk=profile.pk).update(
                **plan["profile"], updated_at=now,
            )
        if plan["account"]:
            LoginAccount.objects.using(ALIAS).filter(pk=account.pk).update(
                **plan["account"], updated_at=now,
            )

    def _reconcile(self, scoped_ids, apply):
        stats = Counter()
        review = Counter()
        owners = set()
        records = self._records(lock=apply)
        stats["local_records"] = len(records)
        if not scoped_ids:
            stats["without_aptem_id"] = sum(not str(row.aptem_id or "").strip() for row in records)
        records = [row for row in records if str(row.aptem_id or "").strip()]
        by_id = self._group(records, lambda row: aptem_id(row.aptem_id))
        records = [row for row in records if not scoped_ids or aptem_id(row.aptem_id) in scoped_ids]
        sources = self._group(self._sources(scoped_ids, lock=apply), lambda row: aptem_id(row["aptem_id"]))
        if not sources:
            raise CommandError("No scoped Aptem source rows are available; no learner was changed.")
        profiles, accounts = self._related(records, lock=apply)
        by_enrolment = self._group(profiles, lambda row: row.enrolment_id)
        by_subject = self._group(accounts, lambda row: row.subject_id)
        for ident in scoped_ids - set(by_id):
            review["unmatched_requested_id"] += 1
        for enrolment in records:
            stats["examined"] += 1
            ident = aptem_id(enrolment.aptem_id)
            if ident is None:
                review["invalid_aptem_id"] += 1
                continue
            if len(by_id[ident]) != 1 or len(sources.get(ident, [])) > 1:
                review["ambiguous_aptem_id"] += 1
                continue
            if not sources.get(ident):
                review["missing_source"] += 1
                continue
            matches = by_enrolment.get(enrolment.pk, [])
            logins = by_subject.get(enrolment.pk, [])
            if len(matches) > 1 or len(logins) > 1:
                review["ambiguous_local_identity"] += 1
                continue
            profile = matches[0] if matches else None
            account = logins[0] if logins else None
            plan = plan_update(sources[ident][0], enrolment, profile, account)
            review.update(plan["review"])
            stats.update(f"preserved.{reason}" for reason in plan["preserved"])
            changed = any(plan[field] for field in ("enrolment", "profile", "account"))
            if not changed:
                stats["unchanged"] += 1
                continue
            stats["changed"] += 1
            for target in ("enrolment", "profile", "account"):
                for field in plan[target]:
                    stats[f"{target}.{field}"] += 1
            if apply:
                self._write(enrolment, profile, account, plan)
                if profile is not None and profile.coach_email:
                    owners.add(profile.coach_email)
        if apply and owners:
            from coach_api.dashboard_cache import invalidate_coach_dashboard_cache
            for owner in owners:
                enqueue_coach_dashboard_refresh(owner, reason="aptem-learner-details", using=ALIAS)
                transaction.on_commit(
                    lambda email=owner: invalidate_coach_dashboard_cache(email), using=ALIAS,
                )
        return {"mode": "apply" if apply else "dry_run", "counts": dict(stats), "review": dict(review)}

    def handle(self, *args, **options):
        raw_ids = options.get("aptem_ids") or []
        scoped_ids = {aptem_id(value) for value in raw_ids}
        if None in scoped_ids:
            raise CommandError("Every --aptem-id must be a positive bigint Aptem id.")
        apply = options.get("apply", False)
        if apply and not (scoped_ids or options.get("all_rows")):
            raise CommandError("--apply requires --all or at least one --aptem-id.")
        watch = options.get("watch", False)
        interval = options.get("interval_seconds", 900)
        if watch and not apply:
            raise CommandError("--watch requires --apply and an explicit learner scope.")
        if watch and interval < 60:
            raise CommandError("--interval-seconds must be at least 60.")
        while True:
            try:
                self._once(scoped_ids, apply)
            except CommandError as exc:
                if not watch:
                    raise
                self.stderr.write(str(exc))
            if not watch:
                return
            # No threads or scheduler start on import. A single supervised
            # worker checks the two existing mirrors, without calling Aptem or
            # importing activities. Each poll owns one atomic write cycle.
            connections.close_all()
            time.sleep(interval)

    def _once(self, scoped_ids, apply):
        try:
            with transaction.atomic(using=ALIAS) if apply else nullcontext():
                with audit_context(actor_type="job", source="import", action="update",
                                   reason="aptem_learner_details_sync"):
                    report = self._reconcile(scoped_ids, apply)
        except DatabaseError:
            # Driver messages can contain hosts, credentials or learner data.
            raise CommandError("Aptem learner detail sync failed; changes rolled back.") from None
        self.stdout.write(json.dumps(report, sort_keys=True))
        if report["review"]:
            if apply:
                raise CommandError(
                    "Partial sync: valid changes committed; unresolved records require review. "
                    "Missing data was never treated as withdrawal."
                )
            self.stderr.write("Dry run: review reasons must be resolved; nothing was written.")
