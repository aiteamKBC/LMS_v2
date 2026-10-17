"""Compact read for the Student Dashboard's Weekly Learning panel.

    GET /learner_api/weekly-learning/<kind>/<int:pk>/

The panel draws every week of the learner's assigned modules (a progress ring
per week, a module picker, instant week selection), so it needs each assigned
activity's identity, timing, KSB codes and completion -- not descriptions,
lesson HTML, files, activity history or hours totals.

Strictly read-only: it never calls build_learner_detail, whose activation,
plan-hydration, KSB and OTJH-snapshot repairs write on GET, and it resolves the
learner profile without the identity helper's enrolment-link self-heal. The
authored tree, assignment templates, expected OTJH, week quizzes and retained
quiz credit come from the same readers learner-detail uses, so membership and
completion follow the canonical rules.
"""
import re

from django.db import DatabaseError
from django.http import JsonResponse

from login.permissions import learner_self_or_staff

from .identity import learner_profile_for_source
from .learning_plan import effective_training_plan, request_preset_cache
from .mappers import _s, flatten_training_plan, get_training_plan
from .models import _serialise_quiz_ref
from .projection_performance import measure_projection
from .retained_quiz_progress import retain_quiz_progress

# JavaScript's \s and String.prototype.trim() set. The availability rule below
# mirrors utils/learnerJourney.ts hasComponentContent, so it must strip exactly
# what the browser strips (Python's \s differs at \x1c-\x1f and \ufeff).
_JS_SPACE = ("\t\n\v\f\r \u00a0\u1680" + "".join(map(chr, range(0x2000, 0x200B)))
             + "\u2028\u2029\u202f\u205f\u3000\ufeff")
_SPACE_CLASS = f"[{re.escape(_JS_SPACE)}]"
_TAGS = re.compile(r"<[^>]*>")
_TEXT_NOISE = re.compile(rf"&nbsp;|{_SPACE_CLASS}")
_TOPIC_SPACE = re.compile(r"&nbsp;|&#160;", re.IGNORECASE)
_TYPE_SPACE = re.compile(rf"(?:{_SPACE_CLASS}|-)+")


def _js_trim(value):
    return value.strip(_JS_SPACE)


def _has_text(value):
    return isinstance(value, str) and bool(_TEXT_NOISE.sub("", _TAGS.sub("", value)))


def _has_url(value):
    return isinstance(value, str) and bool(_js_trim(value))


def _topic_has_content(topic):
    """lib/assignmentTopics.ts topicHasContent."""
    def html_text(value):
        return bool(_js_trim(_TOPIC_SPACE.sub(" ", _TAGS.sub("", value if isinstance(value, str) else ""))))
    resources = topic.get("resources") if isinstance(topic, dict) else None
    return isinstance(topic, dict) and (
        html_text(topic.get("question")) or html_text(topic.get("instructions")) or bool(resources))


def component_content_available(c):
    """Port of utils/learnerJourney.ts hasComponentContent.

    Kept in step by frontend/src/utils/__tests__/componentContentCases.json,
    which both this module's tests and the frontend's run.
    """
    if c.get("isQuiz"):
        meta = c.get("quizMeta") or {}
        questions = meta.get("questions")
        return meta.get("quizId") is not None and (questions if questions is not None else 0) > 0
    ctype = c.get("type") if isinstance(c.get("type"), str) else ""
    ctype = _TYPE_SPACE.sub("_", _js_trim(ctype).lower())
    if ctype == "quiz":
        return False
    has_description = _has_text(c.get("description"))
    if ctype == "video":
        return (_has_url(c.get("videoUrl")) or bool(c.get("recordingSeriesId")
                and c.get("recordingSessionNumber") and c.get("recordingDate")))
    if ctype in {"podcast", "audio"}:
        return _has_url(c.get("audioUrl")) or _has_url(c.get("resourceUrl")) or has_description
    if ctype == "reading":
        return (c.get("hasReadingContent") is True or _has_text(c.get("contentHtml"))
                or _has_url(c.get("resourceUrl")) or _has_url(c.get("audioUrl")) or has_description)
    if ctype in {"powerpoint", "presentation", "slides"}:
        return _has_url(c.get("resourceUrl")) or has_description
    if ctype == "reflection":
        return True
    if ctype == "live_session":
        return (_has_url(c.get("liveSessionUrl")) or _has_text(c.get("sessionDateTimeUtc"))
                or _has_text(c.get("sessionDate")) or bool(c.get("teamsLiveSessionId")) or has_description)
    if ctype == "assignment":
        return (any(_topic_has_content(topic) for topic in c.get("assignmentTopics") or [])
                or _has_text(c.get("assignmentBrief")) or _has_text(c.get("assignmentBriefHtml"))
                or _has_url(c.get("resourceUrl")) or _has_text(c.get("contentHtml"))
                or c.get("hasReadingContent") is True or has_description)
    return (_has_url(c.get("resourceUrl")) or _has_text(c.get("reflectionPrompt"))
            or _has_text(c.get("reflectionQuestion")) or _has_text(c.get("contentHtml"))
            or c.get("hasReadingContent") is True or _has_url(c.get("audioUrl"))
            or _has_text(c.get("assignmentBrief")) or _has_text(c.get("assignmentBriefHtml"))
            or has_description)


def _weekly_component(c):
    """Only what the Weekly panel renders, filters, links or counts."""
    meta = c.get("quizMeta")
    row = {
        "module": c.get("module"),
        "week": c.get("week"),
        "component": c.get("component"),
        "expectedOtjh": c.get("expectedOtjh"),
        "componentId": c.get("componentId"),
        "moduleId": c.get("moduleId"),
        "weekId": c.get("weekId"),
        "type": c.get("type"),
        "isQuiz": bool(c.get("isQuiz")),
        "quizMeta": {key: meta.get(key) for key in ("quizId", "questions", "duration", "timeUnit")}
        if isinstance(meta, dict) else None,
        "durationMinutes": c.get("durationMinutes"),
        # Codes drive the chips and KSB progress; descriptions are not shown here.
        "ksbMappings": [
            {"code": item.get("code"), "description": None,
             "classification": item.get("classification"), "weight": item.get("weight") or 0}
            for item in c.get("ksbMappings") or [] if isinstance(item, dict) and item.get("code")
        ],
        # The activity link picks its video route from the raw type and URL.
        "videoUrl": c.get("videoUrl"),
        # Replaces the descriptions, briefs and URLs the link rule reads.
        "contentAvailable": component_content_available(c),
    }
    ctype = c.get("type") if isinstance(c.get("type"), str) else ""
    if _TYPE_SPACE.sub("_", _js_trim(ctype).lower()) == "live_session":
        # The hero's "Next live session" link matches the scheduled lecture to
        # its authored activity by these dates (liveSessionRoute.ts).
        row["sessionDate"] = c.get("sessionDate")
        row["sessionDateTimeUtc"] = c.get("sessionDateTimeUtc")
    # As learner-detail's compact mode: omitted means null to every consumer.
    return {key: value for key, value in row.items()
            if value is not None or key in {"module", "week", "component", "expectedOtjh"}}


def _progress(profile):
    """The completion facts to_learner_detail splits from training_plan_progress."""
    if profile is None:
        return [], [], []
    rows = profile.progress_entries.exclude(kind="activity_event").values_list(
        "kind", "passed", "component_ref", "quiz_ref", "grade", "started_at", "submitted_at")
    quizzes, videos, components = [], {}, {}
    for kind, passed, component_ref, quiz_ref, grade, started_at, submitted_at in rows:
        if kind == "quiz":
            # Every attempt: a failed one still marks the quiz "in progress".
            quizzes.append({
                "quizId": _serialise_quiz_ref(quiz_ref), "componentId": component_ref, "passed": passed,
                "grade": float(grade) if grade is not None else None,
                "startedAt": started_at.isoformat() if started_at else "",
                "submittedAt": submitted_at.isoformat() if submitted_at else "",
            })
        elif kind == "video":
            videos[(component_ref, passed)] = {"kind": kind, "componentId": component_ref, "passed": passed}
        elif kind == "component" or (kind == "quiz_reading" and submitted_at):
            components[(kind, component_ref, passed)] = {"kind": kind, "componentId": component_ref, "passed": passed}
    return quizzes, list(videos.values()), list(components.values())


def build_weekly_learning(source, pk, *, learning_summary=False, assigned_modules=None, strict=False, week_ids=None, identities_only=False, progress=None, compact_content=False):
    # Same readers as build_learner_detail, without its write-on-read repairs.
    from .learner_detail import (_annotate_otjh, _append_week_quizzes,
                                 _apply_programme_assignment_template, _resolve_from_master)

    assigned = effective_training_plan(source, request_preset_cache(source)) if assigned_modules is None else assigned_modules
    modules, weeks, components = ([], [], []) if identities_only or week_ids is not None else flatten_training_plan(get_training_plan(source))
    # live_session_ids=False: the Teams series ids it looks up are never sent.
    # expected_otjh=True: master rows bring their expected hours, so only the
    # rest (legacy and snapshot-only entries) need _annotate_otjh's lookups.
    strict_options = {'strict': True} if strict else {}
    projection_options = {"week_ids": week_ids, "identities_only": identities_only} if identities_only or week_ids is not None else {}
    if compact_content:
        projection_options['compact_content'] = True
    modules, weeks, components = _resolve_from_master(
        modules, weeks, components, assigned_modules=assigned, compact=True,
        live_session_ids=False, expected_otjh=not identities_only, **projection_options, **strict_options)
    if not identities_only:
        components = _apply_programme_assignment_template(components, getattr(source, "programme", ""))
        _annotate_otjh([c for c in components if "expectedOtjh" not in c])
    quiz_options = {"native_week_ids": True} if identities_only or week_ids is not None else {}
    weeks, components = _append_week_quizzes(weeks, components, assigned_modules=assigned, **strict_options, **quiz_options)

    # heal=False: this GET must never write, not even the identity self-heal.
    owned_profile = getattr(source, '_case_file_profile', None) if learning_summary or strict else None
    quiz_attempts, video_progress, component_progress = progress if progress is not None else _progress(
        owned_profile if owned_profile is not None else learner_profile_for_source(source, pk, heal=False))
    detail = {"components": components, "quizAttempts": quiz_attempts}
    # Compact projections need completed credit only, as learner-detail's summary.
    if progress is None:
        retain_quiz_progress(detail, completed_only=True, **strict_options)
    if week_ids is not None:
        components = [c for c in components if str(c.get("weekId")) in set(map(str, week_ids))]
    result = {
        "id": str(source.id),
        # learnerHeaderPlan matches the learner's placement to choose the module.
        "programme": _s(source.programme),
        "cohort": _s(source.cohort),
        "group": _s(source.group),
        # buildLearnerJourney's module and week order, for the hero's lecture link.
        "modules": modules,
        "week": [{key: w.get(key) for key in ("module", "week", "moduleId", "weekId")} for w in weeks],
        "components": components if identities_only else [_weekly_component(c) for c in components],
        "quizAttempts": quiz_attempts,
        "videoProgress": video_progress,
        "componentProgress": component_progress,
    }
    if learning_summary:
        result['retiredQuizComponents'] = [_weekly_component(c) for c in detail.get('retiredQuizComponents', [])]
    return result


@learner_self_or_staff(kwarg="pk")
def learner_weekly_learning(request, kind, pk):
    from .learner_detail import SOURCE_MODELS, _error

    # After the access gate, in learner-detail's order, so every caller gets
    # the same status from both endpoints.
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)
    try:
        # all_learners, as learner-detail: the default manager hides commercial rows.
        source = model.all_learners.get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    try:
        with measure_projection('weekly-learning', kind=kind, learner_id=pk) as measurement:
            with measurement.stage('weekly'):
                response = JsonResponse(build_weekly_learning(source, pk))
        response['Cache-Control'] = 'private, no-store'
        return response
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
