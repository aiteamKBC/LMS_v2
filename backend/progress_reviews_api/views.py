"""HTTP endpoints for Progress Review PPTX generation.

    GET  /api/progress-reviews/learners/active
    GET  /api/progress-reviews/<int:learner_id>/periods
    GET  /api/progress-reviews/<int:learner_id>/pack?review_date=YYYY-MM-DD
    POST /api/progress-reviews/<int:learner_id>/generate
    GET  /api/progress-reviews/<str:review_id>/download
    POST /api/progress-reviews/bulk-generate

This is a coach/admin workspace tool: generate/bulk-generate/download are
staff-only (login.permissions.staff_only), the same boundary the rest of the
console already draws. Preview (periods/pack) additionally admits the learner
themselves, matching how the existing calendar review endpoints are scoped
(learner_self_or_staff), so a learner can see their own upcoming review.
"""
import io
import json
import logging
from datetime import date, datetime

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import learner_self_or_staff, staff_only

from . import runs, storage
from .period import iter_review_periods, resolve_review_period
from .pptx_generator import generate_progress_review_pptx
from .review_pack import LearnerLookupError, _parse_date, build_review_pack

logger = logging.getLogger(__name__)


class GenerationError(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _json_body(request):
    if not request.body:
        return {}
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _parse_date_param(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        return None


def _current_email(request):
    account = getattr(request, "login_account", None)
    return (getattr(account, "email", "") or "").strip() or "system"


def _slugify(value: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in (value or "")).strip("-").lower()
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "learner"


def _programme_window(learner_id):
    """(start, end, kind, source) for one learner_id, resolved the same way
    review_pack does — LearnerProfile's real DateFields first, falling back to
    EnrolmentUser's text-typed dates. Returns (None, None, None, None) if the
    id does not resolve to any learner."""
    from learner_api.identity import learner_profile_for_source
    from learner_api.models import EnrolmentUser

    try:
        source = EnrolmentUser.all_learners.get(pk=learner_id)
    except EnrolmentUser.DoesNotExist:
        return None, None, None, None

    profile = learner_profile_for_source(source, source_pk=learner_id)
    start = _parse_date(getattr(profile, "start_date", None)) or _parse_date(getattr(source, "start_date", None))
    end = (
        _parse_date(getattr(profile, "end_date", None))
        or _parse_date(getattr(source, "end_date", None))
        or _parse_date(getattr(source, "apprenticeship_end_date", None))
        or _parse_date(getattr(source, "practical_period_end_date", None))
    )
    kind = "commercial" if str(getattr(source, "learner_type", "")).strip().lower() == "commercial" else "apprenticeship"
    return start, end, kind, source


# --------------------------------------------------------------------------- #
# generation pipeline — shared by /generate and /bulk-generate
# --------------------------------------------------------------------------- #

def _generate_for_learner(learner_id: int, *, review_date=None, generated_by="system") -> dict:
    start, end, kind, source = _programme_window(learner_id)
    if source is None:
        raise GenerationError(f"No learner found with id {learner_id}.", 404)
    if start is None:
        raise GenerationError("This learner has no programme start date recorded.", 422)

    period = resolve_review_period(programme_start=start, programme_end=end, today=date.today(), review_date=review_date)
    run_id = runs.new_run_id()

    try:
        pack = build_review_pack(learner_id, period, review_id=run_id, generated_by=generated_by)
    except LearnerLookupError as exc:
        raise GenerationError(str(exc), 404) from exc

    if not pack["learner"]["active_status"]:
        raise GenerationError(
            "Progress Review PPTX generation is only available for active learners.", 409,
        )

    runs.create_run(run_id=run_id, learner_kind=kind, learner_id=learner_id, period=period, generated_by=generated_by)
    runs.insert_snapshot(run_id, pack)
    runs.save_warnings(run_id, pack["source_warnings"])

    if not storage.storage_configured():
        runs.mark_run_failed(run_id, ["PPTX storage is not configured (AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_KEY missing)."])
        raise GenerationError("PPTX storage is not configured.", 503)

    try:
        pptx_bytes = generate_progress_review_pptx(pack)
    except Exception as exc:
        logger.exception("Progress review PPTX generation failed for run %s", run_id)
        runs.mark_run_failed(run_id, [str(exc)])
        raise GenerationError("PPTX generation failed.", 500) from exc

    learner_slug = _slugify(pack["learner"]["full_name"])
    filename = f"progress-review-{learner_slug}-{period.review_date.isoformat()}.pptx"
    blob_name = f"{kind}/{learner_id}/{run_id}/{filename}"

    try:
        storage.upload_pptx(io.BytesIO(pptx_bytes), blob_name)
    except Exception as exc:
        logger.exception("Progress review PPTX upload failed for run %s", run_id)
        runs.mark_run_failed(run_id, [f"Upload failed: {exc}"])
        raise GenerationError("PPTX was generated but could not be stored.", 502) from exc

    runs.insert_pptx_file(
        run_id,
        container=settings.AZURE_PROGRESS_REVIEW_CONTAINER,
        blob_name=blob_name,
        original_filename=filename,
        size_bytes=len(pptx_bytes),
        generated_by=generated_by,
    )
    runs.mark_run_completed(run_id)

    return {
        "reviewId": run_id,
        "learnerId": learner_id,
        "reviewNumber": period.review_number,
        "reviewDate": period.review_date.isoformat(),
        "reviewPeriodStart": period.review_period_start.isoformat(),
        "reviewPeriodEnd": period.review_period_end.isoformat(),
        "generationStatus": "completed",
        "sourceWarnings": pack["source_warnings"],
        "downloadUrl": f"/api/progress-reviews/{run_id}/download/",
    }


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #

@staff_only()
def active_learners(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    from learner_api.models import LearnerProfile

    rows = (
        LearnerProfile.objects.filter(lifecycle_status="active")
        .only("id", "enrolment_id", "full_name", "email", "programme", "coach_name", "cohort", "group_name", "start_date", "end_date")
        .order_by("full_name")
    )
    results = []
    for row in rows:
        name = (row.full_name or "").strip()
        if not name or not row.enrolment_id:
            continue
        results.append({
            "learnerId": row.enrolment_id,
            "fullName": name,
            "email": row.email,
            "programme": row.programme,
            "coach": row.coach_name,
            "cohort": row.cohort,
            "group": row.group_name,
            "startDate": row.start_date.isoformat() if row.start_date else None,
            "endDate": row.end_date.isoformat() if row.end_date else None,
        })
    return JsonResponse({"results": results})


@learner_self_or_staff(kwarg="learner_id")
def periods(request, learner_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    start, end, _kind, source = _programme_window(learner_id)
    if source is None:
        return _error(f"No learner found with id {learner_id}.", 404)
    if start is None:
        return _error("This learner has no programme start date recorded.", 422)
    results = [item.to_dict() for item in iter_review_periods(start, end, today=date.today())]
    return JsonResponse({"results": results})


@learner_self_or_staff(kwarg="learner_id")
def pack(request, learner_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    start, end, _kind, source = _programme_window(learner_id)
    if source is None:
        return _error(f"No learner found with id {learner_id}.", 404)
    if start is None:
        return _error("This learner has no programme start date recorded.", 422)

    review_date = _parse_date_param(request.GET.get("review_date"))
    period = resolve_review_period(programme_start=start, programme_end=end, today=date.today(), review_date=review_date)
    try:
        pack_data = build_review_pack(learner_id, period, generated_by=_current_email(request))
    except LearnerLookupError:
        return _error(f"No learner found with id {learner_id}.", 404)
    return JsonResponse(pack_data)


@csrf_exempt
@staff_only()
def generate(request, learner_id):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    payload = _json_body(request)
    if payload is None:
        return _error("Invalid JSON body.", 400)

    review_date = _parse_date_param(payload.get("review_date"))
    try:
        result = _generate_for_learner(learner_id, review_date=review_date, generated_by=_current_email(request))
    except GenerationError as exc:
        return _error(exc.message, exc.status)
    return JsonResponse(result, status=201)


@staff_only()
def download(request, review_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    run = runs.get_run(review_id)
    if not run:
        return _error("Review not found.", 404)
    pptx_file = runs.get_pptx_file_for_run(review_id)
    if not pptx_file:
        return _error("No PPTX file has been generated for this review yet.", 404)
    if not storage.storage_configured():
        return _error("PPTX storage is not configured.", 503)
    url = storage.download_sas_for(pptx_file["container"], pptx_file["blob_name"], pptx_file["original_filename"])
    return JsonResponse({"url": url, "filename": pptx_file["original_filename"]})


@csrf_exempt
@staff_only()
def bulk_generate(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    payload = _json_body(request)
    if payload is None:
        return _error("Invalid JSON body.", 400)

    learner_ids = payload.get("learner_ids")
    if learner_ids:
        try:
            ids = [int(value) for value in learner_ids]
        except (TypeError, ValueError):
            return _error("learner_ids must be a list of integers.", 400)
    else:
        from learner_api.models import LearnerProfile

        ids = list(
            LearnerProfile.objects.filter(lifecycle_status="active")
            .exclude(enrolment_id__isnull=True)
            .values_list("enrolment_id", flat=True)
        )

    review_date = _parse_date_param(payload.get("review_date"))
    generated_by = _current_email(request)
    results = []
    for learner_id in ids:
        try:
            results.append(_generate_for_learner(learner_id, review_date=review_date, generated_by=generated_by))
        except GenerationError as exc:
            results.append({"learnerId": learner_id, "generationStatus": "failed", "error": exc.message})
        except Exception:  # one learner's failure must never sink the batch
            logger.exception("Bulk progress review generation crashed for learner %s", learner_id)
            results.append({"learnerId": learner_id, "generationStatus": "failed", "error": "Unexpected error."})

    return JsonResponse({"results": results})
