"""HTTP endpoints for Progress Review PPTX generation.

    GET  /progress_reviews_api/learners/active
    GET  /progress_reviews_api/<int:learner_id>/periods
    GET  /progress_reviews_api/<int:learner_id>/pack?review_date=YYYY-MM-DD
    POST /progress_reviews_api/<int:learner_id>/generate
    GET  /progress_reviews_api/<str:review_id>/download
    GET  /progress_reviews_api/<str:review_id>/preview   (the deck as a PDF, for the in-page viewer)
    POST /progress_reviews_api/bulk-generate
    GET  /progress_reviews_api/<int:learner_id>/mcm/pack?meeting_date=YYYY-MM-DD
    GET  /progress_reviews_api/<int:learner_id>/mcm/runs/latest?meeting_date=YYYY-MM-DD
    POST /progress_reviews_api/<int:learner_id>/mcm/generate

The mcm/* endpoints produce the Monthly Coaching Meeting deck through the same
pipeline (see mcm.py for how it differs from a Progress Review); its runs are
downloaded through the same /<review_id>/download endpoint.

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
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import (
    auth_gate_enabled, authenticate_request, learner_self_only, learner_self_or_staff, staff_only,
)

from . import edits, mcm, pdf_preview, runs, storage
from .period import ReviewPeriod
from .period import iter_review_periods, resolve_review_period
from .evidence_images import default_image_fetcher
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


def _curriculum_programme_id(source):
    """The learner's curriculum.programmes id, so the Progress Review cadence
    comes from that programme's own Review template rather than the legacy
    12-week constant.

    None when the name does not resolve, or when Curriculum cannot be reached
    at all -- ``_interval`` then falls back exactly as it did before, so a
    lookup problem costs the pack its Curriculum cadence, never the pack.
    """
    try:
        from coach_api.views import resolve_curriculum_programme_id

        return resolve_curriculum_programme_id(getattr(source, "programme", None))
    except Exception:
        logger.warning("Could not resolve the Curriculum programme for a Progress Review pack.", exc_info=True)
        return None


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
    # The learner's OWN date wins. LearnerProfile.start_date is the profile
    # mirror, which active_users.mirror_learner_placement stamps with the
    # COHORT delivery window on every placement edit -- reading it first made
    # a learner who started on the 10th get review periods counted from their
    # cohort's 3rd, while their coach calendar counted from the 10th. Same
    # preference order as coach_api.views.resolve_schedule_window.
    start = _parse_date(getattr(source, "start_date", None)) or _parse_date(getattr(profile, "start_date", None))
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

def _deck_label(review_kind):
    return mcm.REVIEW_LABEL if review_kind == mcm.REVIEW_KIND else "Progress Review"


def _render_deck(pack, review_kind, run_id):
    try:
        if review_kind == mcm.REVIEW_KIND:
            return mcm.generate_mcm_pptx(pack)
        return generate_progress_review_pptx(pack)
    except Exception as exc:
        logger.exception("Progress review PPTX generation failed for run %s", run_id)
        runs.mark_run_failed(run_id, [str(exc)])
        raise GenerationError("PPTX generation failed.", 500) from exc


def _store_deck(
    *, run_id, learner_kind, learner_id, period, pack, review_kind, generated_by,
    pptx_bytes=None, parent_run_id=None, revision_source="generated",
) -> dict:
    """Record one deck version: the run, the pack it came from, the rendered
    (or uploaded) PPTX in blob storage, and its file row. Shared by generate,
    edit and re-upload so every version is stored and audited the same way."""
    runs.create_run(
        run_id=run_id, learner_kind=learner_kind, learner_id=learner_id, period=period,
        generated_by=generated_by, review_kind=review_kind,
        parent_run_id=parent_run_id, revision_source=revision_source,
    )
    runs.insert_snapshot(run_id, pack)
    runs.save_warnings(run_id, pack["source_warnings"])

    if not storage.storage_configured():
        runs.mark_run_failed(run_id, ["PPTX storage is not configured (AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_KEY missing)."])
        raise GenerationError("PPTX storage is not configured.", 503)

    if pptx_bytes is None:
        pptx_bytes = _render_deck(pack, review_kind, run_id)

    learner_slug = _slugify(pack["learner"]["full_name"])
    prefix = "monthly-coaching-meeting" if review_kind == mcm.REVIEW_KIND else "progress-review"
    suffix = "" if revision_source == "generated" else f"-{revision_source}"
    filename = f"{prefix}-{learner_slug}-{period.review_date.isoformat()}{suffix}.pptx"
    blob_name = f"{learner_kind}/{learner_id}/{run_id}/{filename}"

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
        "revisionSource": revision_source,
        "sourceWarnings": pack["source_warnings"],
        "downloadUrl": f"/progress_reviews_api/{run_id}/download/",
    }


def _generate_for_learner(
    learner_id: int, *, review_date=None, generated_by="system", review_kind="progress_review", uploaded_pptx=None,
) -> dict:
    """Build the learner's pack and store a deck for it: rendered from the
    template, or — with `uploaded_pptx` — the owner's own presentation, kept
    alongside the same real-data pack so it can still be edited later."""
    is_mcm = review_kind == mcm.REVIEW_KIND
    start, end, kind, source = _programme_window(learner_id)
    if source is None:
        raise GenerationError(f"No learner found with id {learner_id}.", 404)
    if start is None:
        raise GenerationError("This learner has no programme start date recorded.", 422)

    if is_mcm:
        period = mcm.build_mcm_period(review_date or date.today(), programme_id=_curriculum_programme_id(source))
    else:
        period = resolve_review_period(
            programme_start=start, programme_end=end, today=date.today(), review_date=review_date,
            programme_id=_curriculum_programme_id(source),
        )
    run_id = runs.new_run_id()

    try:
        pack = build_review_pack(learner_id, period, review_id=run_id, generated_by=generated_by)
    except LearnerLookupError as exc:
        raise GenerationError(str(exc), 404) from exc

    if is_mcm:
        mcm.label_pack(pack)

    if not pack["learner"]["active_status"]:
        raise GenerationError(
            f"{_deck_label(review_kind)} PPTX generation is only available for active learners.", 409,
        )

    return _store_deck(
        run_id=run_id, learner_kind=kind, learner_id=learner_id, period=period, pack=pack,
        review_kind=review_kind, generated_by=generated_by, pptx_bytes=uploaded_pptx,
        revision_source="uploaded" if uploaded_pptx is not None else "generated",
    )


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
    results = [
        item.to_dict()
        for item in iter_review_periods(
            start, end, today=date.today(), programme_id=_curriculum_programme_id(source),
        )
    ]
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
    period = resolve_review_period(
        programme_start=start, programme_end=end, today=date.today(), review_date=review_date,
        programme_id=_curriculum_programme_id(source),
    )
    try:
        pack_data = build_review_pack(learner_id, period, generated_by=_current_email(request))
    except LearnerLookupError:
        return _error(f"No learner found with id {learner_id}.", 404)
    return JsonResponse(pack_data)


@learner_self_or_staff(kwarg="learner_id")
def latest_run(request, learner_id):
    """Does a PPTX already exist for this exact review? Backs a review card's
    "Create slides" vs "Slides"/"View slides" button state, and the same
    check when the modal opens — scoped to one review_date so a learner's
    review 2 card can never show review 1's (or vice versa)."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    review_date = _parse_date_param(request.GET.get("review_date"))
    if review_date is None:
        return _error("review_date is required (YYYY-MM-DD).", 400)

    row = runs.get_latest_run_for_period(learner_id, review_date)
    if not row:
        return JsonResponse({"exists": False})
    return JsonResponse({
        "exists": True,
        "reviewId": row["id"],
        "generationStatus": row["generation_status"],
        "generatedAt": row["generated_at"].isoformat() if row["generated_at"] else None,
        "revisionSource": row.get("revision_source") or "generated",
    })


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


STAFF_ROLES = {"staff", "admin", "super-admin", "coach"}


def _is_staff(account):
    return account.role != "learner" and (getattr(account, "is_staff", False) or account.role in STAFF_ROLES)


def _readable_run(request, review_id):
    """(run, None) for a deck the caller may view, else (None, error)."""
    run = runs.get_run(review_id)
    if not run:
        return None, _error("Review not found.", 404)
    account = authenticate_request(request)
    # This view can't use @staff_only() -- a learner is allowed through, just
    # restricted to their own deck below -- so it re-checks the same
    # LEARNER_API_REQUIRE_AUTH toggle staff_only/employer_or_staff honour,
    # rather than hard-requiring a session regardless of that toggle.
    if account is None:
        if auth_gate_enabled():
            return None, _error("Authentication required.", 401)
    else:
        # Staff may download any generated deck; learners may download only
        # their own review deck. The run stores the canonical learner id, so
        # the review id cannot be used to access another learner's PPTX.
        if account.role == "learner" and int(run["learner_id"]) != int(account.subject_id):
            return None, _error("You do not have permission to perform this action.", 403)
        if account.role != "learner" and not _is_staff(account):
            return None, _error("You do not have permission to perform this action.", 403)
    return run, None


def _authorised_pptx_file(request, review_id):
    """(pptx_file, None) for a deck the caller may read, else (None, error)."""
    run, error = _readable_run(request, review_id)
    if error:
        return None, error
    pptx_file = runs.get_pptx_file_for_run(review_id)
    if not pptx_file:
        return None, _error("No PPTX file has been generated for this review yet.", 404)
    if not storage.storage_configured():
        return None, _error("PPTX storage is not configured.", 503)
    return pptx_file, None


def download(request, review_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    pptx_file, error = _authorised_pptx_file(request, review_id)
    if error:
        return error
    url = storage.download_sas_for(pptx_file["container"], pptx_file["blob_name"], pptx_file["original_filename"])
    return JsonResponse({"url": url, "filename": pptx_file["original_filename"]})


def preview(request, review_id):
    """The deck as a PDF for the in-page viewer (see pdf_preview.py), served by
    the app itself so no storage link is ever handed to an outside viewer."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    pptx_file, error = _authorised_pptx_file(request, review_id)
    if error:
        return error
    pdf_blob = f"{pptx_file['blob_name']}.pdf"
    container = pptx_file["container"]
    if storage.blob_exists(container, pdf_blob):
        data = storage.download_bytes(container, pdf_blob)
    else:
        try:
            data = pdf_preview.convert_pptx_to_pdf(storage.download_bytes(container, pptx_file["blob_name"]))
        except pdf_preview.PreviewUnavailable as exc:
            logger.warning("Progress review PDF preview failed for run %s: %s", review_id, exc)
            return _error(str(exc), 503)
        try:
            storage.upload_pdf(io.BytesIO(data), pdf_blob)
        except Exception:
            logger.warning("Could not cache the PDF preview for run %s.", review_id, exc_info=True)
    filename = pptx_file["original_filename"].rsplit(".", 1)[0] + ".pdf"
    response = HttpResponse(data, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{filename}"'
    response["Cache-Control"] = "private, no-store"
    return response


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


# --------------------------------------------------------------------------- #
# Monthly Coaching Meeting decks
# --------------------------------------------------------------------------- #

def _meeting_date(request):
    return _parse_date_param(request.GET.get("meeting_date"))


@learner_self_or_staff(kwarg="learner_id")
def mcm_pack(request, learner_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    meeting_date = _meeting_date(request)
    if meeting_date is None:
        return _error("meeting_date is required (YYYY-MM-DD).", 400)
    start, _end, _kind, source = _programme_window(learner_id)
    if source is None:
        return _error(f"No learner found with id {learner_id}.", 404)
    period = mcm.build_mcm_period(meeting_date, programme_id=_curriculum_programme_id(source))
    try:
        pack_data = build_review_pack(learner_id, period, generated_by=_current_email(request))
    except LearnerLookupError:
        return _error(f"No learner found with id {learner_id}.", 404)
    return JsonResponse(mcm.label_pack(pack_data))


@learner_self_or_staff(kwarg="learner_id")
def mcm_latest_run(request, learner_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    meeting_date = _meeting_date(request)
    if meeting_date is None:
        return _error("meeting_date is required (YYYY-MM-DD).", 400)
    row = runs.get_latest_run_for_period(learner_id, meeting_date, review_kind=mcm.REVIEW_KIND)
    if not row:
        return JsonResponse({"exists": False})
    return JsonResponse({
        "exists": True,
        "reviewId": row["id"],
        "generationStatus": row["generation_status"],
        "generatedAt": row["generated_at"].isoformat() if row["generated_at"] else None,
        "revisionSource": row.get("revision_source") or "generated",
    })


@csrf_exempt
@learner_self_only(kwarg="learner_id")
def mcm_generate(request, learner_id):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    payload = _json_body(request)
    if payload is None:
        return _error("Invalid JSON body.", 400)
    meeting_date = _parse_date_param(payload.get("meeting_date"))
    if meeting_date is None:
        return _error("meeting_date is required (YYYY-MM-DD).", 400)
    try:
        result = _generate_for_learner(
            learner_id, review_date=meeting_date, generated_by=_current_email(request), review_kind=mcm.REVIEW_KIND,
        )
    except GenerationError as exc:
        return _error(exc.message, exc.status)
    return JsonResponse(result, status=201)


# --------------------------------------------------------------------------- #
# editing a deck: corrected fields, replacement photos, or a re-uploaded PPTX
# --------------------------------------------------------------------------- #

MAX_EDIT_IMAGE_BYTES = 10 * 1024 * 1024
MAX_UPLOADED_PPTX_BYTES = 50 * 1024 * 1024


def _editable_run(request, review_id):
    """(run, account_email, None) when the caller owns this deck, else an error.

    Ownership follows who runs the meeting: the learner prepares and presents
    their Monthly Coaching Meeting deck, and the coach owns the Progress
    Review deck. Staff can still view an MCM deck, just not change it.
    """
    run = runs.get_run(review_id)
    if not run:
        return None, None, _error("Review not found.", 404)
    if run["generation_status"] != "completed":
        return None, None, _error("Only a completed deck can be edited.", 409)
    account = authenticate_request(request)
    if account is None:
        if auth_gate_enabled():
            return None, None, _error("Authentication required.", 401)
        return run, "system", None
    if run.get("review_kind") == mcm.REVIEW_KIND:
        if account.role != "learner" or int(run["learner_id"]) != int(account.subject_id):
            return None, None, _error("Only the learner can edit their Monthly Coaching Meeting slides.", 403)
    elif not _is_staff(account):
        return None, None, _error("Only a coach can edit Progress Review slides.", 403)
    return run, (getattr(account, "email", "") or "").strip() or "system", None


def _period_of(run) -> ReviewPeriod:
    return ReviewPeriod(
        review_number=run["review_number"],
        review_date=run["review_date"],
        review_period_start=run["review_period_start"],
        review_period_end=run["review_period_end"],
        action_period_start=run["action_period_start"],
        action_period_end=run["action_period_end"],
    )


def _new_revision(run, pack, *, edited_by, revision_source, pptx_bytes=None):
    run_id = runs.new_run_id()
    pack["review"]["review_id"] = run_id
    pack["review"]["revision"] = {
        "source": revision_source, "parent_run_id": run["id"],
        "by": edited_by, "at": datetime.now().isoformat(timespec="seconds"),
    }
    return _store_deck(
        run_id=run_id, learner_kind=run["learner_kind"], learner_id=int(run["learner_id"]),
        period=_period_of(run), pack=pack, review_kind=run.get("review_kind") or "progress_review",
        generated_by=edited_by, pptx_bytes=pptx_bytes,
        parent_run_id=run["id"], revision_source=revision_source,
    )


@csrf_exempt
def edit(request, review_id):
    """GET the deck's editable fields; POST {"edits": {...}} to render a
    corrected version (a new run — the version it revises is kept)."""
    if request.method not in ("GET", "POST"):
        return _error("Method not allowed.", 405)
    run, edited_by, error = _editable_run(request, review_id)
    if error:
        return error
    snapshot = runs.get_snapshot(review_id)
    if not snapshot:
        return _error("This deck has no stored data to edit.", 404)
    review_kind = run.get("review_kind") or "progress_review"

    if request.method == "GET":
        return JsonResponse({
            **edits.editable_view(snapshot, review_kind=review_kind),
            "revisionSource": run.get("revision_source") or "generated",
        })

    payload = _json_body(request)
    if payload is None or not isinstance(payload.get("edits"), dict):
        return _error("Send the corrected fields as {\"edits\": {...}}.", 400)
    try:
        pack = edits.apply_edits(snapshot, payload["edits"], review_kind=review_kind, learner_id=run["learner_id"])
    except edits.EditError as exc:
        return _error(str(exc), 400)
    try:
        result = _new_revision(run, pack, edited_by=edited_by, revision_source="edited")
    except GenerationError as exc:
        return _error(exc.message, exc.status)
    return JsonResponse(result, status=201)


@csrf_exempt
def edit_image(request, review_id):
    """POST an image for one of the deck's photo frames; returns the reference
    to put in that evidence item's image_ref. GET ?ref= streams a photo the
    editor shows (one of this deck's own, or one uploaded for this learner)."""
    if request.method == "GET":
        run, error = _readable_run(request, review_id)
        if error:
            return error
        ref = request.GET.get("ref") or ""
        snapshot = runs.get_snapshot(review_id) or {}
        own = {
            item.get("image_or_screenshot_link")
            for key in ("evidence", "assignments", "workplace_activities")
            for item in snapshot.get(key) or []
        }
        blob = edits.parse_blob_image_ref(ref)
        if not blob or (ref not in own and not blob[1].startswith(edits.upload_prefix(run["learner_id"]))):
            return _error("Image not found.", 404)
        data = default_image_fetcher(ref)
        if data is None:
            return _error("Image not found.", 404)
        response = HttpResponse(data, content_type=_image_content_type(data))
        response["Cache-Control"] = "private, max-age=300"
        return response

    if request.method != "POST":
        return _error("Method not allowed.", 405)
    run, _edited_by, error = _editable_run(request, review_id)
    if error:
        return error
    upload = request.FILES.get("image")
    if upload is None:
        return _error("Choose an image to upload.", 400)
    if upload.size > MAX_EDIT_IMAGE_BYTES:
        return _error("Images must be 10 MB or smaller.", 400)
    jpeg = _normalised_jpeg(upload.read())
    if jpeg is None:
        return _error("Upload a JPEG, PNG or WebP image.", 400)
    blob_name = f"{edits.upload_prefix(run['learner_id'])}{runs.new_run_id()}.jpg"
    try:
        storage.upload_image(io.BytesIO(jpeg), blob_name)
    except Exception:
        logger.exception("Could not store an edit image for run %s", review_id)
        return _error("The image could not be stored.", 502)
    return JsonResponse({"imageRef": edits.blob_image_ref(settings.AZURE_PROGRESS_REVIEW_CONTAINER, blob_name)}, status=201)


@csrf_exempt
def upload_revision(request, review_id):
    """POST a .pptx the owner edited in PowerPoint; it becomes the deck's newest
    version (a new run — the version it revises is kept)."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    run, edited_by, error = _editable_run(request, review_id)
    if error:
        return error
    data, error = _uploaded_pptx(request)
    if error:
        return error
    snapshot = runs.get_snapshot(review_id)
    if not snapshot:
        return _error("This deck has no stored data to revise.", 404)
    try:
        result = _new_revision(run, snapshot, edited_by=edited_by, revision_source="uploaded", pptx_bytes=data)
    except GenerationError as exc:
        return _error(exc.message, exc.status)
    return JsonResponse(result, status=201)


def _normalised_jpeg(data: bytes):
    """The upload re-encoded as a JPEG (orientation applied, metadata such as
    GPS location dropped), or None when it is not an image."""
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in {"JPEG", "PNG", "WEBP"}:
                return None
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        return None
    image.thumbnail((2400, 2400))
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88)
    return out.getvalue()


def _image_content_type(data: bytes) -> str:
    return "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"


def _is_pptx(data: bytes) -> bool:
    from pptx import Presentation

    try:
        return len(Presentation(io.BytesIO(data)).slides) > 0
    except Exception:
        return False


def _uploaded_pptx(request):
    """(bytes, None) for a valid uploaded .pptx in request.FILES["file"], else (None, error)."""
    upload = request.FILES.get("file")
    if upload is None:
        return None, _error("Choose a .pptx file to upload.", 400)
    if upload.size > MAX_UPLOADED_PPTX_BYTES:
        return None, _error("The presentation must be 50 MB or smaller.", 400)
    data = upload.read()
    if not _is_pptx(data):
        return None, _error("That file is not a PowerPoint (.pptx) presentation.", 400)
    return data, None


def _upload_own(request, learner_id, *, date_field, review_kind):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    data, error = _uploaded_pptx(request)
    if error:
        return error
    meeting_date = _parse_date_param(request.POST.get(date_field))
    if meeting_date is None:
        return _error(f"{date_field} is required (YYYY-MM-DD).", 400)
    try:
        result = _generate_for_learner(
            learner_id, review_date=meeting_date, generated_by=_current_email(request),
            review_kind=review_kind, uploaded_pptx=data,
        )
    except GenerationError as exc:
        return _error(exc.message, exc.status)
    return JsonResponse(result, status=201)


@csrf_exempt
@staff_only()
def upload_own(request, learner_id):
    """POST multipart {file, review_date}: the coach's own Progress Review deck
    instead of a generated one."""
    return _upload_own(request, learner_id, date_field="review_date", review_kind="progress_review")


@csrf_exempt
@learner_self_only(kwarg="learner_id")
def mcm_upload_own(request, learner_id):
    """POST multipart {file, meeting_date}: the learner's own MCM deck instead
    of a generated one."""
    return _upload_own(request, learner_id, date_field="meeting_date", review_kind=mcm.REVIEW_KIND)
