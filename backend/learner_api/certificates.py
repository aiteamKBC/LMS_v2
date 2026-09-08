import json
import re
import uuid
from datetime import datetime

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import staff_only

from .learner_detail import SOURCE_MODELS, build_learner_detail


CERTIFICATE_TYPE = "progress-achievement"
SOURCE_DOES_NOT_EXIST = tuple({model.DoesNotExist for model in SOURCE_MODELS.values()})


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _template_dict(row):
    if not row:
        return None
    return {
        "id": row[0],
        "version": row[1],
        "title": row[2],
        "bodyText": row[3],
        "minimumProgress": float(row[4]),
        "requireFinalTest": row[5],
        "layoutConfig": row[6] if isinstance(row[6], dict) else {},
    }


def _certificate_dict(row):
    if not row:
        return None
    issued_at = row[6]
    return {
        "id": row[0],
        "certificateNumber": row[1],
        "templateId": row[2],
        "templateVersion": row[3],
        "progressPercent": float(row[4]),
        "snapshot": row[5] if isinstance(row[5], dict) else {},
        "issuedAt": issued_at.isoformat() if issued_at else None,
        "pdfBlobUrl": row[7] or "",
        "verificationToken": str(row[8]),
        "verificationUrl": f"/verify-certificate/{row[8]}",
    }


def _published_template(cursor):
    cursor.execute(
        '''SELECT id,version,title,body_text,minimum_progress,require_final_test,layout_config
           FROM "Learner".certificate_templates
           WHERE certificate_type=%s AND status=%s
           ORDER BY version DESC LIMIT 1''',
        [CERTIFICATE_TYPE, "published"],
    )
    return cursor.fetchone()


def _issued_certificate(cursor, kind, pk, template_id=None, template_version=None):
    params = [kind, pk, CERTIFICATE_TYPE]
    version_clause = ""
    if template_id is not None and template_version is not None:
        version_clause = "AND lc.template_id=%s AND lc.template_version=%s"
        params.extend([template_id, template_version])
    cursor.execute(
        f'''SELECT lc.id,lc.certificate_number,lc.template_id,lc.template_version,
                  lc.progress_percent,lc.snapshot,lc.issued_at,lc.pdf_blob_url,lc.verification_token
            FROM "Learner".learner_certificates lc
            JOIN "Learner".certificate_templates ct ON ct.id = lc.template_id
            WHERE lc.learner_kind=%s AND lc.learner_id=%s AND lc.status='issued'
              AND ct.certificate_type=%s {version_clause}
            ORDER BY lc.issued_at DESC LIMIT 1''',
        params,
    )
    return cursor.fetchone()


def _clean_text(value):
    return str(value or "").strip()


def _has_text(value):
    return bool(re.sub(r"<[^>]*>|&nbsp;|\s+", "", _clean_text(value)))


def _has_url(value):
    return bool(_clean_text(value))


def _progress_counts(record):
    if not record:
        return False
    if record.get("passed") is False:
        return False
    return True


def _component_has_content(component):
    ctype = _clean_text(component.get("type")).lower().replace("-", "_")
    if component.get("isQuiz"):
        meta = component.get("quizMeta") if isinstance(component.get("quizMeta"), dict) else {}
        try:
            return meta.get("quizId") is not None and int(meta.get("questions") or 0) > 0
        except (TypeError, ValueError):
            return False
    if ctype == "video":
        return _has_url(component.get("videoUrl"))
    if ctype in {"podcast", "audio"}:
        return _has_url(component.get("audioUrl")) or _has_url(component.get("resourceUrl")) or _has_text(component.get("description"))
    if ctype == "reading":
        return (
            _has_text(component.get("contentHtml"))
            or _has_url(component.get("resourceUrl"))
            or _has_url(component.get("audioUrl"))
            or _has_text(component.get("description"))
        )
    if ctype in {"powerpoint", "presentation", "slides"}:
        return _has_url(component.get("resourceUrl")) or _has_text(component.get("description"))
    if ctype == "reflection":
        return True
    if ctype == "live_session":
        return (
            _has_url(component.get("liveSessionUrl"))
            or _has_text(component.get("sessionDateTimeUtc"))
            or _has_text(component.get("sessionDate"))
            or _has_text(component.get("description"))
            or _has_text(component.get("teamsLiveSessionId"))
        )
    return (
        _has_url(component.get("resourceUrl"))
        or _has_text(component.get("reflectionPrompt"))
        or _has_text(component.get("reflectionQuestion"))
        or _has_text(component.get("contentHtml"))
        or _has_url(component.get("audioUrl"))
        or _has_text(component.get("assignmentBrief"))
        or _has_text(component.get("assignmentBriefHtml"))
        or _has_text(component.get("description"))
    )


def _learner_progress(detail):
    quiz_attempts = detail.get("quizAttempts") if isinstance(detail.get("quizAttempts"), list) else []
    video_done = {
        _clean_text(row.get("componentId"))
        for row in (detail.get("videoProgress") or [])
        if _clean_text(row.get("componentId")) and _progress_counts(row)
    }
    component_done = {
        _clean_text(row.get("componentId"))
        for row in (detail.get("componentProgress") or [])
        if _clean_text(row.get("componentId")) and _progress_counts(row)
    }

    total = 0
    done = 0
    final_test_passed = False
    for component in detail.get("components") or []:
        component_id = _clean_text(component.get("componentId"))
        ctype = _clean_text(component.get("type")).lower().replace("-", "_")
        if component.get("isQuiz"):
            if not _component_has_content(component):
                continue
            total += 1
            quiz_meta = component.get("quizMeta") if isinstance(component.get("quizMeta"), dict) else {}
            quiz_id = _clean_text(quiz_meta.get("quizId"))
            attempts = [row for row in quiz_attempts if _clean_text(row.get("quizId")) == quiz_id]
            if attempts:
                done += 1
            component_title = _clean_text(component.get("component") or component.get("componentTitle")).lower()
            if "final" in component_title and any(row.get("passed") is True for row in attempts):
                final_test_passed = True
        elif ctype == "video" or _has_url(component.get("videoUrl")):
            if component_id and _component_has_content(component):
                total += 1
                if component_id in video_done:
                    done += 1
        elif component_id and _component_has_content(component):
            total += 1
            if component_id in component_done:
                done += 1
    percent = round((done / total) * 100) if total else 0
    return {"progressPercent": percent, "trackableTotal": total, "trackableDone": done, "finalTestPassed": final_test_passed}


def _load_source(kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        raise ValueError("Unknown learner type.")
    manager = getattr(model, "all_learners", model.objects)
    return manager.get(pk=pk)


def _eligibility(kind, pk, template):
    source = _load_source(kind, pk)
    detail = build_learner_detail(source, pk)
    progress = _learner_progress(detail)
    missing = []
    if progress["progressPercent"] < template["minimumProgress"]:
        missing.append("progress")
    if template["requireFinalTest"] and not progress["finalTestPassed"]:
        missing.append("final_test")
    return {
        **progress,
        "eligible": not missing,
        "missing": missing,
        "minimumProgress": template["minimumProgress"],
        "learner": {
            "id": _clean_text(detail.get("id")),
            "kind": kind,
            "name": _clean_text(detail.get("name")),
            "email": _clean_text(detail.get("email")),
            "programme": _clean_text(detail.get("programme")),
            "cohort": _clean_text(detail.get("cohort")),
            "group": _clean_text(detail.get("group")),
            "employer": _clean_text(detail.get("employer")),
        },
    }


def _new_certificate_number():
    return f"KBC-{datetime.utcnow().year}-{uuid.uuid4().hex[:10].upper()}"


@staff_only(allow_own_learner="pk")
def learner_certificate_template(request, kind, pk):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        with connections["enrolment"].cursor() as cursor:
            row = _published_template(cursor)
    except DatabaseError:
        return JsonResponse({"template": None, "configured": False})
    if not row:
        return JsonResponse({"template": None, "configured": True})
    return JsonResponse({"configured": True, "template": _template_dict(row)})


@staff_only(allow_own_learner="pk")
def learner_certificate_status(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    try:
        with connections["enrolment"].cursor() as cursor:
            template = _template_dict(_published_template(cursor))
            if not template:
                return JsonResponse({"configured": True, "template": None, "certificate": None})
            certificate = _certificate_dict(_issued_certificate(cursor, kind, pk))
        eligibility = _eligibility(kind, pk, template)
    except SOURCE_DOES_NOT_EXIST:
        return _error("Learner not found.", 404)
    except ValueError as exc:
        return _error(str(exc), 404)
    except DatabaseError:
        return JsonResponse({"configured": False, "template": None, "certificate": None})
    return JsonResponse({"configured": True, "template": template, "certificate": certificate, "eligibility": eligibility})


@csrf_exempt
@staff_only(allow_own_learner="pk")
def issue_learner_certificate(request, kind, pk):
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        with connections["enrolment"].cursor() as cursor:
            template = _template_dict(_published_template(cursor))
        if not template:
            return _error("No published certificate template has been configured.", 409)
        eligibility = _eligibility(kind, pk, template)
        if not eligibility["eligible"]:
            return JsonResponse({"error": "Learner is not eligible for this certificate yet.", "eligibility": eligibility}, status=409)
        learner = eligibility["learner"]
        snapshot = {
            "certificateTitle": template["title"],
            "bodyText": template["bodyText"],
            "layoutConfig": template["layoutConfig"],
            "learner": learner,
            "programme": learner["programme"],
            "progressPercent": eligibility["progressPercent"],
            "trackableDone": eligibility["trackableDone"],
            "trackableTotal": eligibility["trackableTotal"],
            "minimumProgress": template["minimumProgress"],
            "finalTestPassed": eligibility["finalTestPassed"],
        }
        actor = _clean_text(getattr(getattr(request, "login_account", None), "email", "")) or "system"
        with transaction.atomic(using="enrolment"):
            with connections["enrolment"].cursor() as cursor:
                existing = _issued_certificate(cursor, kind, pk, template["id"], template["version"])
                if existing:
                    return JsonResponse({
                        "certificate": _certificate_dict(existing),
                        "template": template,
                        "eligibility": eligibility,
                        "issued": False,
                    })
                cursor.execute(
                    '''INSERT INTO "Learner".learner_certificates
                       (certificate_number, learner_kind, learner_id, template_id, template_version,
                        progress_percent, snapshot, issued_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
                       ON CONFLICT (learner_kind, learner_id, template_id, template_version) DO NOTHING
                       RETURNING id,certificate_number,template_id,template_version,
                                 progress_percent,snapshot,issued_at,pdf_blob_url,verification_token''',
                    [
                        _new_certificate_number(),
                        kind,
                        pk,
                        template["id"],
                        template["version"],
                        eligibility["progressPercent"],
                        json.dumps(snapshot),
                        actor,
                    ],
                )
                row = cursor.fetchone()
                if row:
                    cursor.execute(
                        '''INSERT INTO "Learner".certificate_audit_logs
                           (actor_email,action,template_id,certificate_id,details)
                           VALUES (%s,%s,%s,%s,%s::jsonb)''',
                        [actor, "certificate-issued", template["id"], row[0], json.dumps({"learnerKind": kind, "learnerId": pk})],
                    )
                else:
                    row = _issued_certificate(cursor, kind, pk, template["id"], template["version"])
    except SOURCE_DOES_NOT_EXIST:
        return _error("Learner not found.", 404)
    except ValueError as exc:
        return _error(str(exc), 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"certificate": _certificate_dict(row), "template": template, "eligibility": eligibility, "issued": True})


def verify_certificate(request, token):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                '''SELECT lc.id,lc.certificate_number,lc.template_id,lc.template_version,
                          lc.progress_percent,lc.snapshot,lc.issued_at,lc.pdf_blob_url,lc.verification_token
                   FROM "Learner".learner_certificates lc
                   WHERE lc.verification_token=%s AND lc.status='issued'
                   LIMIT 1''',
                [token],
            )
            row = cursor.fetchone()
    except DatabaseError:
        return _error("Certificate verification is unavailable.", 503)
    if not row:
        return _error("Certificate not found.", 404)
    return JsonResponse({"valid": True, "certificate": _certificate_dict(row)})
