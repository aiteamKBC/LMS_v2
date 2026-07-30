"""Read-only learner-detail lookup for the learner workspace page.

    GET /learner_api/learner-detail/<kind>/<int:pk>/

`kind` is 'commercial' or 'apprenticeship', matching the vocabulary already
used by the /training-plan/:kind/:userId route. Combines the learner's own
record (CommercialUser / EnrolmentUser) with its "Learner"."Active_users"
mirror (present only while the learner is Active) into one response shaped by
mappers.to_learner_detail, then annotates each saved component with its
authored expected_otjh (curriculum.components) and a
programme-wide total.
authored expected_otjh (curriculum.components) and a programme-wide total.
"""
import json
import logging
import re
from html import unescape

from django.db import DatabaseError, connections
from django.http import JsonResponse

from .active_users import completed_hours_from_progress, fmt_hours
from .mappers import _s, to_learner_detail
from .models import CommercialUser, EnrolmentUser, LearnerProfile

logger = logging.getLogger(__name__)

SOURCE_MODELS = {
    "commercial": CommercialUser,
    "apprenticeship": EnrolmentUser,
}

IFRAME_SRC_RE = re.compile(r"<iframe[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)


def _video_url_from_settings(settings):
    direct = _s(settings.get("videoUrl"))
    if direct:
        return direct
    iframe = _s(settings.get("embedCode"))
    match = IFRAME_SRC_RE.search(iframe)
    if match:
        return unescape(match.group(1))
    return None


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _humanise_type(type_):
    """Mirror frontend/src/api/curriculum.ts's humaniseType()."""
    if not type_:
        return ""
    spaced = type_.replace("_", " ")
    return spaced[:1].upper() + spaced[1:]


def _display_component_title(type_, title):
    """Mirror frontend/src/api/curriculum.ts's fetchComponents() title display
    logic — needed only for the legacy (pre-id) title-matching fallback below."""
    type_label = _humanise_type(type_)
    show_title = bool(title) and title.strip().lower() != type_label.lower()
    return f"{type_label} · {title}" if show_title else (type_label or title)


def _otjh_by_component_id(components):
    """Exact expected_otjh lookup for components saved with the structured
    plan format (they carry the real curriculum.components id)."""
    ids = sorted({c["componentId"] for c in components if c.get("componentId")})
    if not ids:
        return {}
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT id, expected_otjh FROM curriculum.components WHERE id = ANY(%s)",
                [ids],
            )
            return {cid: (float(v) if v is not None else None) for cid, v in cur.fetchall()}
    except DatabaseError as exc:
        logger.warning("Could not look up expected_otjh by id: %s", exc)
        return {}


_WEEK_NUM_RE = re.compile(r"(?:week|wk)\s*-?\s*(\d+)", re.IGNORECASE)


def _week_number_from_title(title):
    """Best-effort week number from a free-text week label ('Week 1' -> 1)."""
    if not title:
        return None
    m = _WEEK_NUM_RE.search(title)
    return int(m.group(1)) if m else None


def _type_prefix_from_component_title(title):
    """The leading 'Type' label from a saved 'Type · Detail' component title.
    Falls back to the whole string when there's no separator."""
    if not title:
        return ""
    # Saved titles use the middle dot U+00B7 ('Live session · Live Teams session').
    head = title.split("·", 1)[0]
    return head.strip()


def _otjh_by_legacy_title(components):
    """Fallback expected_otjh lookup for components saved before the structured
    plan format existed (no real componentId to match on).

    Legacy plans carry client-generated week/component ids AND their own saved
    titles, both of which drift from the live curriculum once authors rename a
    week or edit a component title. So instead of relying on exact titles, we
    anchor on the parts that stay stable across those edits:
        module title  ->  week NUMBER  ->  component TYPE + ordinal position.
    Exact title still wins when it matches (unchanged plans); otherwise the
    Nth saved component of a given type maps to the Nth live component of that
    type in the same week (by display_order)."""
    legacy = [c for c in components if not c.get("componentId") and c.get("module")]
    if not legacy:
        return {}
    module_titles = sorted({c["module"] for c in legacy})
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT module_catalogue_id, title FROM curriculum.modules "
                "WHERE title = ANY(%s)",
                [module_titles],
            )
            module_ids = {title: cat_id for cat_id, title in cur.fetchall()}
            if not module_ids:
                return {}

            cur.execute(
                "SELECT id, module_catalogue_id, title, week_number FROM curriculum.weeks "
                "WHERE module_catalogue_id = ANY(%s) "
                "ORDER BY module_catalogue_id, week_number, display_order",
                "SELECT id, module_catalogue_id, title FROM curriculum.weeks "
                "WHERE module_catalogue_id = ANY(%s)",
                [list(module_ids.values())],
            )
            weeks_by_title = {}   # (cat_id, title)       -> week_id
            weeks_by_number = {}  # (cat_id, week_number) -> week_id (first wins)
            for week_id, cat_id, title, week_number in cur.fetchall():
                weeks_by_title[(cat_id, title)] = week_id
                if week_number is not None:
                    weeks_by_number.setdefault((cat_id, int(week_number)), week_id)
            if not weeks_by_title:
                return {}

            cur.execute(
                "SELECT week_id, type, title, expected_otjh FROM curriculum.components "
                "WHERE week_id = ANY(%s) "
                "ORDER BY week_id, display_order",
                [list(set(weeks_by_title.values()))],
                "SELECT week_id, type, title, expected_otjh FROM curriculum.components "
                "WHERE week_id = ANY(%s)",
                [list(set(week_ids.values()))],
            )
            # Per week: exact display-title -> otjh, and ordered otjh-lists per humanised type.
            otjh_by_exact = {}                 # (week_id, display_title) -> otjh
            otjh_by_type = {}                  # (week_id, type_label)    -> [otjh, ...] in display_order
            for week_id, ctype, title, otjh in cur.fetchall():
                val = float(otjh) if otjh is not None else None
                otjh_by_exact[(week_id, _display_component_title(ctype, title))] = val
                otjh_by_type.setdefault((week_id, _humanise_type(ctype)), []).append(val)
    except DatabaseError as exc:
        logger.warning("Could not look up legacy expected_otjh: %s", exc)
        return {}

    result = {}
    type_cursor = {}  # (week_id, type_label) -> next ordinal to consume
    for c in legacy:
        mod_id = module_ids.get(c["module"])
        week_title = c.get("week")
        # Resolve the live week: exact title first, then by parsed week number.
        week_id = weeks_by_title.get((mod_id, week_title)) if mod_id else None
        if week_id is None and mod_id:
            num = _week_number_from_title(week_title)
            if num is not None:
                week_id = weeks_by_number.get((mod_id, num))

        otjh = None
        if week_id is not None:
            comp_title = c.get("component")
            otjh = otjh_by_exact.get((week_id, comp_title))
            if otjh is None:
                # Title drifted — map by component type + ordinal within the week.
                type_label = _type_prefix_from_component_title(comp_title)
                key = (week_id, type_label)
                idx = type_cursor.get(key, 0)
                candidates = otjh_by_type.get(key, [])
                if idx < len(candidates):
                    otjh = candidates[idx]
                type_cursor[key] = idx + 1

        result[(c.get("module"), c.get("week"), c.get("component"))] = otjh
    return result


def _display_quiz_title(title):
    """Same 'Type · Detail' shape as other components, keyed off the Quiz type."""
    label = "Quiz"
    show_title = bool(title) and title.strip().lower() != label.lower()
    return f"{label} · {title}" if show_title else label


def _resolve_week_ids(weeks):
    """Map each week entry to its real curriculum.weeks id.
    Structured-plan weeks already carry weekId; legacy (pre-id) weeks are
    resolved by module+week title, mirroring _otjh_by_legacy_title."""
    resolved = {}  # (module, week) -> week_id
    legacy = [w for w in weeks if not w.get("weekId") and w.get("module") and w.get("week")]

    for w in weeks:
        if w.get("weekId"):
            resolved[(w.get("module"), w.get("week"))] = w["weekId"]

    if not legacy:
        return resolved

    module_titles = sorted({w["module"] for w in legacy})
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT module_catalogue_id, title FROM curriculum.modules "
                "WHERE title = ANY(%s)",
                [module_titles],
            )
            module_ids = {title: cat_id for cat_id, title in cur.fetchall()}
            if not module_ids:
                return resolved

            cur.execute(
                "SELECT id, module_catalogue_id, title FROM curriculum.weeks "
                "WHERE module_catalogue_id = ANY(%s)",
                [list(module_ids.values())],
            )
            week_ids_by_cat = {(cat_id, title): week_id for week_id, cat_id, title in cur.fetchall()}
    except DatabaseError as exc:
        logger.warning("Could not resolve legacy week ids: %s", exc)
        return resolved

    for w in legacy:
        mod_id = module_ids.get(w["module"])
        week_id = week_ids_by_cat.get((mod_id, w["week"])) if mod_id else None
        if week_id:
            resolved[(w["module"], w["week"])] = week_id
    return resolved


def _append_week_quizzes(weeks, components):
    """Append each week's curriculum.quizzes row (matched by week_id) as the
    last component in that week. A week's plan may have no linked quiz yet
    (quizzes.week_id defaults to '' until authored/linked), in which case
    nothing is appended for it."""
    week_ids_by_key = _resolve_week_ids(weeks)
    ids = sorted({wid for wid in week_ids_by_key.values() if wid})
    if not ids:
        return components

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT id, week_id, title, questions, duration, time_unit FROM curriculum.quizzes "
                "WHERE week_id = ANY(%s)",
                [ids],
            )
            quizzes_by_week_id = {}
            for quiz_id, week_id, title, questions, duration, time_unit in cur.fetchall():
                quizzes_by_week_id.setdefault(week_id, []).append((quiz_id, title, questions, duration, time_unit))
    except DatabaseError as exc:
        logger.warning("Could not look up week quizzes: %s", exc)
        return components

    if not quizzes_by_week_id:
        return components

    existing_quiz_ids = {
        component.get("quizMeta", {}).get("quizId")
        for component in components
        if component.get("isQuiz") and isinstance(component.get("quizMeta"), dict)
    }

    for w in weeks:
        week_id = week_ids_by_key.get((w.get("module"), w.get("week")))
        for quiz_id, title, questions, duration, time_unit in quizzes_by_week_id.get(week_id, []):
            if quiz_id in existing_quiz_ids:
                continue
            components.append({
                "module": w.get("module"), "week": w.get("week"),
                "component": _display_quiz_title(title),
                "moduleId": w.get("moduleId"), "weekId": week_id, "componentId": None,
                "expectedOtjh": None, "isQuiz": True,
                "quizMeta": {"quizId": quiz_id, "questions": questions, "duration": duration, "timeUnit": time_unit},
            })
    return components


def _otjh_status(variance):
    """RAG status from progress_variance (a decimal fraction):
        On track       : variance > -0.05          (-4.999...% and better)
        Need attention : -0.15 < variance <= -0.05  (-5% to -14.999...%)
        At risk        : variance <= -0.15          (-15% and worse)
    With no target yet (variance None) there's nothing to be behind on -> On track.
    """
    if variance is None:
        return "On track"
    if variance > -0.05:
        return "On track"
    if variance > -0.15:
        return "Need attention"
    return "At risk"


def _cumulative_week_target(detail):
    """Planned hours the learner should have reached by the CURRENT week —
    the cumulative sum of expected_otjh for every week up to and including it.

    "Current week" is the first week of the first module (test-data heuristic,
    matching the frontend). CURRENT_WEEK_INDEX bumps this once real scheduling
    lands, making the target accumulate across weeks. Returns a float (hours).
    """
    CURRENT_WEEK_INDEX = 0  # first week; raise as the learner advances

    modules = detail.get("modules") or []
    if not modules:
        return 0.0
    first_module = modules[0]
    # Weeks of the first module, in the order to_learner_detail emitted them.
    week_order = [w["week"] for w in detail.get("week", []) if w.get("module") == first_module]
    if not week_order:
        return 0.0
    target_weeks = set(week_order[: CURRENT_WEEK_INDEX + 1])

    total = 0.0
    for c in detail.get("components", []):
        if c.get("module") == first_module and c.get("week") in target_weeks:
            otjh = c.get("expectedOtjh")
            if otjh:
                total += otjh
    return round(total, 2)


def _resolve_from_master(modules, weeks, components):
    """Rebuild the module -> week -> component tree LIVE from the master
    authoring tables (curriculum.module_authoring_*) so coach edits in the
    Module Builder show up immediately for already-enrolled learners.

    Membership at the MODULE level stays driven by the learner's own snapshot
    (they are enrolled in specific modules). Within each of those modules, the
    weeks + components — their titles, order, and set — come live from master,
    keyed by the ids the snapshot already carries. So renames propagate, and
    weeks/components added or removed in Module Builder appear/disappear here.

    Only structured-plan (id-bearing) modules are resolved. Legacy id-less
    entries pass through unchanged and rely on the existing title-matching
    fallbacks (_otjh_by_legacy_title / _resolve_week_ids). Mixed plans are
    handled module-by-module. On any DB error the snapshot tree is returned
    unchanged — never 500 the page because master is unreachable.
    """
    # Module ids present in the snapshot, keyed to their snapshot title (used
    # as the join key for legacy passthrough and to preserve module order).
    module_ids = []
    for w in weeks:
        mid = w.get("moduleId")
        if mid and mid not in module_ids:
            module_ids.append(mid)
    for c in components:
        mid = c.get("moduleId")
        if mid and mid not in module_ids:
            module_ids.append(mid)

    if not module_ids:
        return modules, weeks, components  # fully legacy plan — nothing to resolve

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT module_catalogue_id, title FROM curriculum.modules "
                "WHERE module_catalogue_id = ANY(%s)",
                [module_ids],
            )
            master_module_title = {mid: title for mid, title in cur.fetchall()}

            cur.execute(
                "SELECT id, module_catalogue_id, title, week_number, display_order "
                "FROM curriculum.weeks WHERE module_catalogue_id = ANY(%s) "
                "ORDER BY module_catalogue_id, display_order, week_number, id",
                [module_ids],
            )
            master_weeks = cur.fetchall()  # [(week_id, module_id, title, week_number, display_order)]

            cur.execute(
                "SELECT id, week_id, module_catalogue_id, type, title, description, settings_json, "
                "live_sessions_link, display_order "
                "FROM curriculum.components WHERE module_catalogue_id = ANY(%s) "
                "ORDER BY week_id, display_order, id",
                [module_ids],
            )
            master_components = cur.fetchall()

            # Quiz components are linked either through settings_json.linkedQuizId
            # (the Module Builder save format) or the normalized link table.
            # Resolve both so learner quiz pages receive isQuiz + quizMeta instead
            # of treating a linked quiz as an ordinary generic component.
            quiz_id_by_component = {}
            component_ids = [row[0] for row in master_components]
            for comp_id, _week_id, _mid, _ctype, _ctitle, _cdesc, settings, _live_link, _order in master_components:
                if isinstance(settings, str):
                    try:
                        settings = json.loads(settings) if settings else {}
                    except (ValueError, TypeError):
                        settings = {}
                if not isinstance(settings, dict):
                    settings = {}
                linked_quiz_id = settings.get("linkedQuizId")
                try:
                    if linked_quiz_id not in (None, ""):
                        quiz_id_by_component[comp_id] = int(linked_quiz_id)
                except (TypeError, ValueError):
                    pass

            if component_ids:
                cur.execute(
                    "SELECT component_id, quiz_id FROM curriculum.quiz_component_links "
                    "WHERE component_id = ANY(%s)",
                    [component_ids],
                )
                for component_id, quiz_id in cur.fetchall():
                    quiz_id_by_component[component_id] = quiz_id

            linked_quiz_ids = sorted(set(quiz_id_by_component.values()))
            quiz_meta_by_id = {}
            if linked_quiz_ids:
                cur.execute(
                    "SELECT id, title, questions, duration, time_unit FROM curriculum.quizzes "
                    "WHERE id = ANY(%s)",
                    [linked_quiz_ids],
                )
                quiz_meta_by_id = {
                    row[0]: {
                        "quizId": row[0],
                        "title": row[1],
                        "questions": row[2],
                        "duration": row[3],
                        "timeUnit": row[4],
                    }
                    for row in cur.fetchall()
                }

            # Authored KSB weight per component. Drives the completion criteria
            # (see COMPONENT_KSB_WEIGHT_TARGET in components.py): a component
            # with KSBs mapped can only be completed once its weights total the
            # target AND the learner has uploaded evidence for it.
            cur.execute(
                "SELECT component_id, COALESCE(SUM(weight), 0), COUNT(*) "
                "FROM curriculum.ksb_mappings "
                "WHERE component_id IS NOT NULL AND module_catalogue_id = ANY(%s) "
                "GROUP BY component_id",
                [module_ids],
            )
            ksb_weight_by_component = {
                row[0]: (float(row[1] or 0), int(row[2] or 0)) for row in cur.fetchall()
            }

            # The individual KSBs authored against each component. The learner
            # no longer picks KSBs by hand on completion — these are applied
            # automatically (see components.py), so the UI shows what will be
            # credited rather than asking.
            cur.execute(
                "SELECT component_id, ksb_code, ksb_description, classification, weight "
                "FROM curriculum.ksb_mappings "
                "WHERE component_id IS NOT NULL AND module_catalogue_id = ANY(%s) "
                "ORDER BY component_id, ksb_code",
                [module_ids],
            )
            ksbs_by_component = {}
            for comp_id, code, description, classification, weight in cur.fetchall():
                ksbs_by_component.setdefault(comp_id, []).append({
                    "code": _s(code),
                    "description": _s(description) or None,
                    "classification": _s(classification) or None,
                    "weight": float(weight or 0),
                })
    except DatabaseError as exc:
        logger.warning("Could not live-resolve training plan from master: %s", exc)
        return modules, weeks, components

    if not master_module_title:
        return modules, weeks, components  # ids no longer exist in master — keep snapshot

    # Group master rows by parent.
    weeks_by_module = {}
    for week_id, mid, title, week_number, _order in master_weeks:
        live_title = _s(title) or f"Week {week_number}"
        weeks_by_module.setdefault(mid, []).append((week_id, live_title))

    comps_by_week = {}
    for comp_id, week_id, _mid, ctype, ctitle, cdesc, settings, stored_live_link, _order in master_components:
        # settings_json comes back from the raw cursor as a JSON string (JSONField
        # auto-parsing only happens through the ORM), so parse it here.
        if isinstance(settings, str):
            try:
                settings = json.loads(settings) if settings else {}
            except (ValueError, TypeError):
                settings = {}
        if not isinstance(settings, dict):
            settings = {}
        live_session_url = (
            _s(stored_live_link)
            or _s(settings.get("liveSessionUrl"))
            or _s(settings.get("teamsMeetingUrl"))
            or None
        )
        video_url = _s(settings.get("videoUrl")) or None
        # Generalised content payload per component type (mirrors the authoring
        # settings_json keys in the Module Builder). Lets the learner open a
        # podcast / reading / slide deck / reflection the same way as a video.
        # Podcast audio may be an external listening-page link (podcastUrl) or an
        # uploaded file (uploadedFileUrl) — either can be a real audio source.
        audio_url = (
            _s(settings.get("podcastUrl"))
            or _s(settings.get("audioUrl"))
            or _s(settings.get("uploadedFileUrl"))
            or None
        )
        content_html = _s(settings.get("readingContent")) or None
        file_name = (
            _s(settings.get("fileName"))
            or _s(settings.get("uploadedFileName"))
            or None
        )
        download_allowed = bool(settings.get("downloadAllowed"))
        reflection_prompt = (
            _s(settings.get("reflectionPrompt"))
            or _s(settings.get("podcastReflectionQuestion"))
            or _s(settings.get("readingReflectionPrompts"))
            or _s(settings.get("learnerGuidance"))
            or None
        )
        # PowerPoint (presentationUrl / uploadedFileUrl) and any other component
        # with an attached link/file all resolve to the same resourceUrl field.
        resource_url = (
            _s(settings.get("resourceUrl"))
            or _s(settings.get("presentationUrl"))
            or _s(settings.get("externalUrl"))
            or _s(settings.get("fileUrl"))
            or _s(settings.get("uploadedFileUrl"))
            or _s(settings.get("url"))
            or None
        )
        duration = settings.get("durationMinutes")
        ksb_weight, ksb_count = ksb_weight_by_component.get(comp_id, (0.0, 0))
        linked_quiz = quiz_meta_by_id.get(quiz_id_by_component.get(comp_id))
        comps_by_week.setdefault(week_id, []).append({
            "componentId": comp_id,
            "display": _display_quiz_title(linked_quiz["title"]) if linked_quiz else _display_component_title(ctype, ctitle),
            "type": ctype,
            "description": _s(cdesc) or None,
            "videoUrl": video_url,
            "audioUrl": audio_url,
            "contentHtml": content_html,
            "fileName": file_name,
            "downloadAllowed": download_allowed,
            "reflectionPrompt": reflection_prompt,
            "resourceUrl": resource_url,
            "liveSessionUrl": live_session_url,
            "sessionDate": _s(settings.get("sessionDate")) or None,
            "sessionTime": _s(settings.get("sessionTime")) or None,
            "sessionDateTimeUtc": _s(settings.get("sessionDateTimeUtc")) or None,
            "durationMinutes": duration if isinstance(duration, (int, float)) else None,
            "ksbWeightTotal": ksb_weight,
            "ksbMappingCount": ksb_count,
            "ksbMappings": ksbs_by_component.get(comp_id, []),
            "isQuiz": bool(linked_quiz),
            "quizMeta": ({
                "quizId": linked_quiz["quizId"],
                "questions": linked_quiz["questions"],
                "duration": linked_quiz["duration"],
                "timeUnit": linked_quiz["timeUnit"],
            } if linked_quiz else None),
        })

    # Distinct snapshot module ids in first-seen order, plus any legacy
    # (id-less) module titles that must still pass through.
    legacy_module_titles = [
        w.get("module") for w in weeks if not w.get("moduleId") and w.get("module")
    ]

    out_modules, out_weeks, out_components = [], [], []
    seen_modules = set()

    for mid in module_ids:
        if mid not in master_module_title:
            continue  # module deleted from master; drop it (full sync)
        live_module = _s(master_module_title[mid])
        # Skip blanks, and dedupe titles that would otherwise collide under the
        # frontend's title-based grouping (keep the first).
        if not live_module or live_module in seen_modules:
            continue
        seen_modules.add(live_module)
        out_modules.append(live_module)

        for week_id, live_wk in weeks_by_module.get(mid, []):
            out_weeks.append({
                "module": live_module, "week": live_wk,
                "moduleId": mid, "weekId": week_id,
            })
            for comp in comps_by_week.get(week_id, []):
                out_components.append({
                    "module": live_module, "week": live_wk,
                    "component": comp["display"],
                    "moduleId": mid, "weekId": week_id, "componentId": comp["componentId"],
                    "type": comp["type"],
                    "description": comp["description"],
                    "videoUrl": comp["videoUrl"],
                    "audioUrl": comp["audioUrl"],
                    "contentHtml": comp["contentHtml"],
                    "fileName": comp["fileName"],
                    "downloadAllowed": comp["downloadAllowed"],
                    "reflectionPrompt": comp["reflectionPrompt"],
                    "resourceUrl": comp["resourceUrl"],
                    "liveSessionUrl": comp["liveSessionUrl"],
                    "sessionDate": comp["sessionDate"],
                    "sessionTime": comp["sessionTime"],
                    "sessionDateTimeUtc": comp["sessionDateTimeUtc"],
                    "durationMinutes": comp["durationMinutes"],
                    "ksbWeightTotal": comp["ksbWeightTotal"],
                    "ksbMappingCount": comp["ksbMappingCount"],
                    "ksbMappings": comp["ksbMappings"],
                    "isQuiz": comp["isQuiz"],
                    "quizMeta": comp["quizMeta"],
                })

    # Preserve legacy (id-less) modules unchanged so pre-structured-format
    # learners are unaffected.
    for legacy_title in legacy_module_titles:
        if legacy_title in seen_modules:
            continue
        seen_modules.add(legacy_title)
        out_modules.append(legacy_title)
        out_weeks.extend(w for w in weeks if not w.get("moduleId") and w.get("module") == legacy_title)
        out_components.extend(
            c for c in components if not c.get("moduleId") and c.get("module") == legacy_title
        )

    return out_modules, out_weeks, out_components


def _annotate_otjh(components):
    """Attach expectedOtjh (hours, float|None) to each component dict. Prefers
    an exact componentId match (structured-plan saves); falls back to title
    matching only for components saved before that format existed. Returns
    (annotated_components, total_hours)."""
    if not components:
        return components, 0.0

    otjh_by_id = _otjh_by_component_id(components)
    otjh_by_legacy_key = _otjh_by_legacy_title(components)

    total = 0.0
    for c in components:
        cid = c.get("componentId")
        if cid:
            otjh = otjh_by_id.get(cid)
        else:
            otjh = otjh_by_legacy_key.get((c.get("module"), c.get("week"), c.get("component")))
        c["expectedOtjh"] = otjh
        if otjh:
            total += otjh
    return components, round(total, 2)


def learner_detail(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        source = model.objects.get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    try:
        learner_profile = LearnerProfile.objects.filter(id=pk, lifecycle_status="active").first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    detail = to_learner_detail(source, learner_profile)
    # Live-resolve titles + membership from the master authoring tables so coach
    # edits in Module Builder reflect here immediately (structured-plan learners).
    detail["modules"], detail["week"], detail["components"] = _resolve_from_master(
        detail["modules"], detail["week"], detail["components"]
    )
    detail["components"], detail["totalExpectedOtjh"] = _annotate_otjh(detail["components"])
    detail["components"] = _append_week_quizzes(detail["week"], detail["components"])

    # Persist the plan's planned hours + the learner's completed hours onto the
    # learner profile so the columns stay current as the plan/progress change,
    # and echo them back so the card reads the same stored values.
    planned = fmt_hours(detail.get("totalExpectedOtjh") or 0)
    completed = completed_hours_from_progress(learner_profile.training_plan_progress) if learner_profile else "0"

    # Target = cumulative planned hours up to & including the CURRENT week (first
    # week of the first module, matching the frontend heuristic; grows week by
    # week as scheduling advances). Then:
    #   progress_hours    = completed - target
    #   progress_variance = (completed - target) / target   (None when target=0)
    target_num = _cumulative_week_target(detail)
    completed_num = float(completed) if completed else 0.0
    progress_hours_num = round(completed_num - target_num, 2)
    variance = round((completed_num - target_num) / target_num, 2) if target_num else None

    target_str = fmt_hours(target_num)
    progress_hours_str = fmt_hours(progress_hours_num) if progress_hours_num >= 0 else f"-{fmt_hours(abs(progress_hours_num))}"
    variance_str = "" if variance is None else str(variance)
    variance_db = None if variance is None else variance
    otjh_status = _otjh_status(variance)

    detail["plannedHours"] = planned
    detail["completedHours"] = completed
    detail["targetHours"] = target_str
    detail["progressHours"] = progress_hours_str
    detail["progressVariance"] = variance_str
    detail["otjhStatus"] = otjh_status
    if learner_profile is not None:
        try:
            calculated = {
                "planned_hours": planned,
                "completed_hours": completed,
                "target_hours": target_str,
                "progress_hours": progress_hours_str,
                "progress_variance": variance_db,
                "otjh_status": otjh_status,
            }
            changed_fields = []
            for field, value in calculated.items():
                if getattr(learner_profile, field) != value:
                    setattr(learner_profile, field, value)
                    changed_fields.append(field)
            # This endpoint is read on almost every learner page. Avoid a
            # remote database UPDATE when all calculated values are unchanged.
            if changed_fields:
                learner_profile.save(update_fields=changed_fields)
        except DatabaseError as exc:
            logger.warning("Could not persist hours columns for learner %s: %s", pk, exc)

    return JsonResponse(detail)
