"""Reconcile the historical Monthly Logs for the agreed learner cohort.

The command is deliberately dry-run by default.  It reads the immutable
``Last_audit`` mirror and the employee-arranged journal, proposes only missing
values, and on ``--apply`` writes the smallest field-level changes in one
transaction.  Approved hour revisions are treated as immutable per field.

No synthetic/demo values are ever generated.  When a source cannot justify a
value the row is left alone and a review reason is emitted instead.
"""

from __future__ import annotations

import json
import re
import uuid
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


END_MONTH = "2026-08"
ACTOR = "monthly-log-reconciliation-2026-08"
LEARNERS = {
    4605: "Cheska Hardie", 4778: "Ellen Bates", 4737: "Gemma Phillips",
    4937: "Hannah Grainger", 4765: "Kate McLellan", 4579: "Kiley Brown",
    4275: "Natasha Mylett", 4336: "Nicholas Banks", 4124: "Richard Harper",
    4445: "Roobin Yogaretnam", 4626: "Tetiana Zakaliuzhna", 4841: "Toby Allen",
    4002: "Zoe Dodd",
}

# The task explicitly identifies this learner's cap.  We do not infer a cap
# for anyone else from a free-text employment field.
WEEKLY_CAPS = {4626: Decimal("13")}

MANUAL = 'structured_manual_activities.manual_learner_activities'
ROW_KSB = 'structured_manual_activities.learner_journal_row_ksbs'
LEARNER_KSB = 'structured_manual_activities.learner_activity_ksbs'
ACTIVITY_KSB = 'structured_manual_activities.activity_ksbs'
REVISIONS = 'structured_manual_activities.manual_activity_hours_revision'
AUDIT_TABLE = 'structured_manual_activities.monthly_log_reconciliation_audit'


def _month(value):
    return value.strftime("%Y-%m") if hasattr(value, "strftime") else str(value or "")[:7]


def _json(value):
    return json.dumps(value, default=str, ensure_ascii=False)


def _num(value):
    if value is None:
        return None
    return Decimal(str(value))


def _round_hours(value):
    return Decimal(value).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def _codes(value):
    """Extract real KSB codes from the supported JSON shapes only."""
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    if isinstance(value, dict):
        if any(k in value for k in ("code", "ksbCode", "ksb_code", "full_code")):
            value = [value]
        else:
            flattened = []
            for item in value.values():
                flattened.extend(_codes(item))
            return sorted(set(flattened))
    if not isinstance(value, list):
        return []
    result = []
    for item in value:
        if isinstance(item, str):
            code = item.strip().upper()
        elif isinstance(item, dict):
            code = str(item.get("code") or item.get("ksbCode") or item.get("ksb_code") or item.get("full_code") or "").strip().upper()
        else:
            code = ""
        if re.fullmatch(r"[KSB]\d+[A-Z]?", code):
            result.append(code)
    return sorted(set(result))


def _raw_ksbs(raw):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return []
    if not isinstance(raw, dict):
        return []
    component = raw.get("live_lms_component")
    if isinstance(component, dict):
        return _codes(component.get("ksbs") or component.get("ksb_mappings"))
    return []


def _source_key(row):
    ref = str(row.get("source_ref") or "")
    if ref.startswith("la:"):
        return str(row.get("activity_id") or ref.rsplit(":", 1)[-1])
    if ref.startswith("asg:"):
        return ref[4:].split(":evidence:", 1)[0]
    if ref.startswith("att:"):
        return ref[4:]
    return ref


def _timestamp_seconds(label):
    if not re.fullmatch(r"\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2}", str(label or "")):
        return None
    left, right = str(label).split("-", 1)
    try:
        start = datetime.strptime(left, "%H:%M:%S")
        end = datetime.strptime(right, "%H:%M:%S")
    except ValueError:
        return None
    seconds = int((end - start).total_seconds())
    return seconds if seconds > 0 else None


def _evidence_id(source_ref):
    ref = str(source_ref or "")
    match = re.search(r":evidence:(\d+)$", ref) or re.fullmatch(r"ev:(\d+)", ref)
    return int(match.group(1)) if match else None


def _readable_evidence(item):
    return bool(item and (
        (item.get("content_char_count") or 0) > 0
        or len(str(item.get("note_content") or "").strip()) >= 20
    ))


def _marked(result):
    if not result:
        return False
    status = str(result.get("status") or "").lower()
    return (status not in ("", "not_started") or bool(result.get("video_started"))
            or bool(result.get("video_completed")) or bool(result.get("reading_viewed"))
            or bool(result.get("quiz_attempted")) or bool(result.get("quiz_passed")))


def _week(value):
    if not value:
        return None
    if isinstance(value, str):
        value = date.fromisoformat(value[:10])
    return date.fromordinal(value.toordinal() - value.weekday()).isoformat()


class Command(BaseCommand):
    help = "Dry-run/apply the scoped historical Monthly Logs reconciliation."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Commit the planned changes.")
        parser.add_argument("--aptem-id", action="append", type=int, dest="aptem_ids", help="Limit to one or more agreed Aptem IDs.")
        parser.add_argument("--json", action="store_true", dest="as_json", help="Emit the report as JSON.")

    def handle(self, *args, **options):
        requested = options.get("aptem_ids") or list(LEARNERS)
        unknown = sorted(set(requested) - set(LEARNERS))
        if unknown:
            raise CommandError(f"Aptem IDs outside the agreed scope: {unknown}")
        report = self._run(sorted(set(requested)), apply=bool(options.get("apply")))
        if options.get("as_json"):
            self.stdout.write(json.dumps(report, default=str, ensure_ascii=False, indent=2))
        else:
            mode = "APPLIED" if options.get("apply") else "DRY-RUN"
            self.stdout.write(f"{mode} Monthly Logs reconciliation ({report['run_id']})")
            for item in report["students"]:
                self.stdout.write(
                    f"{item['aptem_id']} {item['learner']}: "
                    f"rows={item['rows']} rows_changed={item['rows_changed']} field_changes={item['changes']} "
                    f"actual+={item['actual_hours_added']} planned+={item['planned_hours_added']} "
                    f"ksb={item['ksb_mapped']} pending_actual={item['pending_actual']} "
                    f"pending_ksb={item['pending_ksb']} pre_start={item['pre_start_rows']}"
                )
                for month, detail in item["months"].items():
                    if detail["changes"] or detail["pending_actual"] or detail["pending_ksb"]:
                        self.stdout.write(
                            f"  {month}: rows={detail['rows']} rows_changed={detail['rows_changed']} "
                            f"field_changes={detail['changes']} "
                            f"actual+={detail['actual_hours_added']} planned+={detail['planned_hours_added']} "
                            f"ksb={detail['ksb_mapped']} pending_actual={detail['pending_actual']} "
                            f"pending_ksb={detail['pending_ksb']}"
                        )
            self.stdout.write(f"total changes: {report['totals']['changes']}")
            if not options.get("apply"):
                self.stdout.write("No database writes were performed. Re-run with --apply to commit this exact plan.")

    def _run(self, aptem_ids, *, apply):
        run_id = str(uuid.uuid4())
        conn = connections["default"]
        with transaction.atomic(using="default"):
            with conn.cursor() as cursor:
                data = self._load(cursor, aptem_ids)
                plan = self._plan(data, aptem_ids, run_id)
                if apply:
                    self._ensure_audit_table(cursor)
                    self._apply(cursor, plan, run_id)
            if not apply:
                transaction.set_rollback(True, using="default")
        if apply:
            # The report is always read from a fresh snapshot after commit.
            with transaction.atomic(using="default"):
                with conn.cursor() as cursor:
                    verification = self._verify(cursor, aptem_ids)
                transaction.set_rollback(True, using="default")
            plan["verification"] = verification
        return plan

    def _load(self, cursor, aptem_ids):
        cursor.execute(f'''SELECT m.*, l.learner_name, l.learner_id AS canonical_learner_id,
                                  l.planned_hours_total AS programme_hours_total,
                                  au."Start-Date" AS start_date
                           FROM {MANUAL} m
                           LEFT JOIN "Last_audit".learners l ON l.aptem_id=m.aptem_id
                           LEFT JOIN "LMS"."Aptem_users" au ON au."ID"=m.aptem_id
                           WHERE m.aptem_id=ANY(%s) AND m.deleted_at IS NULL
                             AND m.month <= %s
                           ORDER BY m.aptem_id,m.month,m.id''', [aptem_ids, END_MONTH])
        rows = self._dicts(cursor)
        learner_ids = {r["aptem_id"]: r.get("canonical_learner_id") for r in rows}
        # The row-level revision history is the authority for approved fields.
        cursor.execute(f'''SELECT row_id, proposed_actual_hours, proposed_planned_hours
                           FROM {REVISIONS}
                           WHERE aptem_id=ANY(%s) AND status='approved' ''', [aptem_ids])
        approved_actual, approved_planned = set(), set()
        for row_id, actual, planned in cursor.fetchall():
            if actual is not None:
                approved_actual.add(int(row_id))
            if planned is not None:
                approved_planned.add(int(row_id))

        def source(table, cols):
            cursor.execute(f'''SELECT {cols} FROM {table} WHERE aptem_id=ANY(%s)''', [aptem_ids])
            return self._dicts(cursor)

        planned = source('"Last_audit".activity_planned_hours',
                         'aptem_id,month,kind,ref,planned_hours,source')
        actual = source('"Last_audit".activity_actual_hours',
                        'aptem_id,month,kind,ref,actual_hours,reported_hours,reporting_method,timestamp_label,source')
        cursor.execute('''SELECT l.aptem_id,r.group_id,r.activity_id,r.status,r.video_started,
                                 r.video_completed,r.reading_viewed,r.quiz_attempted,r.quiz_passed,
                                 r.mapped_hours,a.activity_type,a.configured_duration_min,a.raw
                          FROM "Last_audit".learners l
                          JOIN "Last_audit".activity_results r ON r.learner_id=l.learner_id
                          JOIN "Last_audit".activities a ON a.activity_id=r.activity_id
                          WHERE l.aptem_id=ANY(%s)''', [aptem_ids])
        results = self._dicts(cursor)
        cursor.execute(f'''SELECT aptem_id,activity_id,ksbs FROM {LEARNER_KSB} WHERE aptem_id=ANY(%s)''', [aptem_ids])
        learner_ksbs = {(r["aptem_id"], r["activity_id"]): _codes(r["ksbs"]) for r in self._dicts(cursor)}
        cursor.execute(f'''SELECT activity_id,ksbs FROM {ACTIVITY_KSB}''')
        activity_ksbs = {r["activity_id"]: _codes(r["ksbs"]) for r in self._dicts(cursor)}
        cursor.execute(f'''SELECT row_id,ksbs FROM {ROW_KSB} WHERE aptem_id=ANY(%s)''', [aptem_ids])
        row_ksbs = {int(r["row_id"]): _codes(r["ksbs"]) for r in self._dicts(cursor)}
        cursor.execute('''SELECT evidence_id,learner_id,ksb_codes,evidence_status,review_status,
                                 content_char_count,note_content,has_explicit_ksbs,source_item
                          FROM fetching_evidence.evidence_items
                          WHERE learner_id=ANY(%s) OR learner_record_id=ANY(%s)''', [aptem_ids, list(learner_ids.values())])
        evidence = {int(r["evidence_id"]): r for r in self._dicts(cursor)}
        return {
            "rows": rows, "approved_actual": approved_actual, "approved_planned": approved_planned,
            "planned": planned, "actual": actual, "results": results,
            "learner_ksbs": learner_ksbs, "activity_ksbs": activity_ksbs,
            "row_ksbs": row_ksbs, "evidence": evidence,
        }

    @staticmethod
    def _dicts(cursor):
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]

    def _plan(self, data, aptem_ids, run_id):
        rows = data["rows"]
        planned = defaultdict(list)
        actual = defaultdict(list)
        for item in data["planned"]:
            planned[(item["aptem_id"], str(item["ref"]))].append(item)
        for item in data["actual"]:
            actual[(item["aptem_id"], str(item["ref"]))].append(item)
        results = {(r["aptem_id"], r["group_id"], r["activity_id"]): r for r in data["results"]}
        # Prefer the latest source row when a legacy import contains duplicates.
        pick = lambda values: sorted(values, key=lambda x: (str(x.get("month") or ""), str(x.get("source") or "")))[-1] if values else None
        by_student = {aid: {"aptem_id": aid, "learner": LEARNERS[aid], "rows": 0, "changes": 0,
                             "actual_hours_added": Decimal("0"), "planned_hours_added": Decimal("0"),
                             "ksb_mapped": 0, "pending_actual": 0, "pending_ksb": 0,
                             "pre_start_rows": 0, "weekly_cap": WEEKLY_CAPS.get(aid), "months": defaultdict(lambda: {
                                 "rows": 0, "changes": 0, "actual_hours_added": Decimal("0"),
                                 "planned_hours_added": Decimal("0"), "ksb_mapped": 0, "pending_actual": 0,
                                 "pending_ksb": 0, "details": []})} for aid in aptem_ids}
        actions = []
        pending = []
        weekly_totals = defaultdict(Decimal)
        programme_totals = defaultdict(Decimal)
        # Existing hours count toward caps, regardless of whether they are new.
        for r in rows:
            if r["aptem_id"] in by_student:
                programme_totals[r["aptem_id"]] += _num(r.get("actual_hours")) or Decimal("0")
                if r.get("activity_date"):
                    weekly_totals[(r["aptem_id"], _week(r["activity_date"]))] += _num(r.get("actual_hours")) or Decimal("0")
        for row in rows:
            aid = row["aptem_id"]
            stat = by_student[aid]
            stat["rows"] += 1
            month = str(row["month"])
            mstat = stat["months"][month]
            mstat["rows"] += 1
            row_id = int(row["id"])
            if row.get("start_date") and row.get("activity_date") and row["activity_date"] < row["start_date"]:
                stat["pre_start_rows"] += 1

            approved_month = row_id in data["approved_actual"] or row_id in data["approved_planned"]
            date_month = _month(row.get("activity_date")) if row.get("activity_date") else ""
            if date_month and date_month != month and date_month <= END_MONTH and not approved_month:
                actions.append({"op": "month", "row_id": row_id, "aptem_id": aid, "month": month, "old": month, "new": date_month,
                                "source": "manual_learner_activities.activity_date", "reason": "activity_date_month"})
                stat["changes"] += 1; mstat["changes"] += 1
            elif date_month and date_month != month and approved_month:
                pending.append(self._pending(stat, mstat, row, "month", "approved_history_before_start_or_wrong_month"))

            key = _source_key(row)
            src_plan = pick(planned.get((aid, key)))
            current_plan = _num(row.get("planned_hours")) or Decimal("0")
            if current_plan <= 0 and row_id not in data["approved_planned"] and src_plan and _num(src_plan.get("planned_hours")) and _num(src_plan.get("planned_hours")) > 0:
                value = _round_hours(_num(src_plan["planned_hours"]))
                actions.append({"op": "planned", "row_id": row_id, "aptem_id": aid, "month": month, "old": current_plan, "new": value,
                                "source": f"Last_audit.activity_planned_hours:{src_plan.get('source') or key}", "reason": "missing_planned"})
                stat["changes"] += 1; stat["planned_hours_added"] += value; mstat["changes"] += 1; mstat["planned_hours_added"] += value

            current_actual = _num(row.get("actual_hours")) or Decimal("0")
            evidence_id = _evidence_id(row.get("source_ref"))
            evidence_item = data["evidence"].get(evidence_id) if evidence_id else None
            if (current_actual > 0 and str(row.get("category") or "").lower() == "assignment"
                    and evidence_id and not _readable_evidence(evidence_item)):
                pending.append(self._pending(
                    stat, mstat, row, "actual",
                    "existing_assignment_actual_preserved_manual_review_unreadable_evidence"))
            if current_actual <= 0 and row_id not in data["approved_actual"]:
                source_actual = pick(actual.get((aid, key)))
                candidate, source_label, reason = self._actual_candidate(
                    row, source_actual, results.get((aid, row.get("group_id"), row.get("activity_id"))), evidence_item)
                if candidate is not None and candidate > 0:
                    week = (aid, _week(row.get("activity_date")))
                    cap = WEEKLY_CAPS.get(aid)
                    if cap is not None and weekly_totals[week] + candidate > cap:
                        reason = f"weekly_cap_{cap}h"
                        candidate = None
                    if candidate is not None:
                        actions.append({"op": "actual", "row_id": row_id, "aptem_id": aid, "month": month, "old": current_actual,
                                        "new": candidate, "source": source_label, "reason": "missing_actual"})
                        weekly_totals[week] += candidate; programme_totals[aid] += candidate
                        stat["changes"] += 1; stat["actual_hours_added"] += candidate; mstat["changes"] += 1; mstat["actual_hours_added"] += candidate
                    elif reason:
                        pending.append(self._pending(stat, mstat, row, "actual", reason))
                elif reason:
                    pending.append(self._pending(stat, mstat, row, "actual", reason))

            current_codes = data["row_ksbs"].get(row_id, [])
            if not current_codes:
                codes, source_label = self._ksb_candidate(row, data)
                if codes:
                    actions.append({"op": "ksb", "row_id": row_id, "aptem_id": aid, "month": month, "old": [], "new": codes,
                                    "source": source_label, "reason": "missing_ksb"})
                    stat["changes"] += 1; stat["ksb_mapped"] += 1; mstat["changes"] += 1; mstat["ksb_mapped"] += 1
                else:
                    pending.append(self._pending(stat, mstat, row, "ksb", "no_real_evidence_or_activity_mapping"))

        changed_by_student = defaultdict(set)
        changed_by_month = defaultdict(set)
        for action in actions:
            changed_by_student[action["aptem_id"]].add(action["row_id"])
            changed_by_month[(action["aptem_id"], action["month"])].add(action["row_id"])
        for stat in by_student.values():
            stat["rows_changed"] = len(changed_by_student[stat["aptem_id"]])
            stat["months"] = {k: dict(v) for k, v in sorted(stat["months"].items())}
            for field in ("actual_hours_added", "planned_hours_added"):
                stat[field] = str(_round_hours(stat[field]))
            for month in stat["months"].values():
                month["actual_hours_added"] = str(_round_hours(month["actual_hours_added"]))
                month["planned_hours_added"] = str(_round_hours(month["planned_hours_added"]))
            for month_key, month in stat["months"].items():
                month["rows_changed"] = len(changed_by_month[(stat["aptem_id"], month_key)])
        return {"run_id": run_id, "end_month": END_MONTH, "scope": sorted(aptem_ids),
                "students": list(by_student.values()), "actions": actions, "pending_review": pending,
                "totals": {"changes": len(actions), "pending_review": len(pending)}}

    def _actual_candidate(self, row, source, result, evidence_item=None):
        category = str(row.get("category") or "").lower()
        row_seconds = _timestamp_seconds(row.get("timestamp_label"))
        if row_seconds:
            return _round_hours(Decimal(row_seconds) / Decimal(3600)), "manual_learner_activities.timestamp_label", None
        if category == "assignment":
            # An assignment is only auto-countable when the linked evidence is
            # actually readable. A source duration alone is not proof of work.
            readable = _readable_evidence(evidence_item)
            if readable and source:
                value = _num(source.get("actual_hours"))
                if value and value > 0:
                    return _round_hours(value), f"Last_audit.activity_actual_hours:{source.get('source') or 'accepted'} + readable_evidence", None
            return None, None, "assignment_without_readable_evidence"
        if source:
            seconds = _timestamp_seconds(source.get("timestamp_label"))
            if seconds:
                return _round_hours(Decimal(seconds) / Decimal(3600)), f"Last_audit.activity_actual_hours:{source.get('source') or 'timestamp'}", None
            value = _num(source.get("actual_hours"))
            if value and value > 0:
                return _round_hours(value), f"Last_audit.activity_actual_hours:{source.get('source') or 'accepted'}", None
        if category == "attendance":
            return None, None, "attendance_not_attended_or_no_accepted_hours"
        if not _marked(result):
            return None, None, "activity_not_marked"
        mapped = _num(result.get("mapped_hours"))
        if mapped and mapped > 0:
            return _round_hours(mapped), "Last_audit.activity_results:mapped_hours", None
        if category in {"reading+quiz", "reading_quiz", "reading"}:
            # 29 minutes snapped to the approved five-minute grid = 30 minutes.
            return Decimal("0.5"), "Last_audit.activity_results:reading_quiz_29m_snapped_5m", None
        duration = _num(result.get("configured_duration_min"))
        if duration and duration > 0:
            return _round_hours(duration / Decimal(60)), "Last_audit.activities:configured_media_duration", None
        return None, None, "media_duration_missing_manual_review"

    def _ksb_candidate(self, row, data):
        activity_id = row.get("activity_id")
        if activity_id:
            codes = data["learner_ksbs"].get((row["aptem_id"], activity_id), [])
            if codes:
                return codes, f"learner_activity_ksbs:{row['aptem_id']}:{activity_id}"
            codes = data["activity_ksbs"].get(activity_id, [])
            if codes:
                return codes, f"activity_ksbs:{activity_id}"
            result = next((r for r in data["results"] if r["aptem_id"] == row["aptem_id"] and r["activity_id"] == activity_id), None)
            codes = _raw_ksbs(result.get("raw") if result else None)
            if codes:
                return codes, f"Last_audit.activities.raw:{activity_id}"
        evidence_id = _evidence_id(row.get("source_ref"))
        if evidence_id:
            item = data["evidence"].get(evidence_id)
            codes = _codes(item.get("ksb_codes") if item else None)
            if codes:
                return codes, f"fetching_evidence.evidence_items:{evidence_id}"
        return [], None

    @staticmethod
    def _pending(stat, mstat, row, field, reason):
        stat["pending_actual" if field == "actual" else "pending_ksb"] += 1 if field in {"actual", "ksb"} else 0
        mstat["pending_actual" if field == "actual" else "pending_ksb"] += 1 if field in {"actual", "ksb"} else 0
        return {"op": "pending_review", "row_id": int(row["id"]), "aptem_id": row["aptem_id"],
                "month": str(row["month"]), "field": field, "source": None, "reason": reason}

    def _ensure_audit_table(self, cursor):
        cursor.execute(f'''CREATE TABLE IF NOT EXISTS {AUDIT_TABLE} (
            audit_id bigserial PRIMARY KEY, run_id uuid NOT NULL, row_id bigint,
            aptem_id bigint NOT NULL, month text, field text NOT NULL,
            old_value jsonb, new_value jsonb, source text, status text NOT NULL,
            reason text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
        )''')
        cursor.execute(f"CREATE INDEX IF NOT EXISTS monthly_log_recon_audit_run_idx ON {AUDIT_TABLE}(run_id)")

    def _apply(self, cursor, plan, run_id):
        for action in plan["actions"]:
            row_id, aid = action["row_id"], action["aptem_id"]
            if action["op"] == "month":
                cursor.execute(f"UPDATE {MANUAL} SET month=%s,updated_by=%s,updated_at=now() WHERE id=%s AND aptem_id=%s AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM {MANUAL} x WHERE x.aptem_id=%s AND x.month=%s AND x.source_ref={MANUAL}.source_ref AND x.id<>%s AND x.deleted_at IS NULL)", [action["new"], ACTOR, row_id, aid, aid, action["new"], row_id])
            elif action["op"] == "planned":
                cursor.execute(f"UPDATE {MANUAL} SET planned_hours=%s,updated_by=%s,updated_at=now() WHERE id=%s AND aptem_id=%s AND deleted_at IS NULL AND planned_hours=0", [action["new"], ACTOR, row_id, aid])
            elif action["op"] == "actual":
                cursor.execute(f"UPDATE {MANUAL} SET actual_hours=%s,updated_by=%s,updated_at=now() WHERE id=%s AND aptem_id=%s AND deleted_at IS NULL AND actual_hours=0", [action["new"], ACTOR, row_id, aid])
            elif action["op"] == "ksb":
                payload = json.dumps([{"code": code} for code in action["new"]], ensure_ascii=False)
                cursor.execute(f"INSERT INTO {ROW_KSB}(row_id,aptem_id,ksbs,version,created_by,updated_by) VALUES(%s,%s,%s::jsonb,1,%s,%s) ON CONFLICT (row_id) DO UPDATE SET ksbs=CASE WHEN {ROW_KSB}.ksbs IS NULL OR {ROW_KSB}.ksbs='[]'::jsonb THEN EXCLUDED.ksbs ELSE {ROW_KSB}.ksbs END, version={ROW_KSB}.version+1, updated_by=EXCLUDED.updated_by, updated_at=now()", [row_id, aid, payload, ACTOR, ACTOR])
            cursor.execute(f"INSERT INTO {AUDIT_TABLE}(run_id,row_id,aptem_id,month,field,old_value,new_value,source,status,reason,created_by) VALUES(%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,'applied',%s,%s)", [run_id, row_id, aid, action.get("month"), action["op"], _json(action.get("old")), _json(action.get("new")), action.get("source"), action.get("reason"), ACTOR])
        for item in plan["pending_review"]:
            cursor.execute(f"INSERT INTO {AUDIT_TABLE}(run_id,row_id,aptem_id,month,field,source,status,reason,created_by) VALUES(%s,%s,%s,%s,%s,%s,'pending_review',%s,%s)", [run_id, item["row_id"], item["aptem_id"], item["month"], item["field"], item.get("source"), item["reason"], ACTOR])

    def _verify(self, cursor, aptem_ids):
        cursor.execute(f'''SELECT m.aptem_id,l.learner_name,m.month,m.actual_hours,m.planned_hours,m.activity_date,
                                  k.ksbs,au."Start-Date" AS start_date
                           FROM {MANUAL} m LEFT JOIN "Last_audit".learners l ON l.aptem_id=m.aptem_id
                           LEFT JOIN {ROW_KSB} k ON k.row_id=m.id
                           LEFT JOIN "LMS"."Aptem_users" au ON au."ID"=m.aptem_id
                           WHERE m.aptem_id=ANY(%s) AND m.deleted_at IS NULL AND m.month <= %s''',[aptem_ids,END_MONTH])
        rows=self._dicts(cursor); out={}
        for row in rows:
            stat=out.setdefault(row["aptem_id"],{"aptem_id":row["aptem_id"],"learner":LEARNERS[row["aptem_id"]],"actual_total":Decimal("0"),"planned_total":Decimal("0"),"activities":0,"without_actual":0,"without_ksb":0,"pre_start_rows":0,"weekly":defaultdict(Decimal)})
            stat["actual_total"] += _num(row.get("actual_hours")) or Decimal("0"); stat["planned_total"] += _num(row.get("planned_hours")) or Decimal("0"); stat["activities"] += 1
            if (_num(row.get("actual_hours")) or Decimal("0")) <= 0: stat["without_actual"] += 1
            if not _codes(row.get("ksbs")): stat["without_ksb"] += 1
            if row.get("start_date") and row.get("activity_date") and row["activity_date"] < row["start_date"]: stat["pre_start_rows"] += 1
            if row.get("activity_date"): stat["weekly"][_week(row["activity_date"])] += _num(row.get("actual_hours")) or Decimal("0")
        result=[]
        for aid,stat in sorted(out.items()):
            weekly={k:str(_round_hours(v)) for k,v in stat.pop("weekly").items()}
            cap=WEEKLY_CAPS.get(aid)
            over=sorted(k for k,v in weekly.items() if cap is not None and Decimal(v)>cap)
            near=sorted(k for k,v in weekly.items() if cap is not None and Decimal(v)>=cap*Decimal("0.9"))
            result.append({**stat,"actual_total":str(_round_hours(stat["actual_total"])),"planned_total":str(_round_hours(stat["planned_total"])),"weekly":weekly,"weekly_cap":str(cap) if cap else None,"weeks_over_cap":over,"weeks_near_cap":near})
        return result
