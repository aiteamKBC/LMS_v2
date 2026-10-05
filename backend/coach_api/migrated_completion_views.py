"""Dedicated lifecycle endpoints for Aptem migrated reviews."""
import json

from django.db import connections, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from coach_api.auth import authenticated_coach_email, coach_access_required
from coach_api.migrated_completion import complete, ensure_document, required_roles, sign, submit
from coach_api.migrated_review_pdf import stored_pdf_response
from coach_api.migrated_reviews import review_family
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewDocument
from coach_api.migrated_summary_binding import AnswerConflict, check_answer_version, record_answer_edit
from coach_api.migrated_template_sync import TemplateSyncConflict, active_answers, synchronize_definition_locked
from learner_api.models import EnrolmentUser, LearnerProfile
from login.permissions import authenticate_request


def _payload(request):
    try:
        value = json.loads(request.body or b"{}")
    except (UnicodeDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _coach_review(request, review_id, *, pdf_only=False):
    from coach_api.views import _imported_review_definition
    if not review_id.startswith("imported-review:"):
        return None, None
    owner = authenticated_coach_email(request).strip().casefold()
    definition = _imported_review_definition(owner, review_id, **({"pdf_only": True} if pdf_only else {}))
    return owner, definition if definition and definition.get("migratedForm") else None


def _locked_overlay(owner, definition):
    from coach_api.views import _owned_migrated_overlay
    return _owned_migrated_overlay(owner, definition, lock=True)


def _response(owner, review_id):
    from coach_api.views import _imported_review_definition
    return JsonResponse(_imported_review_definition(owner, review_id))


def _mirror_status(overlay):
    """Mirror LMS local status on only this review's existing calendar row."""
    update = {"status": overlay.status}
    if overlay.status == ImportedReviewInstance.STATUS_COMPLETED:
        update["review_completed_at"] = overlay.completed_at
    from coach_api.views import imported_review_calendar_rows
    rows = imported_review_calendar_rows(overlay.owner_email, overlay.event_key, lock=True)
    if len(rows) != 1:
        return
    calendar = CoachCalendarEvent.objects.filter(
        pk=rows[0].pk, owner_email__iexact=overlay.owner_email,
        learner_id=overlay.learner_id,
    ).filter(
        Q(review_instance_id__isnull=True) | Q(review_instance_id=""),
        Q(review_template_id__isnull=True) | Q(review_template_id=""),
    )
    calendar.update(**update)


@coach_access_required
@require_POST
def migrated_review_submit(request, review_id):
    owner, definition = _coach_review(request, review_id)
    if not definition or definition.get("readOnly"):
        return JsonResponse({"detail": "Migrated review is unavailable or read-only."}, status=409)
    payload = _payload(request)
    if payload is None or ("answers" in payload and not isinstance(payload["answers"], dict)):
        return JsonResponse({"detail": "answers must be an object."}, status=400)
    with transaction.atomic():
        overlay = _locked_overlay(owner, definition)
        if not overlay:
            return JsonResponse({"detail": "Migrated review association mismatch."}, status=409)
        try:
            check_answer_version(overlay, payload)
            if synchronize_definition_locked(overlay, definition):
                return JsonResponse({"detail": "The review template changed. Reopen the review and check its latest questions before submitting. Your saved answers are unchanged.", "code": "template_sync_changed"}, status=409)
            answers = payload.get("answers", active_answers(overlay.template_snapshot, overlay.answers))
            record_answer_edit(overlay, answers, actor=owner,
                               edited_fields=payload.get("editedFields") if isinstance(payload.get("editedFields"), list) else ())
            submit(overlay, answers)
        except TemplateSyncConflict as exc:
            return JsonResponse({"detail": str(exc), "templateSync": exc.response()}, status=409)
        except AnswerConflict as exc:
            return JsonResponse({"detail": str(exc), "code": "ANSWER_CONFLICT"}, status=409)
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=400)
        overlay.save(update_fields=["meeting_intelligence"])
        _mirror_status(overlay)
    return _response(owner, review_id)


@coach_access_required
@require_POST
def migrated_review_coach_sign(request, review_id):
    owner, definition = _coach_review(request, review_id)
    if not definition:
        return JsonResponse({"detail": "Migrated review not found."}, status=404)
    account = request.login_account
    if account.role != "staff" or account.email.strip().casefold() != owner:
        return JsonResponse({"detail": "Only the assigned coach can sign."}, status=403)
    payload = _payload(request)
    if payload is None:
        return JsonResponse({"detail": "Invalid JSON object."}, status=400)
    with transaction.atomic():
        overlay = _locked_overlay(owner, definition)
        if not overlay:
            return JsonResponse({"detail": "Migrated review association mismatch."}, status=409)
        try:
            sign(overlay, "advisor", account=account, signature=payload.get("signature"))
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=409)
    return _response(owner, review_id)


def _party_overlay(review_id, account, *, lock=False):
    if not review_id.startswith("imported-review:") or account.role not in {"learner", "employer"}:
        return None
    # The template FK is nullable. Locking a row through select_related would
    # include an outer join, which PostgreSQL cannot lock with FOR UPDATE.
    query = ImportedReviewInstance.objects
    if lock:
        query = query.select_for_update()
    overlay = query.filter(event_key=review_id, source_review_id__isnull=False).first()
    if not overlay or not overlay.template_snapshot.get("sections"):
        return None
    profile = LearnerProfile.objects.filter(pk=overlay.learner_id).first()
    learner = EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first() if profile and profile.enrolment_id else None
    if not learner:
        return None
    if account.role == "learner" and account.subject_id != learner.pk:
        return None
    if account.role == "employer" and account.subject_id != learner.employer_id:
        return None
    from coach_api.views import get_learner_db_alias
    with connections[get_learner_db_alias()].cursor() as cursor:
        cursor.execute('SELECT status, completed_date FROM "Learner".reviews WHERE id = %s', [overlay.source_review_id])
        source = cursor.fetchone()
    if not source or str(source[0] or "").strip().casefold() == "completed" or source[1]:
        return None
    return overlay


@ensure_csrf_cookie
@require_GET
def migrated_review_party_csrf(request):
    if authenticate_request(request) is None:
        return JsonResponse({"detail": "Sign in to use this action."}, status=401)
    return JsonResponse({"csrfToken": get_token(request)})


@require_GET
def migrated_review_party_detail(request, review_id):
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to view this review."}, status=401)
    overlay = _party_overlay(review_id, account)
    if not overlay:
        return JsonResponse({"detail": "Review not found for this account."}, status=404)
    from coach_api.views import _imported_review_definition
    definition = _imported_review_definition(overlay.owner_email, review_id)
    if not definition or not definition.get("migratedForm"):
        return JsonResponse({"detail": "Migrated form unavailable."}, status=404)
    definition["readOnly"] = True
    definition["canCalculateProgress"] = False
    definition.pop("progressVersion", None)
    definition.pop("historicalReview", None)
    definition.pop("ragHistory", None)
    definition.pop("summaryBinding", None)
    definition.pop("answerVersion", None)
    return JsonResponse(definition)


@require_GET
def migrated_review_party_pdf(request, review_id):
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to view this PDF."}, status=401)
    with transaction.atomic():
        overlay = _party_overlay(review_id, account, lock=True)
        if not overlay or overlay.status != ImportedReviewInstance.STATUS_COMPLETED:
            return JsonResponse({"detail": "Completed review not found for this account."}, status=404)
        return _completed_pdf_response(overlay)


@require_POST
def migrated_review_party_sign(request, review_id):
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to sign this review."}, status=401)
    if account.role not in {"learner", "employer"}:
        return JsonResponse({"detail": "This account cannot sign as a review participant."}, status=403)
    payload = _payload(request)
    if payload is None:
        return JsonResponse({"detail": "Invalid JSON object."}, status=400)
    with transaction.atomic():
        overlay = _party_overlay(review_id, account, lock=True)
        if not overlay:
            return JsonResponse({"detail": "Review not found for this account."}, status=404)
        role = "participant" if account.role == "learner" else "employer"
        try:
            sign(overlay, role, account=account, signature=payload.get("signature"))
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=409)
    return JsonResponse({"signed": True, "role": role})


@coach_access_required
@require_POST
def migrated_review_complete(request, review_id):
    owner, definition = _coach_review(request, review_id)
    if not definition:
        return JsonResponse({"detail": "Migrated review not found."}, status=404)
    with transaction.atomic():
        overlay = _locked_overlay(owner, definition)
        if not overlay:
            return JsonResponse({"detail": "Migrated review association mismatch."}, status=409)
        try:
            complete(overlay)
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=409)
        _mirror_status(overlay)
    return _response(owner, review_id)


def _pdf_context(overlay, definition=None):
    if definition is None:
        # Participants retain their own ownership gate; they need neither coach
        # mutation permission nor membership of the original coach's caseload.
        # Only persisted identity/date display context is read, never live form,
        # template, learner progress or meeting intelligence services.
        from coach_api.views import _review_learner_identity, get_learner_db_alias
        profile = LearnerProfile.objects.filter(pk=overlay.learner_id).first()
        with connections[get_learner_db_alias()].cursor() as cursor:
            cursor.execute(
                'SELECT planned_scheduled_date, review_type, status, completed_date '
                'FROM "Learner".reviews WHERE id = %s AND learner_id = %s',
                [overlay.source_review_id, overlay.learner_id],
            )
            source = cursor.fetchone()
        if not profile or not source or str(source[2] or "").strip().casefold() == "completed" or source[3]:
            raise ValueError("Migrated source association is unavailable.")
        definition = {
            **_review_learner_identity(profile),
            "instance": {"targetDate": source[0]},
            "historicalReview": {"type": source[1]},
        }
    from coach_api.views import imported_review_calendar_rows
    rows = imported_review_calendar_rows(overlay.owner_email, overlay.event_key)
    calendar = next((row for row in rows if len(rows) == 1
                     and row.owner_email.casefold() == overlay.owner_email.casefold()
                     and row.learner_id == overlay.learner_id), None)
    return {
        "learner_name": definition.get("learnerName") or "",
        "learner_email": definition.get("learnerEmail") or "",
        "programme": definition.get("programme") or "",
        "scheduled_date": calendar.scheduled_date if calendar and calendar.scheduled_date else definition["instance"].get("targetDate"),
        "coach_name": overlay.owner_email,
        "source_family": review_family((definition.get("historicalReview") or {}).get("type")),
    }


def _final_document(overlay, definition=None):
    """Caller holds the completed overlay lock, including during first render.

    Recheck under that lock so simultaneous coach/participant downloads and the
    compatibility endpoint all reuse the winner's immutable document. Existing
    documents need no display context or rendering. The unique overlay FK is a
    second persistence guard. Only local rendering occurs while holding the lock.
    """
    document = MigratedReviewDocument.objects.filter(overlay=overlay).first()
    return document if document is not None else ensure_document(overlay, **_pdf_context(overlay, definition))


def _completed_pdf_response(overlay, definition=None):
    try:
        document = _final_document(overlay, definition)
    except Exception:
        # ensure_document inserts only after rendering, inside a savepoint.
        # A retry never needs to change completion, answers or signatures.
        return JsonResponse({"detail": "Unable to prepare the signed PDF. Please try again."}, status=503)
    return stored_pdf_response(overlay, document)


@coach_access_required
@require_POST
def migrated_review_generate_pdf(request, review_id):
    owner, definition = _coach_review(request, review_id, pdf_only=True)
    if not definition:
        return JsonResponse({"detail": "Migrated review not found."}, status=404)
    with transaction.atomic():
        overlay = _locked_overlay(owner, definition)
        if not overlay or overlay.status != ImportedReviewInstance.STATUS_COMPLETED:
            return JsonResponse({"detail": "Complete the review before generating its PDF."}, status=409)
        try:
            document = _final_document(overlay, definition)
        except Exception:
            # The completed review stays intact; no incomplete document is stored.
            return JsonResponse({"detail": "The LMS PDF could not be generated. Retry this action."}, status=503)
    return JsonResponse({"available": True, "documentId": document.pk})


def migrated_review_pdf_response(request, review_id, definition):
    owner = authenticated_coach_email(request).strip().casefold()
    with transaction.atomic():
        overlay = _locked_overlay(owner, definition)
        if not overlay or overlay.event_key != review_id or overlay.status != ImportedReviewInstance.STATUS_COMPLETED:
            return JsonResponse({"detail": "The migrated review is not complete."}, status=409)
        return _completed_pdf_response(overlay, definition)
