"""Bulk variant of ``backfill_manual_rows`` — identical rules, ~20x fewer
database round trips.

The classic path re-queries every source for EVERY learner-month, but all
three sources (register attendance, LMS group catalogues, Aptem assignments)
are month-agnostic queries filtered in Python — so this command fetches each
of them ONCE per learner and runs the exact same per-month shaping that
``rows_auto_import`` runs, then files all months in one multi-VALUES insert.

Every guarantee is inherited unchanged: refs ever filed (even later deleted)
are never re-inserted, signed-off months stay untouched, the partial unique
index guards races, and the whole thing is idempotent. The classic per-month
command remains untouched as fallback and verifier — running it after this
one must create zero rows.

    python manage.py bulk_backfill_manual_rows --workers 8
    python manage.py bulk_backfill_manual_rows --aptem-id 17930
    python manage.py bulk_backfill_manual_rows --min-aptem-id 0 --max-aptem-id 6115
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, connections, transaction

import audit_api.manual_ledger_views as mlv
from audit_api.learner_exclusions import is_excluded_learner
from audit_api.views import _fetch_assignment_items


def _alias():
    return mlv.CONNECTION_ALIAS if mlv.CONNECTION_ALIAS in connections.databases else "default"


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


def _signed_off_pairs():
    """(learner_id-as-text, month) for every month BOTH roles signed — the
    bulk equivalent of ``_month_is_signed_off``. Errors read as "nothing
    signed" exactly like the original (it must never block the fill)."""
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                """
                SELECT learner_id::text, report_month
                FROM "Audit"."monthly_audit_signoffs"
                WHERE coalesce(signature_data, '') <> ''
                GROUP BY learner_id::text, report_month
                HAVING count(DISTINCT signer_role) >= 2
                """
            )
            return {(str(row[0]), str(row[1])) for row in cursor.fetchall()}
    except Exception:
        return set()


def _prefetch_ledger_state(cursor, aptem_id):
    """Every source_ref the learner ever filed, bucketed by month — one query
    instead of two per month. ``ever`` includes deleted rows (deletions stay
    respected); ``live``/``asg_live`` mirror the per-month queries."""
    cursor.execute(
        f"""
        SELECT month, source_ref, category, (deleted_at IS NULL) AS live
        FROM {mlv.MANUAL_ROWS}
        WHERE aptem_id = %s AND source_ref IS NOT NULL
        """,
        [aptem_id],
    )
    ever, live, asg_live_months = {}, {}, set()
    for month, source_ref, category, is_live in cursor.fetchall():
        ever.setdefault(month, set()).add(source_ref)
        if is_live:
            live.setdefault(month, set()).add(source_ref)
            if category == "assignment" and str(source_ref).startswith("asg:"):
                asg_live_months.add(month)
    return ever, live, asg_live_months


def _prefetch_attendance(cursor, aptem_id):
    """The register rows exactly as ``_collect_import_candidates`` sees them:
    live kbc_attendance first (same DESC order — it decides dedup winners),
    mirror fallback on failure."""
    rows = None
    source = "kbc_attendance"
    try:
        rows = mlv._source_attendance_rows(aptem_id)
    except Exception:
        rows = None
    if rows is None:
        source = "Last_audit-mirror"
        cursor.execute(
            f"""
            SELECT source_key, attendance_date, attendance_value,
                   attendance_status, module, lecture_name
            FROM {mlv.LEARNER_ATTENDANCE}
            WHERE aptem_id = %s
            ORDER BY attendance_date, source_key
            """,
            [aptem_id],
        )
        rows = mlv._dict_rows(cursor)
    return rows, source


def _prefetch_activities(cursor, learner):
    """The learner's full LMS catalogue with completion state and the stored
    reading+quiz bundles — verbatim ``_collect_import_candidates`` shaping,
    which is month-agnostic and therefore safe to compute once."""
    content_rows = []
    if learner.get("learner_id") is not None:
        cursor.execute(
            f"""
            SELECT DISTINCT ON (gl.group_id, a.activity_id)
                   gl.group_id, g.group_name, a.activity_id, a.title, a.activity_date,
                   lower(a.activity_type) AS activity_type,
                   a.quiz_id, a.quiz_questions, a.reading_type,
                   a.reading_iframe_url, a.reading_text_body,
                   a.configured_duration_min,
                   r.status, r.video_completed, r.reading_viewed,
                   r.quiz_passed
            FROM {mlv.GROUP_LEARNERS} gl
            JOIN {mlv.GROUPS} g ON g.group_id = gl.group_id
            JOIN {mlv.GROUP_ACTIVITIES} ga ON ga.group_id = gl.group_id
            JOIN {mlv.ACTIVITIES} a ON a.activity_id = ga.activity_id
            LEFT JOIN {mlv.ACTIVITY_RESULTS} r
              ON r.group_id = gl.group_id
             AND r.activity_id = a.activity_id
             AND r.learner_id = gl.learner_id
            WHERE gl.learner_id = %s
              AND lower(a.activity_type) IN ('video', 'audio', 'reading+quiz')
            ORDER BY gl.group_id, a.activity_id, r.learner_id NULLS LAST
            """,
            [learner["learner_id"]],
        )
        content_rows = mlv._dict_rows(cursor)

    group_ids = sorted({int(row["group_id"]) for row in content_rows if row.get("group_id") is not None})
    pairs = []
    if group_ids:
        cursor.execute(
            f"SELECT id, group_id, reading_activity_id, quiz_activity_id FROM {mlv.READING_QUIZ_PAIRS} WHERE group_id = ANY(%s)",
            [group_ids],
        )
        pairs = mlv._dict_rows(cursor)

    activities = []
    for row in content_rows:
        activity_date = row.get("activity_date")
        activities.append({
            "group_id": int(row["group_id"]),
            "group_name": row.get("group_name") or f"Group {row['group_id']}",
            "activity_id": int(row["activity_id"]),
            "source_ref": f"la:{int(row['group_id'])}:{int(row['activity_id'])}",
            "category": row.get("activity_type") or "activity",
            "title": row.get("title") or f"Activity {row['activity_id']}",
            "activity_date": activity_date.isoformat() if activity_date else None,
            "duration_minutes": mlv._num(row.get("configured_duration_min")),
            "completion": {"state": "completed" if mlv._is_completed(row) else "not_completed"},
        })

    by_key = {(item["group_id"], item["activity_id"]): item for item in activities}
    consumed = set()
    bundles = []
    stored_bundles = {}
    for pair in pairs:
        key = (int(pair["group_id"]), int(pair["reading_activity_id"]))
        stored_bundles.setdefault(key, []).append(int(pair["quiz_activity_id"]))
    for (group_id, anchor_id), member_ids in stored_bundles.items():
        activity_ids = [anchor_id, *sorted(set(member_ids))]
        members = [by_key.get((group_id, activity_id)) for activity_id in activity_ids]
        if any(member is None for member in members):
            continue
        members = [member for member in members if member is not None]
        consumed.update((group_id, activity_id) for activity_id in activity_ids)
        states = [member["completion"]["state"] for member in members]
        bundles.append({
            "source_ref": f"rq:{group_id}:" + ":".join(str(activity_id) for activity_id in activity_ids),
            "category": "reading+quiz",
            "title": " + ".join(member["title"] for member in members),
            "activity_date": max(filter(None, [member.get("activity_date") for member in members]), default=None),
            "duration_minutes": None,
            "completion": {"state": "completed" if all(state == "completed" for state in states) else "not_completed"},
            "group_id": group_id,
            "group_name": members[0].get("group_name") or f"Group {group_id}",
            "activity_id": anchor_id,
        })
    return [item for item in activities if (item["group_id"], item["activity_id"]) not in consumed] + bundles


def _month_attendance(attendance_rows, month, already_added_set):
    """Verbatim per-month attendance shaping from ``_collect_import_candidates``:
    same month filter, same attended detection, same duplicate-session collapse
    with the same priority rules (row order decides ties, so the prefetched
    rows keep their source order)."""

    def _attendance_priority(item):
        return (2 if item["source_ref"] in already_added_set else 0) + (1 if item["attended"] else 0)

    attendance = []
    session_index = {}
    for row in attendance_rows:
        attendance_date = row.get("attendance_date")
        date_iso = attendance_date.isoformat() if attendance_date else None
        if not date_iso or not date_iso.startswith(month):
            continue
        attended = row.get("attendance_value") == 1 or str(
            row.get("attendance_status") or ""
        ).lower() in {"present", "attended", "attend"}
        title = row.get("lecture_name") or row.get("module") or "Attendance session"
        candidate = {
            "source_ref": f"att:{row['source_key']}",
            "category": "attendance",
            "title": title,
            "activity_date": date_iso,
            "attended": attended,
            "timestamp_label": "attended" if attended else "not attended",
        }
        session_key = (date_iso, " ".join(title.lower().split()))
        existing_at = session_index.get(session_key)
        if existing_at is None:
            session_index[session_key] = len(attendance)
            attendance.append(candidate)
        elif _attendance_priority(candidate) > _attendance_priority(attendance[existing_at]):
            attendance[existing_at] = candidate
    return attendance


def _month_assignment_values(assignment_items, month):
    """Verbatim ``_assignment_import_values`` against prefetched items:
    EVERY assignment in the month whatever its status, with the source status
    in ``completion_note`` and the submission clock time in ``activity_time``."""
    values = []
    for item in assignment_items:
        date_iso = str(item.get("relevant_date") or "")[:10]
        if not date_iso.startswith(month):
            continue
        source_id = str(item.get("source_id") or "").strip()
        if not source_id:
            continue
        status = mlv._readable_status(item.get("status"))
        values.append({
            "month": month,
            "category": "assignment",
            "source_ref": f"asg:{source_id}",
            "group_id": None,
            "activity_id": None,
            "title": mlv._valid_title(item.get("activity_name") or "Assignment"),
            "activity_date": mlv._valid_date(date_iso),
            "activity_time": mlv._submission_time(item),
            "planned_hours": mlv._clamped_hours(item.get("planned_hours")),
            "actual_hours": mlv._clamped_hours(item.get("actual_hours")),
            "timestamp_label": "input",
            "completion_note": status,
            "accepted": True,
        })
    return values


INSERT_CHUNK = 400  # rows per multi-VALUES statement


class Command(BaseCommand):
    help = "Bulk-fill every learner-month (same rules as backfill_manual_rows, one source fetch per learner)."

    def add_arguments(self, parser):
        parser.add_argument("--workers", type=int, default=8)
        parser.add_argument("--aptem-id", type=int, default=None)
        parser.add_argument("--min-aptem-id", type=int, default=None)
        parser.add_argument("--max-aptem-id", type=int, default=None)

    def handle(self, *args, **options):
        end_month = min(mlv.LEDGER_END_MONTH, date.today().strftime("%Y-%m"))
        lock = threading.Lock()
        totals = {"learners": 0, "months": 0, "created": 0, "locked": 0, "errors": 0}

        def load_cohort():
            with connections[_alias()].cursor() as cursor:
                mlv._ensure_manual_tables(cursor)
                if options["aptem_id"]:
                    cursor.execute(
                        f"SELECT aptem_id, learner_name FROM {mlv.LEARNERS} WHERE aptem_id = %s",
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
                        f"SELECT aptem_id, learner_name FROM {mlv.LEARNERS} {where} ORDER BY aptem_id",
                        params,
                    )
                return [
                    row for row in mlv._dict_rows(cursor)
                    if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
                ]

        cohort = _retrying(load_cohort)
        signed_off = _retrying(_signed_off_pairs)
        self.stdout.write(
            f"cohort: {len(cohort)} learners, window cap {end_month}, "
            f"{len(signed_off)} signed-off learner-months excluded"
        )

        def bulk_learner(aptem_id, name):
            close_old_connections()
            created = locked = 0
            months = []
            try:
                def prefetch():
                    with connections[_alias()].cursor() as cursor:
                        learner = mlv._load_learner(cursor, aptem_id)
                        if not learner:
                            return None
                        cursor.execute(
                            f"SELECT DISTINCT month FROM {mlv.MANUAL_ROWS} WHERE aptem_id = %s AND deleted_at IS NULL",
                            [aptem_id],
                        )
                        arranged = {row["month"] for row in mlv._dict_rows(cursor)}
                        known = set(mlv._planned_monthly(learner)) | arranged
                        window = [month for month in known if month <= end_month]
                        month_list = mlv._month_range(min(window), end_month) if window else []
                        ever, live, asg_live_months = _prefetch_ledger_state(cursor, aptem_id)
                        attendance_rows, _source = _prefetch_attendance(cursor, aptem_id)
                        activities = _prefetch_activities(cursor, learner)
                        return learner, month_list, ever, live, asg_live_months, attendance_rows, activities

                loaded = _retrying(prefetch)
                if loaded is None:
                    return aptem_id, name, [], 0, 0, "no learner row"
                learner, months, ever, live, asg_live_months, attendance_rows, activities = loaded
                if not months:
                    return aptem_id, name, [], 0, 0, None

                try:
                    assignment_items = _fetch_assignment_items(aptem_id, include_evidence=False)
                except Exception:
                    assignment_items = []

                batch = []
                refresh = []
                asg_target_months = set(asg_live_months)
                for month in months:
                    if (str(aptem_id), month) in signed_off:
                        locked += 1
                        continue
                    pending = []
                    for item in _month_attendance(attendance_rows, month, live.get(month, set())):
                        pending.append({
                            "month": month,
                            "category": "attendance",
                            "source_ref": item["source_ref"],
                            "group_id": None,
                            "activity_id": None,
                            "title": mlv._valid_title(item["title"]),
                            "activity_date": mlv._valid_date(item["activity_date"]),
                            "planned_hours": mlv.ATTENDANCE_SESSION_HOURS,
                            "actual_hours": mlv.ATTENDANCE_SESSION_HOURS if item["attended"] else 0.0,
                            "timestamp_label": item["timestamp_label"],
                            "completion_note": None,
                            "accepted": True,
                        })
                    for item in activities:
                        date_iso = item.get("activity_date") or ""
                        if not date_iso.startswith(month):
                            continue
                        if item["completion"]["state"] != "completed":
                            continue
                        pending.append({
                            "month": month,
                            "category": item["category"],
                            "source_ref": item["source_ref"],
                            "group_id": item.get("group_id"),
                            "activity_id": item.get("activity_id"),
                            "title": mlv._valid_title(item["title"]),
                            "activity_date": mlv._valid_date(date_iso),
                            "planned_hours": 0.0,
                            "actual_hours": 0.0,
                            "timestamp_label": "input",
                            "completion_note": "completed",
                            "accepted": True,
                        })
                    asg_values = _month_assignment_values(assignment_items, month)
                    pending.extend(asg_values)
                    refresh.extend(asg_values)

                    ever_filed = ever.get(month, set())
                    seen = set()
                    for values in pending:
                        ref = values["source_ref"]
                        if ref in ever_filed or ref in seen:
                            continue
                        seen.add(ref)
                        batch.append(values)
                        if values["category"] == "assignment" and ref.startswith("asg:"):
                            asg_target_months.add(month)

                def write():
                    written = 0
                    with transaction.atomic(using=_alias()):
                        with connections[_alias()].cursor() as cursor:
                            for start in range(0, len(batch), INSERT_CHUNK):
                                chunk = batch[start:start + INSERT_CHUNK]
                                params = []
                                for values in chunk:
                                    params.extend(mlv._insert_params(
                                        aptem_id, learner.get("learner_id"), values, "auto-import"))
                                cursor.execute(
                                    mlv.INSERT_ROW_PREFIX
                                    + ", ".join([mlv.ROW_VALUES_PLACEHOLDER] * len(chunk))
                                    + """
                                    ON CONFLICT (aptem_id, month, source_ref)
                                        WHERE deleted_at IS NULL AND source_ref IS NOT NULL
                                        DO NOTHING
                                    """,
                                    params,
                                )
                                written += cursor.rowcount
                            # Same untouched-row refresh as rows_auto_import:
                            # status/time/hours follow the source until a human
                            # edits the row (updated_at deliberately untouched).
                            for values in refresh:
                                cursor.execute(
                                    f"""
                                    UPDATE {mlv.MANUAL_ROWS}
                                    SET completion_note = %s, activity_time = %s,
                                        planned_hours = %s, actual_hours = %s,
                                        updated_by = 'auto-refresh'
                                    WHERE aptem_id = %s AND month = %s AND source_ref = %s
                                      AND deleted_at IS NULL
                                      AND (updated_by IS NULL OR updated_by = 'auto-refresh')
                                      AND updated_at = created_at
                                      AND (completion_note IS DISTINCT FROM %s
                                           OR activity_time IS DISTINCT FROM %s::time
                                           OR planned_hours IS DISTINCT FROM %s::numeric
                                           OR actual_hours IS DISTINCT FROM %s::numeric)
                                    """,
                                    [
                                        values["completion_note"], values.get("activity_time"),
                                        values["planned_hours"], values["actual_hours"],
                                        aptem_id, values["month"], values["source_ref"],
                                        values["completion_note"], values.get("activity_time"),
                                        values["planned_hours"], values["actual_hours"],
                                    ],
                                )
                            for month in sorted(asg_target_months):
                                mlv._attach_assignment_evidence_docs(cursor, aptem_id, month)
                    return written

                if batch or refresh or asg_target_months:
                    created = _retrying(write)
                return aptem_id, name, months, created, locked, None
            except Exception as error:  # keep the sweep going, report at the end
                return aptem_id, name, months, created, locked, str(error)
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=options["workers"]) as pool:
            futures = [
                pool.submit(bulk_learner, int(row["aptem_id"]), row.get("learner_name"))
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
