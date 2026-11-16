import json
import re

from django.db import DatabaseError, IntegrityError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from login.permissions import staff_only

from .models import DeepDiveRecord, DeepDiveSyncRun


EDITABLE_FIELDS = frozenset({
    "firstName", "surname", "fullName", "dateOfBirth", "uln", "qualification", "level",
    "startDate", "practicalEndDate", "apprenticeshipEndDate", "plannedGatewayDate", "plannedEpaDate",
    "observer", "reviewedBy", "notes",
})
OPERATIONAL_GROUP_FIELDS = {
    "mcm": {"last", "next", "lastCompleted", "dates"},
    "pr": {"last", "next", "lastCompleted", "dates"},
    "progress": {
        "otjhPlanned", "otjhExpected", "otjhActual", "expectedProgression", "actualProgression",
        "progressVariance", "progressHours", "riskRating", "otjhStatus", "ksbTarget", "ksbCompleted",
        "ksbStatus", "disability",
    },
    "inclusion": {
        "lldd", "llddCategories", "demographicsMatched", "otjStatus", "otjCompleted", "otjExpected",
        "ksbCompleted", "ksbTarget", "latestMonthly", "latestReview",
    },
    "plr": {"records"},
}
FIELD_MAP = {
    "firstName": "first_name", "surname": "surname", "fullName": "full_name", "dateOfBirth": "date_of_birth",
    "uln": "uln", "qualification": "qualification", "level": "level", "startDate": "start_date",
    "practicalEndDate": "practical_end_date", "apprenticeshipEndDate": "apprenticeship_end_date",
    "plannedGatewayDate": "planned_gateway_date", "plannedEpaDate": "planned_epa_date",
    "observer": "observer", "reviewedBy": "reviewed_by", "notes": "notes",
}


def _text(value, limit=255):
    return str(value or "").strip()[:limit]


def _metric_text(value):
    """Stringify reporting values without dropping a real numeric zero."""
    return "" if value is None else str(value).strip()


def _operational_overrides(value):
    if not isinstance(value, dict):
        raise ValueError("Operational details must be an object.")
    cleaned = {}
    for group, fields in OPERATIONAL_GROUP_FIELDS.items():
        section = value.get(group)
        if section is None:
            continue
        if not isinstance(section, dict):
            raise ValueError("Operational detail sections must be objects.")
        output = {}
        for key in fields:
            if key not in section:
                continue
            item = section[key]
            if group in {"mcm", "pr"} and key == "dates":
                if not isinstance(item, list) or len(item) > 50:
                    raise ValueError("Review dates must be a list of no more than 50 items.")
                dates = []
                for date_item in item:
                    if not isinstance(date_item, dict):
                        raise ValueError("Review date items must be objects.")
                    try:
                        number = int(date_item.get("number", len(dates) + 1))
                    except (TypeError, ValueError):
                        raise ValueError("Review date numbers must be integers.") from None
                    dates.append({
                        "number": max(1, min(number, 999)),
                        "date": _text(date_item.get("date"), 255),
                        "status": _text(date_item.get("status"), 255),
                    })
                output[key] = dates
            elif group == "inclusion" and key == "llddCategories":
                if not isinstance(item, list) or len(item) > 50:
                    raise ValueError("Support categories must be a list of no more than 50 items.")
                output[key] = [_text(entry, 255) for entry in item[:50] if _text(entry, 255)]
            elif group == "inclusion" and key == "demographicsMatched":
                output[key] = item if isinstance(item, bool) else None
            elif group == "plr" and key == "records":
                try:
                    output[key] = max(0, min(int(item), 100000))
                except (TypeError, ValueError):
                    raise ValueError("PLR records must be a non-negative number.") from None
            else:
                output[key] = _text(item, 255)
        if output:
            cleaned[group] = output
    return cleaned


def _merged_operational(authoritative, overrides):
    operational = dict((authoritative or {}).get("operational") or {})
    for group, section in (overrides or {}).items():
        if isinstance(section, dict) and isinstance(operational.get(group), dict):
            operational[group] = {**operational[group], **section}
        else:
            operational[group] = section
    return operational


def _normal(value):
    return re.sub(r"[^a-z0-9]", "", _text(value).casefold())


def _actor(request):
    account = getattr(request, "login_account", None)
    return _text(getattr(account, "display_name", None) or getattr(account, "email", None), 255) or "quality-staff"


def _body(request):
    try:
        value = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        raise ValueError("The request body must be valid JSON.") from None
    if not isinstance(value, dict):
        raise ValueError("The request body must be an object.")
    return value


def _raw_text(raw, *keys):
    if not isinstance(raw, dict):
        return ""
    for key in keys:
        value = raw.get(key)
        if value not in (None, ""):
            return _text(value)
    return ""


def _lms_context(learner_ids):
    """Read the authoritative learner fields for the current QMS response.

    Deep Dive rows keep workbook/planning fields locally, but identity and
    programme status belong to enrolment.Created_users.  Resolve the linked
    rows in one bounded query so the UI never has to infer a status from a
    missing workbook field.
    """
    ids = {int(value) for value in learner_ids if value is not None}
    if not ids:
        return {}
    try:
        from learner_api.models import EnrolmentUser, LearnerProfile

        learners = list(EnrolmentUser.all_learners.filter(id__in=ids).only(
            "id", "username", "email", "programme_status", "programme", "cohort",
            "learner_type", "reference_number", "coach_name", "coach_email", "aptem_id",
            "learner_start_date", "learner_end_date", "start_date", "end_date",
            "apprenticeship_end_date",
        ))
    except (DatabaseError, LookupError, TypeError, ValueError):
        return {}
    try:
        profiles = list(LearnerProfile.objects.filter(enrolment_id__in=ids).only(
            "enrolment_id", "gateway_review_date", "enter_epa", "alert_notify_for_epa", "cohort_id",
        ))
    except (DatabaseError, LookupError, TypeError, ValueError):
        profiles = []
    profiles_by_learner_id = {profile.enrolment_id: profile for profile in profiles}

    # A learner's end dates have historically been mirrored into more than one
    # read-only source.  Use the live enrolment value first, then the imported
    # Aptem end-date/contract mirrors.  This is intentionally a read-only
    # fallback: it must not copy a deleted cohort or manufacture gateway/EPA
    # dates from a duration calculation.
    end_dates_by_aptem_id = {}
    contract_end_dates_by_aptem_id = {}
    aptem_ids = {_text(getattr(learner, "aptem_id", ""), 64) for learner in learners}
    aptem_ids.discard("")
    numeric_aptem_ids = [value for value in aptem_ids if value.isdigit()]
    if numeric_aptem_ids:
        try:
            from django.db import connections

            placeholders = ", ".join(["%s"] * len(numeric_aptem_ids))
            with connections["default"].cursor() as cursor:
                cursor.execute(
                    f"SELECT learner_id, actual_end_date "
                    f"FROM fetching_evidence.learner_end_dates "
                    f"WHERE learner_id IN ({placeholders}) AND actual_end_date IS NOT NULL",
                    [int(value) for value in numeric_aptem_ids],
                )
                end_dates_by_aptem_id = {
                    str(learner_id): _text(actual_end_date)
                    for learner_id, actual_end_date in cursor.fetchall()
                }
                cursor.execute(
                    f"SELECT learner_id, planned_end_date::date "
                    f"FROM fetching_evidence.aptem_cv_contracts_probe "
                    f"WHERE learner_id IN ({placeholders}) AND planned_end_date IS NOT NULL "
                    f"ORDER BY planned_end_date DESC",
                    [int(value) for value in numeric_aptem_ids],
                )
                for learner_id, planned_end_date in cursor.fetchall():
                    contract_end_dates_by_aptem_id.setdefault(str(learner_id), _text(planned_end_date))
        except (DatabaseError, LookupError, TypeError, ValueError):
            end_dates_by_aptem_id = {}
            contract_end_dates_by_aptem_id = {}

    # Some older enrolment records store EPA planning as JSON on the signed
    # training-plan/written-agreement rows.  Read only explicit dates when the
    # rows are linked to this learner; do not infer them from an end date.
    plan_dates_by_learner_id = {}
    try:
        from django.db import connections

        placeholders = ", ".join(["%s"] * len(ids))
        with connections["default"].cursor() as cursor:
            cursor.execute(
                f"SELECT \"Learner_id\", \"Epa\" FROM enrolment.\"Training_Plan_Documents\" "
                f"WHERE \"Learner_id\" IN ({placeholders}) AND \"Epa\" IS NOT NULL",
                list(ids),
            )
            rows = cursor.fetchall()
            cursor.execute(
                f"SELECT \"Learner_id\", \"Epa\" FROM enrolment.\"Written_Agreements\" "
                f"WHERE \"Learner_id\" IN ({placeholders}) AND \"Epa\" IS NOT NULL",
                list(ids),
            )
            rows.extend(cursor.fetchall())
        for learner_id, epa in rows:
            if not isinstance(epa, dict):
                continue
            entry = plan_dates_by_learner_id.setdefault(str(learner_id), {})
            for key, target in (
                ("gatewayReviewDate", "plannedGatewayDate"),
                ("gateway_review_date", "plannedGatewayDate"),
                ("epaPeriodFrom", "plannedEpaDate"),
                ("epa_period_from", "plannedEpaDate"),
            ):
                if not entry.get(target) and _text(epa.get(key)):
                    entry[target] = _text(epa.get(key))
    except (DatabaseError, LookupError, TypeError, ValueError):
        plan_dates_by_learner_id = {}

    operational_by_aptem_id = {}
    if numeric_aptem_ids:
        try:
            from django.db import connections

            numeric_placeholders = ", ".join(["%s"] * len(numeric_aptem_ids))
            text_placeholders = ", ".join(["%s"] * len(numeric_aptem_ids))

            def fetch_rows(schema, table, key_column, params):
                with connections["default"].cursor() as cursor:
                    cursor.execute(
                        f'SELECT * FROM "{schema}"."{table}" '
                        f'WHERE "{key_column}" IN ({numeric_placeholders if key_column == "ID" else text_placeholders})',
                        params,
                    )
                    columns = [column.name for column in cursor.description]
                    return [dict(zip(columns, row)) for row in cursor.fetchall()]

            mcr_rows = fetch_rows("LMS", "MCR", "ID", numeric_aptem_ids)
            pr_rows = fetch_rows("LMS", "PR", "ID", numeric_aptem_ids)
            aptem_rows = fetch_rows("LMS", "Aptem_users", "ID", numeric_aptem_ids)
            inclusion_rows = fetch_rows("kbc_quality_reporting", "inclusion_learners", "learner_id", [str(value) for value in numeric_aptem_ids])
            with connections["default"].cursor() as cursor:
                cursor.execute(
                    f"SELECT learner_id, count(*) FROM fetching_evidence.aptem_plr_probe "
                    f"WHERE learner_id IN ({numeric_placeholders}) GROUP BY learner_id",
                    numeric_aptem_ids,
                )
                plr_counts = {str(learner_id): count for learner_id, count in cursor.fetchall()}

            def review_items(row, date_prefix, status_prefix, count):
                items = []
                for number in range(1, count + 1):
                    date_value = _metric_text(row.get(f"{date_prefix}{number}"))
                    status_value = _metric_text(row.get(f"{status_prefix}{number}"))
                    if date_value or status_value:
                        items.append({"number": number, "date": date_value, "status": status_value})
                return items

            for row in mcr_rows:
                key = str(row.get("ID"))
                operational_by_aptem_id.setdefault(key, {})["mcm"] = {
                    "last": _metric_text(row.get("Last MCM")),
                    "next": _metric_text(row.get("Next MCM")),
                    "lastCompleted": _metric_text(row.get("Last Actually Completed MCM")),
                    "dates": review_items(row, "MCM", "Status", 22),
                }
            for row in pr_rows:
                key = str(row.get("ID"))
                operational_by_aptem_id.setdefault(key, {})["pr"] = {
                    "last": _metric_text(row.get("Last Progress Review")),
                    "next": _metric_text(row.get("Next Review (Status)")),
                    "lastCompleted": _metric_text(row.get("Last Actually Completed PR")),
                    "dates": review_items(row, "Review Planned Date", "Review Status", 16),
                }
            for row in aptem_rows:
                key = str(row.get("ID"))
                operational_by_aptem_id.setdefault(key, {})["progress"] = {
                    "otjhPlanned": _metric_text(row.get("Planned")),
                    "otjhExpected": _metric_text(row.get("Exepected")),
                    "otjhActual": _metric_text(row.get("Completed")),
                    "expectedProgression": _metric_text(row.get("TargetComp%")),
                    "actualProgression": _metric_text(row.get("CompletedComp%")),
                    "progressVariance": _metric_text(row.get("ProgressVariance")),
                    "progressHours": _metric_text(row.get("Progress-Hours")),
                    "riskRating": _metric_text(row.get("Coach-RAG")),
                    "otjhStatus": _metric_text(row.get("OTJHoursStatus")),
                    "ksbTarget": _metric_text(row.get("TotalTargetKSB")),
                    "ksbCompleted": _metric_text(row.get("TotalCompletedKSB")),
                    "ksbStatus": _metric_text(row.get("KSBStatus")),
                    "disability": _metric_text(row.get("Disability")),
                }
            for row in inclusion_rows:
                key = str(row.get("learner_id"))
                operational_by_aptem_id.setdefault(key, {})["inclusion"] = {
                    "lldd": _metric_text(row.get("lldd")),
                    "llddCategories": row.get("lldd_categories") if isinstance(row.get("lldd_categories"), list) else [],
                    "demographicsMatched": row.get("demographics_matched"),
                    "otjStatus": _metric_text(row.get("otj_status")),
                    "otjCompleted": _metric_text(row.get("otj_completed")),
                    "otjExpected": _metric_text(row.get("otj_expected")),
                    "ksbCompleted": _metric_text(row.get("ksb_completed")),
                    "ksbTarget": _metric_text(row.get("ksb_target")),
                    "latestMonthly": _metric_text(row.get("latest_monthly")),
                    "latestReview": _metric_text(row.get("latest_review")),
                }
            for learner_id, count in plr_counts.items():
                operational_by_aptem_id.setdefault(learner_id, {})["plr"] = {"records": count}
        except (DatabaseError, LookupError, TypeError, ValueError):
            operational_by_aptem_id = {}

    # These are source columns in Created_users rather than learner-profile
    # fields. Keep them as optional operational context so the detail view can
    # show the real exemption/declaration values when the sheet supplied them.
    source_flags_by_learner_id = {}
    try:
        from django.db import connections

        placeholders = ", ".join(["%s"] * len(ids))
        with connections["default"].cursor() as cursor:
            cursor.execute(
                f'SELECT id, "Declarations_/_consents", "English_Exemption_from_Functional_Skills", '
                f'"Maths_Exemption_from_Functional_Skills", "ICT_Exemption_from_Functional_Skills" '
                f'FROM enrolment."Created_users" WHERE id IN ({placeholders})',
                list(ids),
            )
            for learner_id, declarations, english, maths, ict in cursor.fetchall():
                source_flags_by_learner_id[str(learner_id)] = {
                    "declarations": declarations,
                    "functionalSkillsExemptions": {"english": english, "maths": maths, "ict": ict},
                }
    except (DatabaseError, LookupError, TypeError, ValueError):
        source_flags_by_learner_id = {}
    cohort_dates = {}
    cohort_ids = {profile.cohort_id for profile in profiles if _text(profile.cohort_id)}
    if cohort_ids:
        try:
            from django.db import connections

            placeholders = ", ".join(["%s"] * len(cohort_ids))
            with connections["default"].cursor() as cursor:
                cursor.execute(
                    f"SELECT cohort_id, apprenticeship_end_date, apprenticeship_end_override "
                    f"FROM curriculum.cohorts WHERE cohort_id IN ({placeholders}) AND deleted_at IS NULL",
                    list(cohort_ids),
                )
                cohort_dates = {
                    str(cohort_id): {
                        "apprenticeshipEndDate": _text(apprenticeship_end_override or apprenticeship_end_date),
                    }
                    for cohort_id, apprenticeship_end_date, apprenticeship_end_override in cursor.fetchall()
                }
        except (DatabaseError, LookupError, TypeError, ValueError):
            cohort_dates = {}

    def value(learner, field):
        return _text(getattr(learner, field, ""))

    def profile_value(learner, field):
        return _text(getattr(profiles_by_learner_id.get(learner.id), field, ""))

    def cohort_value(learner, field):
        profile = profiles_by_learner_id.get(learner.id)
        return _text((cohort_dates.get(_text(getattr(profile, "cohort_id", ""))) or {}).get(field, ""))

    def imported_end_date(learner):
        aptem_id = _text(getattr(learner, "aptem_id", ""), 64)
        return end_dates_by_aptem_id.get(aptem_id) or contract_end_dates_by_aptem_id.get(aptem_id, "")

    def plan_date(learner, field):
        return _text((plan_dates_by_learner_id.get(str(learner.id)) or {}).get(field, ""))

    def operational_value(learner):
        return {
            **(operational_by_aptem_id.get(_text(getattr(learner, "aptem_id", ""), 64)) or {}),
            **(source_flags_by_learner_id.get(str(learner.id)) or {}),
        }

    return {
        str(learner.id): {
            "fullName": value(learner, "username"),
            "email": value(learner, "email"),
            "programmeStatus": value(learner, "programme_status"),
            "programme": value(learner, "programme"),
            "cohort": value(learner, "cohort"),
            "learnerType": value(learner, "learner_type"),
            "reference": value(learner, "reference_number"),
            "coachName": value(learner, "coach_name"),
            "coachEmail": value(learner, "coach_email"),
            "learnerStartDate": value(learner, "learner_start_date"),
            "learnerEndDate": value(learner, "learner_end_date"),
            "startDate": value(learner, "start_date"),
            "endDate": value(learner, "end_date") or value(learner, "apprenticeship_end_date") or imported_end_date(learner),
            "apprenticeshipEndDate": (
                value(learner, "apprenticeship_end_date")
                or cohort_value(learner, "apprenticeshipEndDate")
                or imported_end_date(learner)
            ),
            "plannedGatewayDate": profile_value(learner, "gateway_review_date") or plan_date(learner, "plannedGatewayDate"),
            "plannedEpaDate": profile_value(learner, "enter_epa") or plan_date(learner, "plannedEpaDate"),
            "operational": operational_value(learner),
        }
        for learner in learners
    }


def _reviewer_names(records):
    emails = {
        _text(record.reviewed_by, 255).casefold()
        for record in records
        if "@" in _text(record.reviewed_by, 255)
    }
    if not emails:
        return {}
    try:
        from login.models import LoginAccount

        return {
            str(email).casefold(): _text(display_name, 255)
            for email, display_name in LoginAccount.objects.filter(email__in=emails).values_list("email", "display_name")
            if _text(display_name, 255)
        }
    except (DatabaseError, LookupError, TypeError, ValueError):
        return {}


def _serialize(record, context=None, reviewer_names=None):
    raw = dict(record.raw or {})
    authoritative = (context or {}).get(str(record.lms_learner_id))
    reviewer_value = _text(record.reviewed_by, 255)
    reviewer_label = (reviewer_names or {}).get(reviewer_value.casefold(), reviewer_value)
    if authoritative:
        # Keep planning fields from the workbook, while overlaying the live
        # LMS fields that the dashboard must not invent or label as "Not matched".
        raw = {
            **raw,
            **{key: value for key, value in authoritative.items() if value},
        }
    return {
        "id": str(record.id),
        "identityKey": record.identity_key,
        "sourceFileName": record.source_file_name,
        "sourceFileHash": record.source_file_hash,
        "sourceSheet": record.source_sheet,
        "sourceRow": record.source_row,
        "lmsLearnerId": str(record.lms_learner_id) if record.lms_learner_id is not None else None,
        "firstName": record.first_name,
        "surname": record.surname,
        "fullName": record.full_name,
        "dateOfBirth": record.date_of_birth,
        "uln": record.uln,
        "qualification": record.qualification,
        "level": record.level,
        "startDate": record.start_date,
        "practicalEndDate": record.practical_end_date,
        "apprenticeshipEndDate": record.apprenticeship_end_date or (authoritative or {}).get("apprenticeshipEndDate", ""),
        "plannedGatewayDate": record.planned_gateway_date or (authoritative or {}).get("plannedGatewayDate", ""),
        "plannedEpaDate": record.planned_epa_date or (authoritative or {}).get("plannedEpaDate", ""),
        "operational": _merged_operational(authoritative, record.operational_overrides),
        "observer": record.observer,
        "reviewedBy": reviewer_label,
        "notes": record.notes,
        "raw": raw,
        "version": record.version,
        "updatedBy": record.updated_by,
        "reviewedAt": record.reviewed_at.isoformat() if record.reviewed_at else None,
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "updatedAt": record.updated_at.isoformat() if record.updated_at else None,
    }


def _lms_matches(records):
    """Match imported rows with one bounded read from the learner database."""
    try:
        from enrolment_api.models import WizardPlr
        from learner_api.models import EnrolmentUser

        learners = list(EnrolmentUser.all_learners.only("id", "username", "email", "reference_number", "date_of_birth"))
        ulns = {
            str(learner_id): _text(uln, 64)
            for learner_id, uln in WizardPlr.objects.filter(learner_kind="apprenticeship").values_list("learner_id", "uln")
            if _text(uln, 64)
        }
    except (DatabaseError, LookupError):
        return {}

    by_uln = {value: str(learner.id) for learner in learners if (value := ulns.get(str(learner.id)))}
    by_reference = {_normal(getattr(learner, "reference_number", "")): str(learner.id) for learner in learners if _normal(getattr(learner, "reference_number", ""))}
    by_email = {_normal(getattr(learner, "email", "")): str(learner.id) for learner in learners if _normal(getattr(learner, "email", ""))}
    by_name = {_normal(getattr(learner, "username", "")): str(learner.id) for learner in learners if _normal(getattr(learner, "username", ""))}

    matches = {}
    for row in records:
        uln = _text(row.get("uln"), 64)
        name = _normal(row.get("fullName") or f"{row.get('firstName', '')} {row.get('surname', '')}")
        reference = _normal(row.get("reference"))
        email = _normal(row.get("email"))
        match = by_uln.get(uln) or by_reference.get(reference) or by_email.get(email) or by_name.get(name)
        if match:
            matches[row.get("identityKey")] = match
    return matches


def _created_user_values(user):
    full_name = _text(getattr(user, "username", ""), 511)
    parts = full_name.split()
    first_name = parts[0] if parts else ""
    surname = " ".join(parts[1:]) if len(parts) > 1 else ""
    return {
        "identity_key": f"lms:{user.id}",
        "source_file_name": "LMS Created_users monthly sync",
        "source_file_hash": "",
        "source_sheet": "Created_users",
        "source_row": user.id,
        "lms_learner_id": user.id,
        "first_name": first_name,
        "surname": surname,
        "full_name": full_name or f"Learner {user.id}",
        "date_of_birth": _text(getattr(user, "date_of_birth", ""), 32),
        "uln": "",
        "qualification": "",
        "level": "",
        "start_date": _text(getattr(user, "learner_start_date", "") or getattr(user, "start_date", ""), 32),
        "practical_end_date": _text(getattr(user, "practical_period_end_date", "") or getattr(user, "end_date", ""), 32),
        "apprenticeship_end_date": _text(getattr(user, "apprenticeship_end_date", ""), 32),
        "planned_gateway_date": "",
        "planned_epa_date": "",
        "raw": {
            "source": "enrolment.Created_users",
            "learnerType": _text(getattr(user, "learner_type", ""), 64),
            "email": _text(getattr(user, "email", "")),
            "reference": _text(getattr(user, "reference_number", "")),
            "programme": _text(getattr(user, "programme", "")),
            "cohort": _text(getattr(user, "cohort", "")),
        },
    }


@staff_only()
def deep_dive_records(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        rows = list(DeepDiveRecord.objects.all()[:10000])
        context = _lms_context(row.lms_learner_id for row in rows)
        reviewer_names = _reviewer_names(rows)
    except DatabaseError:
        return JsonResponse({"error": "Deep Dive records could not be loaded."}, status=502)
    return JsonResponse({"count": len(rows), "records": [_serialize(row, context, reviewer_names) for row in rows]})


@csrf_exempt
@staff_only(writes_only=True)
def deep_dive_import(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        payload = _body(request)
        source_file_name = _text(payload.get("sourceFileName"), 255)
        source_file_hash = _text(payload.get("sourceFileHash"), 64)
        records = payload.get("records")
        if not isinstance(records, list) or len(records) > 10000:
            raise ValueError("Deep Dive import must contain between 1 and 10,000 rows.")
        if not records:
            raise ValueError("Deep Dive import contains no learner rows.")
        normalized = []
        for row in records:
            if not isinstance(row, dict):
                continue
            identity = _text(row.get("identityKey"), 255)
            full_name = _text(row.get("fullName"), 511)
            if not identity or not full_name:
                continue
            normalized.append({
                "identityKey": identity, "sourceSheet": _text(row.get("sourceSheet"), 128),
                "sourceRow": row.get("sourceRow"), "firstName": _text(row.get("firstName")),
                "surname": _text(row.get("surname")), "fullName": full_name,
                "dateOfBirth": _text(row.get("dateOfBirth"), 32), "uln": _text(row.get("uln"), 64),
                "qualification": _text(row.get("qualification")), "level": _text(row.get("level"), 64),
                "startDate": _text(row.get("startDate"), 32), "practicalEndDate": _text(row.get("practicalEndDate"), 32),
                "apprenticeshipEndDate": _text(row.get("apprenticeshipEndDate"), 32),
                "plannedGatewayDate": _text(row.get("plannedGatewayDate"), 32), "plannedEpaDate": _text(row.get("plannedEpaDate"), 32),
                "observer": _text(row.get("observer")) or _raw_text(row.get("raw"), "observer", "Observer"),
                "reviewedBy": _text(row.get("reviewedBy")) or _raw_text(row.get("raw"), "reviewedBy", "reviewed by", "Reviewed by", "reviewer"),
                "notes": _text(row.get("notes"), 10000) or _raw_text(row.get("raw"), "notes", "Notes", "note", "Note"),
                "raw": row.get("raw") if isinstance(row.get("raw"), dict) else {},
                "reference": _text(row.get("reference")), "email": _text(row.get("email")),
            })
        if not normalized:
            raise ValueError("Deep Dive import contains no usable learner rows.")
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)

    matches = _lms_matches(normalized)
    actor = _actor(request)
    saved = []
    try:
        with transaction.atomic():
            for row in normalized:
                values = {
                    "source_file_name": source_file_name, "source_file_hash": source_file_hash,
                    "source_sheet": row["sourceSheet"], "source_row": row["sourceRow"],
                    "lms_learner_id": matches.get(row["identityKey"]), "first_name": row["firstName"],
                    "surname": row["surname"], "full_name": row["fullName"], "date_of_birth": row["dateOfBirth"],
                    "uln": row["uln"], "qualification": row["qualification"], "level": row["level"],
                    "start_date": row["startDate"], "practical_end_date": row["practicalEndDate"],
                    "apprenticeship_end_date": row["apprenticeshipEndDate"], "planned_gateway_date": row["plannedGatewayDate"],
                    "planned_epa_date": row["plannedEpaDate"], "raw": row["raw"], "updated_by": actor,
                }
                # A workbook without these optional QMS columns must not erase
                # review ownership that was entered in the detail editor.
                if row["observer"]:
                    values["observer"] = row["observer"]
                if row["reviewedBy"]:
                    values["reviewed_by"] = row["reviewedBy"]
                if row["notes"]:
                    values["notes"] = row["notes"]
                record, created = DeepDiveRecord.objects.update_or_create(identity_key=row["identityKey"], defaults=values)
                if not created:
                    record.version += 1
                    record.save(update_fields=["version", "updated_at", "updated_by", *values.keys()])
                saved.append(record)
    except DatabaseError:
        return JsonResponse({"error": "Deep Dive rows could not be saved."}, status=502)
    context = _lms_context(row.lms_learner_id for row in saved)
    reviewer_names = _reviewer_names(saved)
    return JsonResponse({"count": len(saved), "matched": sum(1 for row in saved if row.lms_learner_id is not None), "records": [_serialize(row, context, reviewer_names) for row in saved]})


@csrf_exempt
@staff_only(writes_only=True)
def deep_dive_sync(request):
    """Add the next 30 Created_users rows once per calendar month.

    This copies existing learner rows into Deep Dive only. It never creates or
    changes an enrolment user, and the identity key makes retries idempotent.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    month_key = timezone.localdate().strftime("%Y-%m")
    try:
        existing_run = DeepDiveSyncRun.objects.filter(month_key=month_key).first()
        if existing_run:
            return JsonResponse({"error": f"Deep Dive sync already ran for {month_key}.", "month": month_key, "added": existing_run.added_count}, status=409)

        from learner_api.models import EnrolmentUser

        learners = list(EnrolmentUser.all_learners.only(
            "id", "learner_type", "username", "email", "reference_number", "date_of_birth",
            "learner_start_date", "learner_end_date", "start_date", "end_date",
            "practical_period_end_date", "apprenticeship_end_date", "programme", "cohort",
        ).order_by("id"))
        existing_ids = {str(value) for value in DeepDiveRecord.objects.filter(lms_learner_id__isnull=False).values_list("lms_learner_id", flat=True)}
        candidates = [learner for learner in learners if str(learner.id) not in existing_ids][:30]
        actor = _actor(request)
        added = []
        with transaction.atomic():
            for learner in candidates:
                values = _created_user_values(learner)
                identity_key = values.pop("identity_key")
                record, created = DeepDiveRecord.objects.update_or_create(identity_key=identity_key, defaults={**values, "updated_by": actor})
                if created:
                    added.append(record)
            run = DeepDiveSyncRun.objects.create(month_key=month_key, added_count=len(added), updated_by=actor)
    except IntegrityError:
        return JsonResponse({"error": f"Deep Dive sync already ran for {month_key}.", "month": month_key}, status=409)
    except DatabaseError:
        return JsonResponse({"error": "Created_users could not be read or Deep Dive rows could not be saved."}, status=502)
    remaining = max(0, len(learners) - len(existing_ids) - len(added))
    context = _lms_context(record.lms_learner_id for record in added)
    reviewer_names = _reviewer_names(added)
    return JsonResponse({"month": month_key, "added": len(added), "remaining": remaining, "records": [_serialize(record, context, reviewer_names) for record in added], "runId": run.id})


@csrf_exempt
@staff_only(writes_only=True)
def deep_dive_record_detail(request, record_id):
    try:
        record = DeepDiveRecord.objects.get(pk=record_id)
    except DeepDiveRecord.DoesNotExist:
        return JsonResponse({"error": "Deep Dive record not found."}, status=404)
    if request.method == "GET":
        context = _lms_context([record.lms_learner_id])
        return JsonResponse({"record": _serialize(record, context, _reviewer_names([record]))})
    if request.method != "PATCH":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        payload = _body(request)
        expected_version = int(payload.get("expectedVersion", record.version))
        if expected_version != record.version:
            return JsonResponse({"error": "This Deep Dive record changed in another window. Reload it before saving."}, status=409)
        if payload.get("markReviewed") is True:
            record.reviewed_by = _actor(request)
            record.reviewed_at = timezone.now()
            record.version += 1
            record.updated_by = record.reviewed_by
            record.save(update_fields=["reviewed_by", "reviewed_at", "version", "updated_by", "updated_at"])
            context = _lms_context([record.lms_learner_id])
            return JsonResponse({"record": _serialize(record, context, _reviewer_names([record]))})
        updates = {
            FIELD_MAP[key]: _text(payload[key], 10000 if key == "notes" else 511 if key == "fullName" else 255)
            for key in EDITABLE_FIELDS
            if key in payload
        }
        if "operational" in payload:
            updates["operational_overrides"] = _operational_overrides(payload["operational"])
        if not updates:
            return JsonResponse({"error": "No editable Deep Dive fields were supplied."}, status=400)
        for attr, value in updates.items():
            setattr(record, attr, value)
        record.version += 1
        record.updated_by = _actor(request)
        record.save(update_fields=[*updates.keys(), "version", "updated_by", "updated_at"])
    except (ValueError, TypeError):
        return JsonResponse({"error": "The edit payload is invalid."}, status=400)
    except DatabaseError:
        return JsonResponse({"error": "Deep Dive record could not be saved."}, status=502)
    context = _lms_context([record.lms_learner_id])
    return JsonResponse({"record": _serialize(record, context, _reviewer_names([record]))})

