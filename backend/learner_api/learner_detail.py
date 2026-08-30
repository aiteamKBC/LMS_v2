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
from datetime import timedelta
from html import unescape
from pathlib import Path
from urllib.parse import urlparse

from django.db import DatabaseError, connections
from django.db.models import prefetch_related_objects
from django.http import JsonResponse
from django.utils import timezone

from .active_users import completed_hours_from_progress, fmt_hours, hydrate_source_training_plan
from .identity import learner_profile_for_source
from .learner_progression import advance_learner
from .mappers import _s, to_learner_detail
from .models import EnrolmentUser, LearnerProfile

logger = logging.getLogger(__name__)

#: An uploaded file only counts as a component's audio when it is one of these.
AUDIO_FILE_SUFFIXES = {'.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus', '.wma'}


def component_audio_url(settings, component_type):
    """The audio a component should offer, or None.

    ``uploadedFileUrl`` is the generic "file attached to this component" key: on
    a reading it is the PDF, on a slide deck the .pptx. Treating it as audio put
    an empty player under every reading with an attachment, pointed at a
    document — so it only counts for a podcast, or when the file itself is audio.
    """
    settings = settings if isinstance(settings, dict) else {}
    explicit = _s(settings.get("podcastUrl")) or _s(settings.get("audioUrl"))
    if explicit:
        return explicit
    uploaded = _s(settings.get("uploadedFileUrl"))
    if not uploaded:
        return None
    if component_type == "podcast":
        return uploaded
    suffix = Path(urlparse(uploaded).path).suffix.lower()
    return uploaded if suffix in AUDIO_FILE_SUFFIXES else None

# The enrolment record is the source: every learner exists in
# enrolment."Created_users" from the moment they are created, whereas the
# "Learner"."learners" profile only appears once enrolment is finished. Reading
# the source here is what lets a still-onboarding learner load their page at all
# (and carry a real programmeStatus, so the onboarding redirect can fire).
# `kind` remains in the URL for backwards-compatible frontend routes; ids are
# unique across the single table, so both resolve the same way.
SOURCE_MODELS = {
    "commercial": EnrolmentUser,
    "apprenticeship": EnrolmentUser,
}

IFRAME_SRC_RE = re.compile(r"<iframe[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)


def _active_profile_for_source(source, source_pk):
    """Resolve the active mirror after enrolment tables were consolidated.

    ``Created_users`` and ``Learner.learners`` have independent primary-key
    sequences, so their ids are no longer guaranteed to match.  Email is the
    shared learner identity; the id lookup remains only as a compatibility
    fallback for older records that do not have an email.
    """
    profile = learner_profile_for_source(source, source_pk, active_only=True)
    if profile is None:
        return None

    # The detail serializer walks progress -> KSB links -> quiz answers and
    # their selected/correct answers.  Without prefetching, that becomes one
    # database round-trip per progress row/answer (and the OTJ calculation
    # reads the same graph again).  Load the complete graph in a fixed number
    # of queries so learner pages stay fast as their history grows.
    try:
        # ``Learner.learner_ksbs`` was the legacy per-learner snapshot and is
        # absent from current environments. Do not prefetch it unconditionally:
        # the LearnerProfile.ksbs compatibility property will query it lazily
        # only when an older profile has no current KSB assignment.
        prefetch_related_objects(
            [profile],
            "ksb_assignment__profile_version__definitions",
            "progress_entries__ksb_links",
            "progress_entries__quiz_answers__chosen_answers",
            "progress_entries__quiz_answers__correct_answers",
        )
    except AttributeError:
        logger.warning("Could not prefetch learner detail graph for profile %s.", source_pk, exc_info=True)
    return profile


def _normalise_weight_class(value, classification=""):
    raw = _s(value).lower()
    if raw in {"hard", "soft", "possible"}:
        return raw
    classification = _s(classification).lower()
    if classification == "main":
        return "hard"
    if classification == "possible":
        return "possible"
    return "soft"


def _component_ksb_items(value):
    if isinstance(value, str):
        try:
            value = json.loads(value) if value else []
        except (TypeError, ValueError):
            value = []
    if not isinstance(value, list):
        return []
    items = []
    seen = set()
    for mapping in value:
        if not isinstance(mapping, dict):
            continue
        code = _s(mapping.get("code") or mapping.get("ksbCode") or mapping.get("ksb_code")).upper()
        if not code or code in seen:
            continue
        seen.add(code)
        classification = _s(mapping.get("classification") or mapping.get("type")) or None
        weight = mapping.get("weight")
        try:
            weight = float(weight or 0)
        except (TypeError, ValueError):
            weight = 0.0
        items.append({
            "code": code,
            "description": _s(mapping.get("description") or mapping.get("ksbDescription") or mapping.get("ksb_description")) or None,
            "classification": classification,
            "weight": weight,
            "weightClass": _normalise_weight_class(
                mapping.get("weightClass") if "weightClass" in mapping else mapping.get("weight_class"),
                classification,
            ),
        })
    return items


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


_MODULE_ASSESSMENTS_WEEK_LABEL = "Module assessments"


def _module_assessment_week_id(module_id):
    return f"quiz-module-assessments::{module_id or 'legacy'}"


def _normalise_quiz_scope_value(value):
    return _s(value).strip().lower()


def _matching_module_ids_for_quiz_record(quiz_record, modules_by_id, explicit_module_ids):
    scoped_explicit = [module_id for module_id in explicit_module_ids if module_id in modules_by_id]
    if scoped_explicit:
        return scoped_explicit

    quiz_module = _normalise_quiz_scope_value(quiz_record.get("module"))
    quiz_programme_id = _normalise_quiz_scope_value(quiz_record.get("programme_id"))
    quiz_programme = _normalise_quiz_scope_value(quiz_record.get("programme"))
    if not quiz_module:
        return []

    exact_matches = []
    fuzzy_matches = []
    for module_id, meta in modules_by_id.items():
        module_name = _normalise_quiz_scope_value(meta.get("module"))
        if not module_name:
            continue
        module_matches_exact = module_name == quiz_module
        module_matches_fuzzy = module_matches_exact or quiz_module in module_name or module_name in quiz_module
        if not module_matches_fuzzy:
            continue

        programme_matches = False
        if quiz_programme_id and _normalise_quiz_scope_value(meta.get("programmeId")) == quiz_programme_id:
            programme_matches = True
        elif quiz_programme and (
            _normalise_quiz_scope_value(meta.get("programme")) == quiz_programme
            or _normalise_quiz_scope_value(meta.get("programmeId")) == quiz_programme
        ):
            programme_matches = True
        elif not quiz_programme_id and not quiz_programme:
            programme_matches = True

        if not programme_matches:
            continue
        if module_matches_exact:
            exact_matches.append(module_id)
        else:
            fuzzy_matches.append(module_id)

    if exact_matches:
        return exact_matches
    if fuzzy_matches:
        if quiz_programme_id or quiz_programme:
            return fuzzy_matches
        programme_keys = {
            (
                _normalise_quiz_scope_value(modules_by_id[module_id].get("programmeId")),
                _normalise_quiz_scope_value(modules_by_id[module_id].get("programme")),
            )
            for module_id in fuzzy_matches
        }
        if len(programme_keys) == 1:
            return fuzzy_matches
    return []


def _append_week_quizzes(weeks, components):
    """Append published quizzes for the learner's weeks/modules.

    Visibility now honours explicit module assignments (curriculum.quiz_course_links)
    and falls back to the quiz's own programme/module metadata when older records
    were never backfilled into the link table. When no valid real week can be
    resolved, quizzes land in a synthetic "Module assessments" bucket inside the
    assigned module instead of silently disappearing.
    """
    week_ids_by_key = _resolve_week_ids(weeks)
    resolved_week_ids = sorted({week_id for week_id in week_ids_by_key.values() if week_id})
    weeks_by_module_id = {}
    module_order = []
    module_titles_by_id = {}
    for week in weeks:
        module_id = _s(week.get("moduleId"))
        if not module_id:
            continue
        if module_id not in module_order:
            module_order.append(module_id)
        module_titles_by_id.setdefault(module_id, _s(week.get("module")))
        weeks_by_module_id.setdefault(module_id, []).append({
            "weekId": week_ids_by_key.get((week.get("module"), week.get("week"))) or _s(week.get("weekId")),
            "week": _s(week.get("week")),
            "module": _s(week.get("module")),
        })

    if not resolved_week_ids and not module_order:
        return weeks, components

    modules_by_id = {}
    explicit_module_ids_by_quiz = {}
    explicit_week_ids_by_quiz_module = {}
    quiz_rows_by_id = {}

    def store_quiz_rows(rows):
        for row in rows:
            quiz_rows_by_id[row[0]] = {
                "id": row[0],
                "weekId": _s(row[1]),
                "title": _s(row[2]),
                "questions": row[3],
                "duration": row[4],
                "timeUnit": row[5],
                "programme_id": _s(row[6]),
                "programme": _s(row[7]),
                "module": _s(row[8]),
            }

    try:
        with connections["enrolment"].cursor() as cur:
            if module_order:
                cur.execute(
                    """
                    SELECT module_catalogue_id, title, COALESCE(programme_id, ''), COALESCE(programme_name, '')
                    FROM curriculum.modules
                    WHERE module_catalogue_id = ANY(%s)
                    """,
                    [module_order],
                )
                for module_id, module_title, programme_id, programme_name in cur.fetchall():
                    module_id = _s(module_id)
                    if not module_id:
                        continue
                    modules_by_id[module_id] = {
                        "module": _s(module_title) or module_titles_by_id.get(module_id) or module_id,
                        "programmeId": _s(programme_id),
                        "programme": _s(programme_name),
                    }
            if resolved_week_ids:
                cur.execute(
                    """
                    SELECT id, week_id, title, questions, duration, time_unit,
                           COALESCE(programme_id, ''), COALESCE(programme, ''), COALESCE(module, '')
                    FROM curriculum.quizzes
                    WHERE lower(COALESCE(status, '')) = 'published'
                      AND week_id = ANY(%s)
                    """,
                    [resolved_week_ids],
                )
                store_quiz_rows(cur.fetchall())
            if module_order:
                try:
                    cur.execute(
                        """
                        SELECT quiz_id, module_catalogue_id, COALESCE(week_id, '')
                        FROM curriculum.quiz_course_links
                        WHERE module_catalogue_id = ANY(%s)
                        """,
                        [module_order],
                    )
                    for quiz_id, module_id, week_id in cur.fetchall():
                        module_id = _s(module_id)
                        if module_id:
                            explicit_module_ids_by_quiz.setdefault(quiz_id, set()).add(module_id)
                            explicit_week_ids_by_quiz_module.setdefault(quiz_id, {})[module_id] = _s(week_id)
                except DatabaseError:
                    explicit_module_ids_by_quiz = {}
                    explicit_week_ids_by_quiz_module = {}

                explicit_quiz_ids = sorted(explicit_module_ids_by_quiz)
                if explicit_quiz_ids:
                    cur.execute(
                        """
                        SELECT id, week_id, title, questions, duration, time_unit,
                               COALESCE(programme_id, ''), COALESCE(programme, ''), COALESCE(module, '')
                        FROM curriculum.quizzes
                        WHERE lower(COALESCE(status, '')) = 'published'
                          AND id = ANY(%s)
                        """,
                        [explicit_quiz_ids],
                    )
                    store_quiz_rows(cur.fetchall())

                module_titles = sorted({
                    _normalise_quiz_scope_value(meta.get("module"))
                    for meta in modules_by_id.values()
                    if _normalise_quiz_scope_value(meta.get("module"))
                })
                if module_titles:
                    cur.execute(
                        """
                        SELECT id, week_id, title, questions, duration, time_unit,
                               COALESCE(programme_id, ''), COALESCE(programme, ''), COALESCE(module, '')
                        FROM curriculum.quizzes
                        WHERE lower(COALESCE(status, '')) = 'published'
                          AND lower(COALESCE(module, '')) = ANY(%s)
                        """,
                        [module_titles],
                    )
                    store_quiz_rows(cur.fetchall())
    except DatabaseError as exc:
        logger.warning("Could not look up learner-visible quizzes: %s", exc)
        return weeks, components

    if not quiz_rows_by_id:
        return weeks, components

    week_quizzes_by_week_id = {}
    module_level_quizzes_by_module_id = {}
    for quiz in quiz_rows_by_id.values():
        explicit_module_ids = explicit_module_ids_by_quiz.get(quiz["id"], set())
        explicit_week_ids_by_module = explicit_week_ids_by_quiz_module.get(quiz["id"], {})
        matched_module_ids = _matching_module_ids_for_quiz_record(quiz, modules_by_id, explicit_module_ids)
        placed_module_ids = set()
        for module_id in matched_module_ids:
            module_week_ids = {
                item["weekId"]
                for item in weeks_by_module_id.get(module_id, [])
                if item.get("weekId")
            }
            explicit_week_id = _s(explicit_week_ids_by_module.get(module_id))
            target_week_id = ""
            if explicit_week_id and explicit_week_id in module_week_ids:
                target_week_id = explicit_week_id
            elif quiz["weekId"] and quiz["weekId"] in module_week_ids:
                target_week_id = quiz["weekId"]
            if target_week_id:
                week_quizzes_by_week_id.setdefault(target_week_id, []).append(quiz)
                placed_module_ids.add(module_id)
        if not matched_module_ids and quiz["weekId"] and quiz["weekId"] in resolved_week_ids:
            week_quizzes_by_week_id.setdefault(quiz["weekId"], []).append(quiz)
            continue
        for module_id in matched_module_ids:
            if module_id in placed_module_ids:
                continue
            module_level_quizzes_by_module_id.setdefault(module_id, []).append(quiz)

    if not week_quizzes_by_week_id and not module_level_quizzes_by_module_id:
        return weeks, components

    next_weeks = list(weeks)
    next_components = list(components)
    seen_positions = set()
    for component in next_components:
        quiz_meta = component.get("quizMeta")
        if not component.get("isQuiz") or not isinstance(quiz_meta, dict):
            continue
        quiz_id = quiz_meta.get("quizId")
        if quiz_id is None:
            continue
        seen_positions.add((
            _s(component.get("moduleId")) or _s(component.get("module")),
            _s(component.get("weekId")) or _s(component.get("week")),
            str(quiz_id),
        ))

    for week in weeks:
        module_id = _s(week.get("moduleId")) or _s(week.get("module"))
        week_id = week_ids_by_key.get((week.get("module"), week.get("week"))) or _s(week.get("weekId"))
        for quiz in week_quizzes_by_week_id.get(week_id, []):
            key = (module_id, week_id or _s(week.get("week")), str(quiz["id"]))
            if key in seen_positions:
                continue
            next_components.append({
                "module": week.get("module"),
                "week": week.get("week"),
                "component": _display_quiz_title(quiz["title"]),
                "moduleId": week.get("moduleId"),
                "weekId": week_id,
                "componentId": None,
                "expectedOtjh": None,
                "isQuiz": True,
                "quizMeta": {
                    "quizId": quiz["id"],
                    "questions": quiz["questions"],
                    "duration": quiz["duration"],
                    "timeUnit": quiz["timeUnit"],
                },
            })
            seen_positions.add(key)

    existing_week_ids = {_s(week.get("weekId")) for week in next_weeks if _s(week.get("weekId"))}
    for module_id in module_order:
        queued = module_level_quizzes_by_module_id.get(module_id, [])
        if not queued:
            continue
        module_title = modules_by_id.get(module_id, {}).get("module") or module_titles_by_id.get(module_id) or module_id
        synthetic_week_id = _module_assessment_week_id(module_id)
        if synthetic_week_id not in existing_week_ids:
            next_weeks.append({
                "module": module_title,
                "week": _MODULE_ASSESSMENTS_WEEK_LABEL,
                "moduleId": module_id,
                "weekId": synthetic_week_id,
            })
            existing_week_ids.add(synthetic_week_id)
        for quiz in queued:
            key = (module_id, synthetic_week_id, str(quiz["id"]))
            if key in seen_positions:
                continue
            next_components.append({
                "module": module_title,
                "week": _MODULE_ASSESSMENTS_WEEK_LABEL,
                "component": _display_quiz_title(quiz["title"]),
                "moduleId": module_id,
                "weekId": synthetic_week_id,
                "componentId": None,
                "expectedOtjh": None,
                "isQuiz": True,
                "quizMeta": {
                    "quizId": quiz["id"],
                    "questions": quiz["questions"],
                    "duration": quiz["duration"],
                    "timeUnit": quiz["timeUnit"],
                },
            })
            seen_positions.add(key)

    return next_weeks, next_components


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


def _week_target_rows(detail):
    weeks = detail.get("week") or []
    if not weeks:
        return []

    totals_by_week = {}
    for component in detail.get("components", []):
        key = (
            component.get("module"),
            component.get("week"),
            component.get("moduleId"),
            component.get("weekId"),
        )
        totals_by_week[key] = round(totals_by_week.get(key, 0.0) + float(component.get("expectedOtjh") or 0.0), 2)

    return [
        {
            "module": week.get("module"),
            "week": week.get("week"),
            "moduleId": week.get("moduleId"),
            "weekId": week.get("weekId"),
            "otjh": totals_by_week.get(
                (
                    week.get("module"),
                    week.get("week"),
                    week.get("moduleId"),
                    week.get("weekId"),
                ),
                0.0,
            ),
        }
        for week in weeks
    ]


def _sequential_week_target(week_rows, learner_start_date=None, today=None):
    if not week_rows:
        return 0.0
    if learner_start_date is None:
        return round(float(week_rows[0].get("otjh") or 0.0), 2)
    today = today or timezone.localdate()
    weeks_elapsed = max(0, (today - learner_start_date).days // 7)
    return round(sum(float(row.get("otjh") or 0.0) for row in week_rows[: weeks_elapsed + 1]), 2)


def _schedule_based_week_target(week_rows, module_start_by_id, week_offset_by_id, today=None):
    if not week_rows:
        return None
    today = today or timezone.localdate()
    total = 0.0
    has_schedule = False
    for row in week_rows:
        module_id = row.get("moduleId")
        week_id = row.get("weekId")
        start_date = module_start_by_id.get(module_id)
        offset = week_offset_by_id.get(week_id)
        if start_date is None or offset is None:
            continue
        has_schedule = True
        week_start = start_date + timedelta(days=offset * 7)
        if week_start <= today:
            total += float(row.get("otjh") or 0.0)
    return round(total, 2) if has_schedule else None


def _cumulative_week_target(detail, learner_start_date=None, today=None):
    """Planned hours the learner should have reached by today.

    Primary path: use each module's authored start_date plus the week's
    display_order from curriculum.weeks, summing every week whose scheduled
    start is on or before today.

    Fallback: when schedule metadata is incomplete, use the learner's own
    start_date and the saved week order as a sequential week-by-week pace.
    """
    week_rows = _week_target_rows(detail)
    if not week_rows:
        return 0.0

    module_ids = sorted({row.get("moduleId") for row in week_rows if row.get("moduleId")})
    week_ids = sorted({row.get("weekId") for row in week_rows if row.get("weekId")})
    module_start_by_id = {}
    week_offset_by_id = {}

    if module_ids and week_ids:
        try:
            with connections["enrolment"].cursor() as cur:
                cur.execute(
                    "SELECT module_catalogue_id, start_date FROM curriculum.modules "
                    "WHERE module_catalogue_id = ANY(%s)",
                    [module_ids],
                )
                module_start_by_id = {module_id: start_date for module_id, start_date in cur.fetchall() if start_date}

                cur.execute(
                    "SELECT id, display_order, week_number FROM curriculum.weeks "
                    "WHERE id = ANY(%s)",
                    [week_ids],
                )
                for week_id, display_order, week_number in cur.fetchall():
                    if display_order is not None:
                        week_offset_by_id[week_id] = max(int(display_order), 0)
                    elif week_number is not None:
                        week_offset_by_id[week_id] = max(int(week_number) - 1, 0)
        except DatabaseError as exc:
            logger.warning("Could not resolve week schedule metadata for OTJ target: %s", exc)

    scheduled_target = _schedule_based_week_target(
        week_rows,
        module_start_by_id,
        week_offset_by_id,
        today=today,
    )
    if scheduled_target is not None:
        return scheduled_target

    total = _sequential_week_target(week_rows, learner_start_date=learner_start_date, today=today)
    return round(total, 2)


def _live_otjh_snapshot(detail, learner_profile=None):
    planned = fmt_hours(detail.get("totalExpectedOtjh") or 0)
    completed = (
        completed_hours_from_progress(
            learner_profile.training_plan_progress,
            detail.get("components"),
        )
        if learner_profile
        else "0"
    )

    target_num = _cumulative_week_target(
        detail,
        learner_start_date=getattr(learner_profile, "start_date", None),
    )
    completed_num = float(completed) if completed else 0.0
    progress_hours_num = round(completed_num - target_num, 2)
    variance = round((completed_num - target_num) / target_num, 2) if target_num else None

    target_str = fmt_hours(target_num)
    progress_hours_str = fmt_hours(progress_hours_num) if progress_hours_num >= 0 else f"-{fmt_hours(abs(progress_hours_num))}"
    variance_str = "" if variance is None else str(variance)
    variance_db = None if variance is None else variance
    otjh_status = _otjh_status(variance)

    return {
        "planned_hours": planned,
        "completed_hours": completed,
        "target_hours": target_str,
        "progress_hours": progress_hours_str,
        "progress_variance": variance_db,
        "otjh_status": otjh_status,
        "plannedHours": planned,
        "completedHours": completed,
        "targetHours": target_str,
        "progressHours": progress_hours_str,
        "progressVariance": variance_str,
        "otjhStatus": otjh_status,
    }


def _apply_live_otjh_snapshot(detail, snapshot):
    detail["plannedHours"] = snapshot["plannedHours"]
    detail["completedHours"] = snapshot["completedHours"]
    detail["targetHours"] = snapshot["targetHours"]
    detail["progressHours"] = snapshot["progressHours"]
    detail["progressVariance"] = snapshot["progressVariance"]
    detail["otjhStatus"] = snapshot["otjhStatus"]
    return detail


def _normalized_snapshot_value(value):
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def persist_live_otjh_snapshot(learner_profile, snapshot):
    if learner_profile is None:
        return []

    calculated = {
        "planned_hours": snapshot["planned_hours"],
        "completed_hours": snapshot["completed_hours"],
        "target_hours": snapshot["target_hours"],
        "progress_hours": snapshot["progress_hours"],
        "progress_variance": snapshot["progress_variance"],
        "otjh_status": snapshot["otjh_status"],
    }
    changed_fields = []
    for field, value in calculated.items():
        if _normalized_snapshot_value(getattr(learner_profile, field, None)) != _normalized_snapshot_value(value):
            setattr(learner_profile, field, value)
            changed_fields.append(field)
    if changed_fields:
        learner_profile.save(update_fields=changed_fields)
    return changed_fields


def refresh_learner_otjh_snapshot(learner_profile, *, source=None, detail=None):
    if learner_profile is None:
        return {}

    resolved_source = source or learner_profile
    resolved_detail = detail
    if resolved_detail is None:
        resolved_detail = to_learner_detail(resolved_source, learner_profile)
        resolved_detail["modules"], resolved_detail["week"], resolved_detail["components"] = _resolve_from_master(
            resolved_detail["modules"], resolved_detail["week"], resolved_detail["components"]
        )
        resolved_detail["components"], resolved_detail["totalExpectedOtjh"] = _annotate_otjh(resolved_detail["components"])
        resolved_detail["week"], resolved_detail["components"] = _append_week_quizzes(
            resolved_detail["week"],
            resolved_detail["components"],
        )

    snapshot = _live_otjh_snapshot(resolved_detail, learner_profile)
    _apply_live_otjh_snapshot(resolved_detail, snapshot)
    persist_live_otjh_snapshot(learner_profile, snapshot)
    return snapshot


def _authored_source_type(settings):
    """Which source an author chose for a component: a link, or an upload.

    The builder writes it as `powerpointSource` (or `uploadSource`), and rows
    that came through the older authoring path carry it inside `legacySettings`,
    which is itself a JSON string. Both are read, because both exist in the data.
    """
    for key in ("powerpointSource", "uploadSource"):
        value = _s(settings.get(key))
        if value:
            return value
    legacy = settings.get("legacySettings")
    if isinstance(legacy, str):
        try:
            legacy = json.loads(legacy)
        except ValueError:
            legacy = None
    if isinstance(legacy, dict):
        for key in ("powerpointSource", "uploadSource"):
            value = _s(legacy.get(key))
            if value:
                return value
    return ""


# Every way a component can name its attached document, in the order they are
# tried when nothing says which the author meant.
_RESOURCE_URL_KEYS = (
    "resourceUrl",
    "presentationUrl",
    "externalUrl",
    "fileUrl",
    "uploadedFileUrl",
    "url",
)
# The same keys with the file we host first, for a component whose author chose
# to upload one.
_UPLOADED_FIRST_KEYS = (
    "uploadedFileUrl",
    "fileUrl",
    "resourceUrl",
    "presentationUrl",
    "externalUrl",
    "url",
)


def _component_resource_url(settings):
    """The document a learner should be shown for this component.

    A component can hold both a link and an uploaded file: switching source type
    in the builder leaves the other field exactly as it was, so a deck uploaded
    after a link was tried keeps that link on the record. The author's chosen
    source is therefore what decides which one is served — reading the link first
    regardless showed the learner a document they have no access to (a personal
    SharePoint share, say) while the real deck sat uploaded beside it.

    With no source recorded — every bulk-imported row — the original order
    stands; those carry the same hosted path in both fields anyway.
    """
    uploaded = "upload" in _authored_source_type(settings).casefold()
    keys = _UPLOADED_FIRST_KEYS if uploaded else _RESOURCE_URL_KEYS
    for key in keys:
        value = _s(settings.get(key))
        if value:
            return value
    return None


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
                "live_sessions_link, display_order, ksb_mappings, reflection_required, \"Reflection_Question\" "
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
            for comp_id, _week_id, _mid, _ctype, _ctitle, _cdesc, settings, _live_link, _order, _ksb_mappings, _reflection_required, _reflection_question in master_components:
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

            # Authored KSB weight per component. Used to calculate and display
            # weighted KSB progress; it does not block activity completion.
            ksbs_by_component = {}
            for comp_id, _week_id, _mid, _ctype, _ctitle, _cdesc, _settings, _live_link, _order, ksb_mappings, _reflection_required, _reflection_question in master_components:
                items = _component_ksb_items(ksb_mappings)
                if items:
                    ksbs_by_component[comp_id] = items

            # The individual KSBs authored against each component. The learner
            # no longer picks KSBs by hand on completion — these are applied
            # automatically (see components.py), so the UI shows what will be
            # credited rather than asking.
            missing_ksb_component_ids = [component_id for component_id in component_ids if component_id not in ksbs_by_component]
            if missing_ksb_component_ids:
                cur.execute(
                    "SELECT component_id, ksb_code, ksb_description, classification, weight, weight_class "
                    "FROM curriculum.ksb_mappings "
                    "WHERE component_id = ANY(%s) "
                    "AND deleted_at IS NULL AND COALESCE(is_programme_deleted, false) = false "
                    "ORDER BY component_id, ksb_code",
                    [missing_ksb_component_ids],
                )
                for comp_id, code, description, classification, weight, weight_class in cur.fetchall():
                    ksbs_by_component.setdefault(comp_id, []).append({
                        "code": _s(code),
                        "description": _s(description) or None,
                        "classification": _s(classification) or None,
                        "weight": float(weight or 0),
                        "weightClass": _normalise_weight_class(weight_class, classification),
                    })
            ksb_weight_by_component = {
                component_id: (sum(float(item.get("weight") or 0) for item in items), len(items))
                for component_id, items in ksbs_by_component.items()
            }
            audit_sources_by_component = _audit_sources_by_component_id(component_ids)
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
    for comp_id, week_id, _mid, ctype, ctitle, cdesc, settings, stored_live_link, _order, _ksb_mappings, reflection_required, reflection_question in master_components:
        # settings_json comes back from the raw cursor as a JSON string (JSONField
        # auto-parsing only happens through the ORM), so parse it here.
        if isinstance(settings, str):
            try:
                settings = json.loads(settings) if settings else {}
            except (ValueError, TypeError):
                settings = {}
        if not isinstance(settings, dict):
            settings = {}
        audit_source = audit_sources_by_component.get(comp_id, {})
        audit_settings = audit_source.get("settings") if isinstance(audit_source.get("settings"), dict) else {}
        audit_raw = audit_source.get("rawComponent") if isinstance(audit_source.get("rawComponent"), dict) else {}
        audit_url = (
            _s(audit_source.get("sourceUrl"))
            or _s(audit_source.get("embedUrl"))
            or _s(audit_settings.get("videoUrl"))
            or _s(audit_settings.get("audioUrl"))
            or _s(audit_settings.get("podcastUrl"))
            or _s(audit_settings.get("resourceUrl"))
            or _s(audit_settings.get("uploadedFileUrl"))
            or _s(audit_raw.get("videoUrl"))
            or _s(audit_raw.get("resourceUrl"))
        )
        live_session_url = (
            _s(stored_live_link)
            or _s(settings.get("liveSessionUrl"))
            or _s(settings.get("teamsMeetingUrl"))
            or None
        )
        normalised_type = _s(ctype).strip().lower().replace("-", "_")
        audit_kind = _s(audit_source.get("contentKind")).strip().lower().replace("-", "_")
        video_url = _s(settings.get("videoUrl")) or (audit_url if normalised_type == "video" or audit_kind == "video" else "") or None
        # Generalised content payload per component type (mirrors the authoring
        # settings_json keys in the Module Builder). Lets the learner open a
        # podcast / reading / slide deck / reflection the same way as a video.
        # Podcast audio may be an external listening-page link (podcastUrl) or an
        # uploaded file (uploadedFileUrl) — either can be a real audio source.
        #
        audio_url = component_audio_url(settings, ctype) or (audit_url if normalised_type == "podcast" or audit_kind == "audio" else None)
        content_html = _s(settings.get("readingContent")) or None
        file_name = (
            _s(settings.get("fileName"))
            or _s(settings.get("uploadedFileName"))
            or _s(audit_source.get("fileName"))
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
        # with an attached link/file all resolve to the same resourceUrl field,
        # picking the one the author actually chose — see _component_resource_url.
        resource_url = _component_resource_url(settings) or (audit_url if not video_url and not audio_url else None)
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
            "reflectionRequired": bool(reflection_required),
            "reflectionQuestion": _s(reflection_question) or None,
            "resourceUrl": resource_url,
            "liveSessionUrl": live_session_url,
            "teamsLiveSessionId": _s(settings.get("teamsLiveSessionId")) or None,
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
                    "reflectionRequired": comp["reflectionRequired"],
                    "reflectionQuestion": comp["reflectionQuestion"],
                    "resourceUrl": comp["resourceUrl"],
                    "liveSessionUrl": comp["liveSessionUrl"],
                    "teamsLiveSessionId": comp["teamsLiveSessionId"],
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


def build_learner_detail(source, pk):
    """The learner's full workspace payload for one already-loaded source row.

    Split out of the view so other callers can serve the same shape behind their
    own authorisation — the employer portal shows an employer their own learner's
    plan, hours and KSBs without reimplementing any of this. Raises DatabaseError;
    callers decide what that means for their response.
    """
    # Date-based activation has no user action of its own. Re-checking here
    # keeps the learner workspace correct between scheduled daily sweeps.
    advance_learner(source)
    # Plans selected during enrolment used to contain only module ids. Fill
    # in the authored weeks/components before serialising the learner page,
    # which also repairs learners activated before this behaviour existed.
    hydrate_source_training_plan(source)
    learner_profile = _active_profile_for_source(source, pk)

    if learner_profile and not learner_profile.ksbs:
        try:
            from .active_users import refresh_learner_ksb_snapshot

            refresh_learner_ksb_snapshot(learner_profile, source)
            learner_profile = LearnerProfile.objects.filter(
                id=learner_profile.id,
                lifecycle_status="active",
            ).first()
        except DatabaseError as exc:
            logger.warning("Could not refresh learner KSB snapshot for %s: %s", pk, exc)

    detail = to_learner_detail(source, learner_profile)
    # Live-resolve titles + membership from the master authoring tables so coach
    # edits in Module Builder reflect here immediately (structured-plan learners).
    detail["modules"], detail["week"], detail["components"] = _resolve_from_master(
        detail["modules"], detail["week"], detail["components"]
    )
    detail["components"], detail["totalExpectedOtjh"] = _annotate_otjh(detail["components"])
    detail["week"], detail["components"] = _append_week_quizzes(detail["week"], detail["components"])
    snapshot = _live_otjh_snapshot(detail, learner_profile)
    _apply_live_otjh_snapshot(detail, snapshot)
    if learner_profile is not None:
        try:
            persist_live_otjh_snapshot(learner_profile, snapshot)
        except DatabaseError as exc:
            logger.warning("Could not persist hours columns for learner %s: %s", pk, exc)

    return detail


def learner_detail(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        # all_learners, not objects: the default manager is scoped to
        # apprenticeship rows, so a commercial learner would 404 here.
        source = model.all_learners.get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    try:
        return JsonResponse(build_learner_detail(source, pk))
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
