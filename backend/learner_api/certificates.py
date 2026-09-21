import json
import re
import uuid
from datetime import datetime

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token

from login.permissions import staff_only

from .learner_detail import SOURCE_MODELS, build_learner_detail


CERTIFICATE_TYPE = "progress-achievement"
SOURCE_DOES_NOT_EXIST = tuple({model.DoesNotExist for model in SOURCE_MODELS.values()})


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _json_dict(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except ValueError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}


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
        "layoutConfig": _json_dict(row[6]),
    }


def _template_summary(template):
    """Fields the learner catalogue needs; never send embedded artwork there."""
    if not template:
        return None
    return {
        key: template[key]
        for key in ("id", "version", "title", "minimumProgress", "requireFinalTest")
    }


def _certificate_dict(row):
    if not row:
        return None
    issued_at = row[6]
    snapshot = _json_dict(row[5])
    if "layoutConfig" in snapshot:
        snapshot["layoutConfig"] = _json_dict(snapshot.get("layoutConfig"))
    data = {
        "id": row[0],
        "certificateNumber": row[1],
        "templateId": row[2],
        "templateVersion": row[3],
        "progressPercent": float(row[4]),
        "snapshot": snapshot,
        "issuedAt": issued_at.isoformat() if issued_at else None,
        "pdfBlobUrl": row[7] or "",
        "verificationToken": str(row[8]),
        "verificationUrl": f"/verify-certificate/{row[8]}",
    }
    if len(row) > 9:
        data["moduleRef"] = row[9] or ""
        data["moduleTitle"] = row[10] or ""
    return data


def _published_template(cursor):
    cursor.execute(
        '''SELECT id,version,title,body_text,minimum_progress,require_final_test,layout_config
           FROM "Learner".certificate_templates
           WHERE certificate_type=%s AND status=%s
           ORDER BY version DESC LIMIT 1''',
        [CERTIFICATE_TYPE, "published"],
    )
    return cursor.fetchone()


def _issued_certificate(cursor, kind, pk, template_id=None, template_version=None, module_ref=None):
    params = [kind, pk, CERTIFICATE_TYPE]
    version_clause = ""
    if template_id is not None and template_version is not None:
        version_clause = "AND lc.template_id=%s AND lc.template_version=%s"
        params.extend([template_id, template_version])
    module_clause = "AND COALESCE(lc.module_ref,'')=%s" if module_ref is not None else "AND COALESCE(lc.module_ref,'')=''"
    if module_ref is not None:
        params.append(module_ref)
    cursor.execute(
        f'''SELECT lc.id,lc.certificate_number,lc.template_id,lc.template_version,
                  lc.progress_percent,lc.snapshot,lc.issued_at,lc.pdf_blob_url,lc.verification_token,
                  lc.module_ref,lc.module_title
            FROM "Learner".learner_certificates lc
            JOIN "Learner".certificate_templates ct ON ct.id = lc.template_id
            WHERE lc.learner_kind=%s AND lc.learner_id=%s AND lc.status='issued'
              AND ct.certificate_type=%s {version_clause} {module_clause}
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
    # Older imports stored watched videos in the generic component bucket.
    # Completion is keyed by component id, so both buckets are valid evidence
    # regardless of which runner wrote the row.
    completed_component_ids = video_done | component_done

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
            if any(row.get("passed") is True for row in attempts):
                done += 1
            component_title = _clean_text(component.get("component") or component.get("componentTitle")).lower()
            if "final" in component_title and any(row.get("passed") is True for row in attempts):
                final_test_passed = True
        elif ctype == "video" or _has_url(component.get("videoUrl")):
            if component_id and _component_has_content(component):
                total += 1
                if component_id in completed_component_ids:
                    done += 1
        elif component_id and _component_has_content(component):
            total += 1
            if component_id in completed_component_ids:
                done += 1
    percent = round((done / total) * 100) if total else 0
    return {"progressPercent": percent, "trackableTotal": total, "trackableDone": done, "finalTestPassed": final_test_passed}


def _component_activity_progress(detail, components):
    quiz_attempts = detail.get("quizAttempts") if isinstance(detail.get("quizAttempts"), list) else []
    completed_component_ids = {
        _clean_text(row.get("componentId"))
        for row in [*(detail.get("videoProgress") or []), *(detail.get("componentProgress") or [])]
        if _clean_text(row.get("componentId")) and _progress_counts(row)
    }
    seen = set()
    total = 0
    done = 0
    final_test_passed = False
    for index, component in enumerate(components):
        quiz_meta = component.get("quizMeta") if isinstance(component.get("quizMeta"), dict) else {}
        component_key = _clean_text(component.get("componentId")) or f"quiz:{_clean_text(quiz_meta.get('quizId')) or f'{_clean_text(component.get('week'))}:{index}'}"
        if component_key in seen:
            continue
        seen.add(component_key)
        total += 1
        if component.get("isQuiz"):
            quiz_id = _clean_text(quiz_meta.get("quizId"))
            attempts = [row for row in quiz_attempts if _clean_text(row.get("quizId")) == quiz_id]
            passed = any(row.get("passed") is True for row in attempts)
            if passed:
                done += 1
            component_title = _clean_text(component.get("component") or component.get("componentTitle")).lower()
            if "final" in component_title and passed:
                final_test_passed = True
        elif _clean_text(component.get("componentId")) in completed_component_ids:
            done += 1
    percent = round((done / total) * 10000) / 100 if total else 0
    return {"progressPercent": percent, "trackableTotal": total, "trackableDone": done, "finalTestPassed": final_test_passed}


def _subject_ref(value):
    ref = _clean_text(value)
    if not ref or len(ref) > 180 or not re.fullmatch(r"(current|legacy|unlinked):[-\w .:]+", ref):
        raise ValueError("Unknown module.")
    return ref


def _module_components(detail, module_ref):
    if module_ref.startswith("current:"):
        module_id = module_ref.split(":", 1)[1]
        return [
            component for component in detail.get("components") or []
            if _clean_text(component.get("moduleId")) == module_id
        ]
    if module_ref.startswith("unlinked:"):
        module_title = module_ref.split(":", 1)[1]
        return [
            component for component in detail.get("components") or []
            if _clean_text(component.get("module")) == module_title
        ]
    return []


def _module_progress(detail, module_ref):
    module_ref = _subject_ref(module_ref)
    components = _module_components(detail, module_ref)
    if not components:
        raise ValueError("Module not found.")
    progress = _component_activity_progress(detail, components)
    title = _clean_text(components[0].get("module")) or module_ref.split(":", 1)[1]
    return {**progress, "moduleRef": module_ref, "moduleTitle": title}


def _load_source(kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        raise ValueError("Unknown learner type.")
    manager = getattr(model, "all_learners", model.objects)
    return manager.get(pk=pk)


def _source_text(source, *names):
    for name in names:
        value = _clean_text(getattr(source, name, ""))
        if value:
            return value
    return ""


def _learner_identity(detail, source, kind, pk):
    name = (
        _clean_text(detail.get("name"))
        or _source_text(source, "username", "full_name", "name", "email")
    )
    return {
        "id": _clean_text(detail.get("id")) or _source_text(source, "id") or str(pk),
        "kind": kind,
        "name": name,
        "email": _clean_text(detail.get("email")) or _source_text(source, "email"),
        "programme": _clean_text(detail.get("programme")) or _source_text(source, "programme"),
        "cohort": _clean_text(detail.get("cohort")) or _source_text(source, "cohort"),
        "group": _clean_text(detail.get("group")) or _source_text(source, "group"),
        "employer": _clean_text(detail.get("employer")) or _source_text(source, "employer"),
    }


def _snapshot_with_fallbacks(snapshot, kind, pk, module_ref="", module_title="", template_title="", template_body="", template_layout=None):
    data = _json_dict(snapshot).copy()
    try:
        source = _load_source(kind, pk)
        detail = build_learner_detail(source, pk)
        fallback_learner = _learner_identity(detail, source, kind, pk)
    except (SOURCE_DOES_NOT_EXIST, ValueError, DatabaseError):
        fallback_learner = {}

    current_learner = data.get("learner") if isinstance(data.get("learner"), dict) else {}
    learner = {
        key: _clean_text(current_learner.get(key)) or _clean_text(fallback_learner.get(key))
        for key in ("id", "kind", "name", "email", "programme", "cohort", "group", "employer")
    }
    if any(learner.values()):
        data["learner"] = learner
    if not _clean_text(data.get("programme")):
        data["programme"] = learner.get("programme", "")
    if _clean_text(module_ref) and not _clean_text(data.get("moduleRef")):
        data["moduleRef"] = _clean_text(module_ref)
    if _clean_text(module_ref) and not _clean_text(data.get("moduleTitle")):
        data["moduleTitle"] = _clean_text(module_title) or _clean_text(module_ref).split(":", 1)[-1]
    if _clean_text(template_title) and not _clean_text(data.get("certificateTitle")):
        data["certificateTitle"] = _clean_text(template_title)
    if _clean_text(template_body) and not _clean_text(data.get("bodyText")):
        data["bodyText"] = _clean_text(template_body)
    current_layout = _json_dict(data.get("layoutConfig"))
    if current_layout:
        data["layoutConfig"] = current_layout
    else:
        layout = _json_dict(template_layout)
        if layout:
            data["layoutConfig"] = layout
    return data


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
            **_learner_identity(detail, source, kind, pk),
        },
    }


def _module_eligibility(kind, pk, module_ref, template):
    source = _load_source(kind, pk)
    detail = build_learner_detail(source, pk)
    progress = _module_progress(detail, module_ref)
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
            **_learner_identity(detail, source, kind, pk),
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
    template = _template_dict(row)
    if request.GET.get("summary") == "1":
        template = _template_summary(template)
    return JsonResponse({
        "configured": True,
        "template": template,
        "csrfToken": get_token(request),
    })


@staff_only(allow_own_learner="pk")
def learner_certificate_status(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    try:
        with connections["enrolment"].cursor() as cursor:
            template = _template_dict(_published_template(cursor))
            if not template:
                return JsonResponse({"configured": True, "template": None, "certificate": None})
            certificate = _certificate_dict(_issued_certificate(cursor, kind, pk, template["id"], template["version"]))
        eligibility = _eligibility(kind, pk, template)
    except SOURCE_DOES_NOT_EXIST:
        return _error("Learner not found.", 404)
    except ValueError as exc:
        return _error(str(exc), 404)
    except DatabaseError:
        return JsonResponse({"configured": False, "template": None, "certificate": None})
    return JsonResponse({"configured": True, "template": template, "certificate": certificate, "eligibility": eligibility})


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
                        module_ref, module_title, progress_percent, snapshot, issued_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
                       ON CONFLICT (learner_kind, learner_id, template_id, template_version, module_ref) DO NOTHING
                       RETURNING id,certificate_number,template_id,template_version,
                                 progress_percent,snapshot,issued_at,pdf_blob_url,verification_token,
                                 module_ref,module_title''',
                    [
                        _new_certificate_number(),
                        kind,
                        pk,
                        template["id"],
                        template["version"],
                        "",
                        "",
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


@staff_only(allow_own_learner="pk")
def learner_module_certificate_status(request, kind, pk, module_ref):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    try:
        module_ref = _subject_ref(module_ref)
        with connections["enrolment"].cursor() as cursor:
            template = _template_dict(_published_template(cursor))
            if not template:
                return JsonResponse({"configured": True, "template": None, "certificate": None})
            certificate = _certificate_dict(_issued_certificate(cursor, kind, pk, template["id"], template["version"], module_ref))
        eligibility = _module_eligibility(kind, pk, module_ref, template)
    except SOURCE_DOES_NOT_EXIST:
        return _error("Learner not found.", 404)
    except ValueError as exc:
        return _error(str(exc), 404)
    except DatabaseError:
        return JsonResponse({"configured": False, "template": None, "certificate": None})
    return JsonResponse({"configured": True, "template": template, "certificate": certificate, "eligibility": eligibility})


@staff_only(allow_own_learner="pk")
def issue_learner_module_certificate(request, kind, pk, module_ref):
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        module_ref = _subject_ref(module_ref)
        with connections["enrolment"].cursor() as cursor:
            template = _template_dict(_published_template(cursor))
        if not template:
            return _error("No published certificate template has been configured.", 409)
        with connections["enrolment"].cursor() as cursor:
            existing = _issued_certificate(cursor, kind, pk, template["id"], template["version"], module_ref)
            if existing:
                return JsonResponse({
                    "certificate": _certificate_dict(existing),
                    "template": template,
                    "issued": False,
                })
        eligibility = _module_eligibility(kind, pk, module_ref, template)
        if not eligibility["eligible"]:
            return JsonResponse({"error": "Learner is not eligible for this module certificate yet.", "eligibility": eligibility}, status=409)
        learner = eligibility["learner"]
        snapshot = {
            "certificateTitle": template["title"],
            "bodyText": template["bodyText"],
            "layoutConfig": template["layoutConfig"],
            "learner": learner,
            "programme": learner["programme"],
            "moduleRef": eligibility["moduleRef"],
            "moduleTitle": eligibility["moduleTitle"],
            "progressPercent": eligibility["progressPercent"],
            "trackableDone": eligibility["trackableDone"],
            "trackableTotal": eligibility["trackableTotal"],
            "minimumProgress": template["minimumProgress"],
            "finalTestPassed": eligibility["finalTestPassed"],
        }
        actor = _clean_text(getattr(getattr(request, "login_account", None), "email", "")) or "system"
        with transaction.atomic(using="enrolment"):
            with connections["enrolment"].cursor() as cursor:
                existing = _issued_certificate(cursor, kind, pk, template["id"], template["version"], module_ref)
                if existing:
                    cursor.execute(
                        '''UPDATE "Learner".learner_certificates
                           SET progress_percent=%s, snapshot=%s::jsonb, module_title=%s
                           WHERE id=%s
                           RETURNING id,certificate_number,template_id,template_version,
                                     progress_percent,snapshot,issued_at,pdf_blob_url,verification_token,
                                     module_ref,module_title''',
                        [
                            eligibility["progressPercent"],
                            json.dumps(snapshot),
                            eligibility["moduleTitle"],
                            existing[0],
                        ],
                    )
                    existing = cursor.fetchone() or existing
                    return JsonResponse({
                        "certificate": _certificate_dict(existing),
                        "template": template,
                        "eligibility": eligibility,
                        "issued": False,
                    })
                cursor.execute(
                    '''INSERT INTO "Learner".learner_certificates
                       (certificate_number, learner_kind, learner_id, template_id, template_version,
                        module_ref, module_title, progress_percent, snapshot, issued_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
                       ON CONFLICT (learner_kind, learner_id, template_id, template_version, module_ref) DO NOTHING
                       RETURNING id,certificate_number,template_id,template_version,
                                 progress_percent,snapshot,issued_at,pdf_blob_url,verification_token,
                                 module_ref,module_title''',
                    [
                        _new_certificate_number(),
                        kind,
                        pk,
                        template["id"],
                        template["version"],
                        module_ref,
                        eligibility["moduleTitle"],
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
                        [actor, "module-certificate-issued", template["id"], row[0], json.dumps({"learnerKind": kind, "learnerId": pk, "moduleRef": module_ref})],
                    )
                else:
                    row = _issued_certificate(cursor, kind, pk, template["id"], template["version"], module_ref)
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
                          lc.progress_percent,lc.snapshot,lc.issued_at,lc.pdf_blob_url,lc.verification_token,
                          lc.module_ref,lc.module_title,lc.learner_kind,lc.learner_id,
                          ct.title,ct.body_text,ct.layout_config
                   FROM "Learner".learner_certificates lc
                   JOIN "Learner".certificate_templates ct ON ct.id=lc.template_id
                   WHERE lc.verification_token=%s AND lc.status='issued'
                   LIMIT 1''',
                [token],
            )
            row = cursor.fetchone()
    except DatabaseError:
        return _error("Certificate verification is unavailable.", 503)
    if not row:
        return _error("Certificate not found.", 404)
    if len(row) > 15:
        row = list(row)
        row[5] = _snapshot_with_fallbacks(row[5], row[11], row[12], row[9], row[10], row[13], row[14], row[15])
        if _clean_text(row[9]):
            try:
                source = _load_source(row[11], row[12])
                progress = _module_progress(build_learner_detail(source, row[12]), row[9])
                row[4] = progress["progressPercent"]
                row[5]["progressPercent"] = progress["progressPercent"]
                row[5]["trackableDone"] = progress["trackableDone"]
                row[5]["trackableTotal"] = progress["trackableTotal"]
            except (SOURCE_DOES_NOT_EXIST, ValueError, DatabaseError):
                pass
    return JsonResponse({"valid": True, "certificate": _certificate_dict(row)})
