"""The public apprenticeship eligibility form.

    POST /enrolment_api/public/apprenticeship-application/  -> 201 {"submitted": true}

Filled in at /apprenticeship_application by people who have no LMS account yet,
so neither the page nor this endpoint needs a sign-in. The client sends no
cookies (``credentials: 'omit'``); the view still requires
``X-Requested-With: XMLHttpRequest``, the CSRF defence every other public JSON
endpoint here uses (see login/views.py).

Storage
-------
One row per submitted application in enrolment.eligibility_form. Nothing is
saved before the applicant presses Submit (there is no draft), and nothing here
updates or deletes a row. The form collects answers only: staff assess
eligibility themselves, so no funding rule is applied on the way in.

The table is created by ``manage.py apply_eligibility_form_table``. This view
never runs DDL, since anyone on the internet can call it; if the table is
missing it says the form is unavailable rather than pretending to save.

Choice answers are stored as their labels, the way the enrolment wizard stores
``Employment_status``, so the table reads plainly when queried.
"""
import json
import logging
from datetime import date

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

logger = logging.getLogger(__name__)

CONN = "enrolment"
TABLE = "eligibility_form"

#: The whole form is well under 4 KB; this only stops a runaway payload.
MAX_BODY_BYTES = 32 * 1024

EMPLOYMENT_STATUSES = (
    "In paid employment",
    "Self employment",
    "Not in paid employment, looking for work and available to start work",
    "Not in paid employment, not looking for work and/or not available to start work",
)

RESIDENCY_STATUSES = (
    "UK Citizen",
    "Settled Status",
    "Pre-settled Status",
    "Skilled Worker Visa",
    "Study or Graduate Visa",
    "Other",
)

PROGRAMMES = (
    "Marketing Executive Level 4",
    "Marketing Manager Level 6",
    "Associate Project Manager Level 4",
    "Project Controls Professional Level 6",
)

# (payload key, column, kind, required, limit-or-choices). Order is the form's.
FIELDS = (
    # Personal Details
    ("firstName", "first_name", "text", True, 100),
    ("surname", "surname", "text", True, 100),
    ("workEmail", "work_email", "email", True, 254),
    ("phoneNumber", "phone_number", "text", False, 40),
    ("fullAddress", "full_address", "text", True, 500),
    ("postcode", "postcode", "text", True, 12),
    ("dateOfBirth", "date_of_birth", "date", True, None),
    # Employment
    ("employmentStatus", "employment_status", "choice", True, EMPLOYMENT_STATUSES),
    ("majorityHoursInEngland", "majority_hours_in_england", "bool", True, None),
    ("employerName", "employer_name", "text", True, 200),
    ("employerAddress", "employer_address", "text", True, 500),
    ("employerPostcode", "employer_postcode", "text", True, 12),
    ("representativeName", "representative_name", "text", True, 200),
    ("representativeEmail", "representative_email", "email", True, 254),
    # Residency
    ("livesInUk", "lives_in_uk", "bool", True, None),
    ("residenceNotForEducation", "residence_not_for_education", "bool", True, None),
    ("residencyStatus", "residency_status", "choice", True, RESIDENCY_STATUSES),
    # Programme Suitability
    ("programme", "programme", "choice", True, PROGRAMMES),
    ("attendedFundedTraining", "attended_funded_training", "bool", True, None),
    # Required only when attendedFundedTraining is true (see clean_application).
    ("fundedTrainingCompletedOn", "funded_training_completed_on", "date", False, None),
    ("notPreviouslyCompletedProgramme", "not_previously_completed_programme", "bool", True, None),
)

COLUMNS = tuple(column for _key, column, *_rest in FIELDS)

REQUIRED = "This field is required."
EARLIEST_DATE = date(1900, 1, 1)


def ensure_table(cursor):
    """Create enrolment.eligibility_form if it does not exist. Never alters it."""
    cursor.execute("CREATE SCHEMA IF NOT EXISTS enrolment")
    cursor.execute(
        f"""CREATE TABLE IF NOT EXISTS enrolment.{TABLE} (
            id                                bigserial PRIMARY KEY,
            first_name                        text NOT NULL,
            surname                           text NOT NULL,
            work_email                        text NOT NULL,
            phone_number                      text,
            full_address                      text NOT NULL,
            postcode                          text NOT NULL,
            date_of_birth                     date NOT NULL,
            employment_status                 text NOT NULL,
            majority_hours_in_england         boolean NOT NULL,
            employer_name                     text NOT NULL,
            employer_address                  text NOT NULL,
            employer_postcode                 text NOT NULL,
            representative_name               text NOT NULL,
            representative_email              text NOT NULL,
            lives_in_uk                       boolean NOT NULL,
            residence_not_for_education       boolean NOT NULL,
            residency_status                  text NOT NULL,
            programme                         text NOT NULL,
            attended_funded_training          boolean NOT NULL,
            funded_training_completed_on      date,
            not_previously_completed_programme boolean NOT NULL,
            submitted_at                      timestamptz NOT NULL DEFAULT now()
        )"""
    )


def _clean_text(value, limit):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Enter text.")
    # Single-line inputs: collapse pasted line breaks and runs of spaces.
    cleaned = " ".join(value.split())
    if len(cleaned) > limit:
        raise ValueError(f"Use {limit} characters or fewer.")
    return cleaned or None


def _clean_date(value, today):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("Enter a valid date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError("Enter a valid date.") from None
    if parsed > today:
        raise ValueError("The date cannot be in the future.")
    if parsed < EARLIEST_DATE:
        raise ValueError("Enter a valid date.")
    return parsed


def _clean_field(kind, value, limit, today):
    if kind == "bool":
        if value is None:
            return None
        if not isinstance(value, bool):
            raise ValueError("Choose Yes or No.")
        return value
    if kind == "date":
        return _clean_date(value, today)
    if kind == "choice":
        if value in (None, ""):
            return None
        if value not in limit:
            raise ValueError("Choose one of the listed options.")
        return value
    cleaned = _clean_text(value, limit)
    if kind == "email" and cleaned is not None:
        try:
            validate_email(cleaned)
        except ValidationError:
            raise ValueError("Enter a valid email address.") from None
    return cleaned


def clean_application(payload, today=None):
    """Validate a submission. Returns (row, errors) keyed by column / payload key.

    Keys outside FIELDS are ignored, so the client cannot choose a column.
    """
    today = today or timezone.localdate()
    row, errors = {}, {}
    for key, column, kind, required, limit in FIELDS:
        try:
            value = _clean_field(kind, payload.get(key), limit, today)
        except ValueError as exc:
            errors[key] = str(exc)
            continue
        if value is None and required:
            errors[key] = REQUIRED
        row[column] = value

    # "When was it completed?" is only asked after a Yes.
    if row.get("attended_funded_training") is True:
        if row.get("funded_training_completed_on") is None and "fundedTrainingCompletedOn" not in errors:
            errors["fundedTrainingCompletedOn"] = REQUIRED
    else:
        errors.pop("fundedTrainingCompletedOn", None)
        row["funded_training_completed_on"] = None
    return row, errors


def _error(message, status, **extra):
    return JsonResponse({"error": message, **extra}, status=status)


@csrf_exempt
def submit_application(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    if request.headers.get("X-Requested-With") != "XMLHttpRequest":
        return _error("Missing X-Requested-With header.", 403)
    if len(request.body or b"") > MAX_BODY_BYTES:
        return _error("The application is too large.", 413)
    try:
        payload = json.loads(request.body or b"{}")
    except (ValueError, UnicodeDecodeError):
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    row, errors = clean_application(payload)
    if errors:
        return _error("Please correct the highlighted answers.", 400, fields=errors)

    placeholders = ", ".join(["%s"] * len(COLUMNS))
    try:
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                f"INSERT INTO enrolment.{TABLE} ({', '.join(COLUMNS)}) VALUES ({placeholders}) RETURNING id",
                [row[column] for column in COLUMNS],
            )
            application_id = cursor.fetchone()[0]
    except DatabaseError:
        # Never echo the database error to an anonymous caller.
        logger.exception("Could not save an apprenticeship eligibility application")
        return _error("We could not save your application just now. Please try again in a few minutes.", 503)

    logger.info("Apprenticeship eligibility application %s received", application_id)
    return JsonResponse({"submitted": True}, status=201)
