"""Pre-fill EVERY learner's journal months from the sources, exactly as if an
employee opened each month in the copy-stack journal (attendance sessions, the
completed LMS activities and the completed Aptem assignments, plus the
Azure-mirrored evidence documents on the assignment rows).

It reuses ``rows_auto_import`` per learner-month through a RequestFactory, so
every guarantee holds: refs an employee ever filed (even later deleted) are
never re-inserted, signed-off months stay untouched, everything is idempotent —
running this twice changes nothing.

    python manage.py backfill_manual_rows            # all learners
    python manage.py backfill_manual_rows --aptem-id 17930
    python manage.py backfill_manual_rows --workers 6
"""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, connections
from django.test import RequestFactory

from audit_api.last_audit_ledger_views import (
    ACTIVITIES,
    ACTIVITY_RESULTS,
    LEARNER_ATTENDANCE,
)
from audit_api.learner_exclusions import is_excluded_learner
from audit_api.manual_ledger_views import (
    CONNECTION_ALIAS,
    LEARNERS,
    LEDGER_END_MONTH,
    MANUAL_ROWS,
    _dict_rows,
    _ensure_manual_tables,
    _load_learner,
    _month_range,
    _planned_monthly,
    rows_auto_import,
)
from audit_api.views import _fetch_assignment_items


def _alias():
    return CONNECTION_ALIAS if CONNECTION_ALIAS in connections.databases else "default"


def _retrying(task, attempts=4):
    """Survive the Neon connection flaps this machine is prone to: drop the
    poisoned per-thread connections and retry with a growing pause."""
    for attempt in range(1, attempts + 1):
        try:
            return task()
        except (DatabaseError, OSError, RuntimeError):
            close_old_connections()
            if attempt == attempts:
                raise
            time.sleep(3 * attempt)


def _source_window_start(cursor, learner, aptem_id):
    """Earliest month any source could file into — the fallback for learners
    whose monthly plan is empty (123 in the cohort) and who have no rows yet;
    without it the sweep would skip them even though sources hold data."""
    starts = []
    cursor.execute(
        f"SELECT to_char(min(attendance_date), 'YYYY-MM') FROM {LEARNER_ATTENDANCE} WHERE aptem_id = %s",
        [aptem_id],
    )
    starts.append(cursor.fetchone()[0])
    if learner.get("learner_id") is not None:
        cursor.execute(
            f"""
            SELECT to_char(min(a.activity_date), 'YYYY-MM')
            FROM {ACTIVITY_RESULTS} r JOIN {ACTIVITIES} a ON a.activity_id = r.activity_id
            WHERE r.learner_id = %s
              AND (r.status = 'completed' OR r.video_completed IS TRUE OR r.quiz_passed IS TRUE)
            """,
            [learner["learner_id"]],
        )
        starts.append(cursor.fetchone()[0])
    starts.extend(
        str(item.get("relevant_date") or "")[:7]
        for item in _fetch_assignment_items(aptem_id, include_evidence=False)
        if str(item.get("status") or "").strip().lower() == "completed"
        and len(str(item.get("relevant_date") or "")) >= 7
    )
    starts = [start for start in starts if start]
    return min(starts) if starts else None


def _months_for(cursor, learner, aptem_id, end_month):
    """The journal's own month window (first planned/arranged month → cap),
    limited to months that can hold data yet (no future months)."""
    cursor.execute(
        f"SELECT DISTINCT month FROM {MANUAL_ROWS} WHERE aptem_id = %s AND deleted_at IS NULL",
        [aptem_id],
    )
    arranged = {row["month"] for row in _dict_rows(cursor)}
    known = set(_planned_monthly(learner)) | arranged
    window = [month for month in known if month <= end_month]
    if not window:
        start = _source_window_start(cursor, learner, aptem_id)
        if not start or start > end_month:
            return []
        return _month_range(start, end_month)
    return _month_range(min(window), end_month)


class Command(BaseCommand):
    help = "Auto-import every learner-month so all journals open pre-filled."

    def add_arguments(self, parser):
        parser.add_argument("--workers", type=int, default=4)
        parser.add_argument("--aptem-id", type=int, default=None,
                            help="Backfill a single learner instead of the whole cohort.")
        parser.add_argument("--min-aptem-id", type=int, default=None,
                            help="Only learners with aptem_id >= this — lets a second "
                                 "process sweep the upper range in parallel (idempotent, "
                                 "so overlap with another sweep is harmless).")
        parser.add_argument("--max-aptem-id", type=int, default=None,
                            help="Only learners with aptem_id <= this — pairs with "
                                 "--min-aptem-id to give each parallel process a "
                                 "disjoint slice of the cohort.")

    def handle(self, *args, **options):
        factory = RequestFactory()
        end_month = min(LEDGER_END_MONTH, date.today().strftime("%Y-%m"))
        lock = threading.Lock()
        totals = {"learners": 0, "months": 0, "created": 0, "locked": 0, "errors": 0}

        def load_cohort():
            with connections[_alias()].cursor() as cursor:
                _ensure_manual_tables(cursor)
                if options["aptem_id"]:
                    cursor.execute(
                        f"SELECT aptem_id, learner_name FROM {LEARNERS} WHERE aptem_id = %s",
                        [options["aptem_id"]],
                    )
                else:
                    where = "WHERE aptem_id IS NOT NULL"
                    params = []
                    if options["min_aptem_id"]:
                        where += " AND aptem_id >= %s"
                        params.append(options["min_aptem_id"])
                    if options["max_aptem_id"]:
                        where += " AND aptem_id <= %s"
                        params.append(options["max_aptem_id"])
                    cursor.execute(
                        f"SELECT aptem_id, learner_name FROM {LEARNERS} "
                        f"{where} ORDER BY aptem_id",
                        params,
                    )
                return [
                    row for row in _dict_rows(cursor)
                    if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
                ]

        cohort = _retrying(load_cohort)
        self.stdout.write(f"cohort: {len(cohort)} learners, window cap {end_month}")

        def load_months(aptem_id):
            with connections[_alias()].cursor() as cursor:
                learner = _load_learner(cursor, aptem_id)
                if not learner:
                    return None
                return _months_for(cursor, learner, aptem_id, end_month)

        def import_month(aptem_id, month):
            request = factory.post(
                "/audit_api/last-audit/manual/rows/auto-import",
                data=json.dumps({"aptem_id": aptem_id, "month": month}),
                content_type="application/json",
            )
            response = rows_auto_import(request)
            payload = json.loads(response.content)
            if response.status_code != 200:
                raise RuntimeError(f"{month}: {payload.get('error')}")
            return payload

        def backfill_learner(aptem_id, name):
            close_old_connections()
            created = locked = 0
            try:
                months = _retrying(lambda: load_months(aptem_id))
                if months is None:
                    return aptem_id, name, [], 0, 0, "no learner row"
                for month in months:
                    payload = _retrying(lambda: import_month(aptem_id, month))
                    created += int(payload.get("created") or 0)
                    locked += 1 if payload.get("locked") else 0
                return aptem_id, name, months, created, locked, None
            except Exception as error:  # keep the sweep going, report at the end
                return aptem_id, name, [], created, locked, str(error)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=options["workers"]) as pool:
            futures = [
                pool.submit(backfill_learner, int(row["aptem_id"]), row.get("learner_name"))
                for row in cohort
            ]
            for future in as_completed(futures):
                aptem_id, name, months, created, locked, error = future.result()
                with lock:
                    totals["learners"] += 1
                    totals["months"] += len(months)
                    totals["created"] += created
                    totals["locked"] += locked
                    if error:
                        totals["errors"] += 1
                    done = totals["learners"]
                status = f"ERROR {error}" if error else f"months={len(months)} created={created}"
                self.stdout.write(f"[{done}/{len(cohort)}] {aptem_id} {str(name or '')[:34]:34} {status}")

        self.stdout.write(self.style.SUCCESS(
            f"done: {totals['learners']} learners, {totals['months']} months, "
            f"{totals['created']} rows created, {totals['locked']} signed-off months skipped, "
            f"{totals['errors']} learners errored"
        ))
        if totals["errors"]:
            self.stdout.write("errored learners keep their partial fill; re-running is safe (idempotent).")
