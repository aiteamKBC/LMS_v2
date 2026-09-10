"""Read-only learner access to reviews imported into the Learner schema."""

import json
from datetime import date, datetime

from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import learner_self_or_staff

from .learner_detail import SOURCE_MODELS
from .mappers import _s


REVIEW_TYPES = {
    "monthly-coaching": ("Monthly Coaching Meeting",),
    "progress-review": ("Progress Review", "Progress Review (+ Skills Radar)"),
}


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _normalise_status(value):
    return _s(value).strip().lower().replace(" ", "-") or "unknown"


def _json_value(value, expected_type, fallback):
    if isinstance(value, expected_type):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return fallback
        return decoded if isinstance(decoded, expected_type) else fallback
    return fallback


def _parse_imported_datetime(value):
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    text = _s(value).strip()
    if not text:
        return None
    for pattern in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d %b %Y at %H:%M",
        "%d %B %Y at %H:%M",
        "%d %b %Y",
        "%d %B %Y",
    ):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


def _iso_date(value):
    parsed = _parse_imported_datetime(value)
    return parsed.date().isoformat() if parsed else None


def _iso_time(value):
    parsed = _parse_imported_datetime(value)
    return parsed.strftime("%H:%M") if parsed and parsed.hour + parsed.minute else None


def _learner_profile_id(cursor, source, kind):
    cursor.execute(
        '''
        SELECT id
        FROM "Learner".learners
        WHERE enrolment_id = %s AND lower(COALESCE(learner_type, '')) = lower(%s)
        ORDER BY id
        LIMIT 1
        ''',
        [source.pk, kind],
    )
    row = cursor.fetchone()
    if row:
        return row[0]

    email = _s(getattr(source, "email", "")).strip().casefold()
    if not email:
        return None
    cursor.execute(
        '''
        SELECT id
        FROM "Learner".learners
        WHERE email_normalized = %s OR lower(COALESCE(email, '')) = %s
        ORDER BY CASE WHEN enrolment_id = %s THEN 0 ELSE 1 END, id
        LIMIT 2
        ''',
        [email, email, source.pk],
    )
    matches = cursor.fetchall()
    return matches[0][0] if len(matches) == 1 else None


def _review_rows(cursor, learner_id, review_types):
    cursor.execute(
        '''
        SELECT id, aptem_review_id, review_name, review_type, reviewer_name,
               planned_scheduled_date, completed_date, status, review_data,
               extraction_status, last_error
        FROM "Learner".reviews
        WHERE learner_id = %s AND review_type = ANY(%s)
        ORDER BY COALESCE(completed_date, planned_scheduled_date) DESC NULLS LAST, id DESC
        ''',
        [learner_id, list(review_types)],
    )
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _sections_by_review(cursor, review_ids):
    if not review_ids:
        return {}
    cursor.execute(
        '''
        SELECT id, review_id, section_name, section_order, fields_json, tables_json, raw_text
        FROM "Learner".review_sections
        WHERE review_id = ANY(%s)
        ORDER BY review_id, section_order, id
        ''',
        [review_ids],
    )
    sections = {}
    for section_id, review_id, name, order, fields, tables, raw_text in cursor.fetchall():
        sections.setdefault(review_id, []).append({
            "id": section_id,
            "name": _s(name) or "Review section",
            "order": order,
            "fields": _json_value(fields, list, []),
            "tables": _json_value(tables, list, []),
            "rawText": _s(raw_text),
        })
    return sections


def _serialize_review(row, sections):
    data = _json_value(row.get("review_data"), dict, {})
    metadata = _json_value(data.get("source_metadata"), dict, {})
    planned_raw = row.get("planned_scheduled_date") or metadata.get("Planned / Scheduled Date")
    completed_raw = row.get("completed_date") or metadata.get("Completed Date")
    review_sections = sections.get(row["id"], [])
    return {
        "id": str(row["id"]),
        "aptemReviewId": _s(row.get("aptem_review_id")),
        "name": _s(row.get("review_name")) or _s(row.get("review_type")) or "Review",
        "type": _s(row.get("review_type")),
        "reviewerName": _s(row.get("reviewer_name")) or _s(metadata.get("Reviewer")),
        "plannedDate": _iso_date(planned_raw),
        "plannedTime": _iso_time(planned_raw),
        "completedDate": _iso_date(completed_raw),
        "status": _normalise_status(row.get("status") or metadata.get("Status")),
        "extractionStatus": _s(row.get("extraction_status")) or "partial",
        "detailsAvailable": bool(review_sections),
        "sections": review_sections,
    }


@require_GET
@learner_self_or_staff(kwarg="pk")
def learner_review_history(request, kind, pk):
    category = _s(request.GET.get("category"))
    review_types = REVIEW_TYPES.get(category)
    if not review_types:
        return _error("Unknown review category.", 400)
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Learner not found.", 404)
    try:
        source = model.all_learners.only("id", "email").filter(pk=pk).first()
        if source is None:
            return _error("Learner not found.", 404)
        with connection.cursor() as cursor:
            learner_id = _learner_profile_id(cursor, source, kind)
            if learner_id is None:
                return JsonResponse({"learnerId": None, "category": category, "reviews": []})
            rows = _review_rows(cursor, learner_id, review_types)
            sections = _sections_by_review(cursor, [row["id"] for row in rows])
    except DatabaseError:
        return _error("Could not load review history.", 503)
    serialized = [_serialize_review(row, sections) for row in rows]
    serialized.sort(
        key=lambda item: (
            item["completedDate"] or item["plannedDate"] or "",
            item["plannedTime"] or "",
            int(item["id"]),
        ),
        reverse=True,
    )
    return JsonResponse({
        "learnerId": learner_id,
        "category": category,
        "reviews": serialized,
    })
