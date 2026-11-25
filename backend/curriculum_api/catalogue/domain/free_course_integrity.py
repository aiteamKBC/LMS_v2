"""Pure canonical Free Course identity, settings and ownership rules."""
import json

FREE_COURSE_PROGRAMME_MARKER = "FREE-COURSES"

class FreeCourseNotFound(LookupError):
    pass


class InvalidFreeCourseId(ValueError):
    pass


def normalize_course_id(value):
    course_id = str(value or "").strip()
    if not course_id or len(course_id) > 128 or any(ord(char) < 32 for char in course_id):
        raise InvalidFreeCourseId("A valid Free Course id is required.")
    return course_id


def _decode_settings(value):
    if value is None:
        return {}, None
    if isinstance(value, dict):
        return value, None
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return value, "invalid_component_settings"
        if isinstance(decoded, dict):
            return decoded, None
        return decoded, "invalid_component_settings"
    return value, "invalid_component_settings"


def _linked_quiz_id(settings):
    if not isinstance(settings, dict) or "linkedQuizId" not in settings:
        return None, None
    value = settings.get("linkedQuizId")
    if value is None or value == "":
        return None, None
    if isinstance(value, bool):
        return None, "malformed"
    value = str(value).strip()
    if not value or len(value) > 128:
        return None, "malformed"
    return value, None


def _issue(code, severity, **context):
    return {"code": code, "severity": severity, **context}


def _quiz_reference(component, course_id, quiz_id, malformed, quiz_by_id, links_by_quiz):
    component_id = str(component.get("id") or "")
    week_id = str(component.get("free_module_id") or "")
    context = {"componentId": component_id, "freeCourseWeekId": week_id}
    if malformed:
        return ({
            "quizId": None,
            "classification": "malformed",
            "ownerClassification": None,
            "quizStatus": None,
            "readOnly": True,
        }, [_issue("malformed_quiz_reference", "blocked", **context)], False)
    if quiz_id is None:
        return None, [], False

    context["quizId"] = quiz_id
    quiz = quiz_by_id.get(quiz_id)
    links = links_by_quiz.get(quiz_id, [])
    if quiz is None:
        return ({
            "quizId": quiz_id,
            "classification": "missing",
            "ownerClassification": None,
            "quizStatus": None,
            "readOnly": True,
        }, [_issue("missing_quiz_reference", "warning", **context)], False)

    quiz_week = str(quiz.get("free_course_week_id") or "")
    quiz_status = str(quiz.get("status") or "")
    exact_links = [
        link for link in links
        if str(link.get("free_course_week_id") or "") == week_id
        and str(link.get("free_course_id") or "") == course_id
        and not link.get("module_catalogue_id")
        and not link.get("week_id")
    ]

    issues = []
    if len(links) > 1 or len(exact_links) > 1:
        owner = "canonical" if quiz_week == week_id else None
        classification = "duplicate-canonical-link"
    elif quiz_week and quiz_week != week_id:
        owner = "canonical"
        classification = "owner-mismatch"
        issues.append(_issue("quiz_owner_mismatch", "blocked", **context))
    elif links and not exact_links:
        owner = "canonical" if quiz_week else None
        classification = "owner-mismatch"
        issues.append(_issue("quiz_link_owner_mismatch", "blocked", **context))
    elif quiz_week == week_id and quiz.get("week_id"):
        owner = "canonical"
        classification = "owner-mismatch"
        issues.append(_issue("canonical_quiz_has_normal_week_owner", "blocked", **context))
    elif quiz_week == week_id and len(exact_links) == 1:
        owner = "canonical"
        classification = "canonical"
    elif quiz_week == week_id:
        owner = "canonical"
        classification = "canonical-link-missing"
        issues.append(_issue("canonical_quiz_link_missing", "blocked", **context))
    elif not quiz_week and not links and quiz.get("week_id"):
        owner = "legacy-normal-owner"
        classification = "legacy-normal-owner"
        issues.append(_issue("legacy_normal_quiz_reference", "warning", **context))
    else:
        owner = None
        classification = "owner-mismatch"
        issues.append(_issue("quiz_owner_missing_or_ambiguous", "blocked", **context))

    legacy = owner == "legacy-normal-owner"
    if quiz_status.casefold() == "trash":
        issues.append(_issue("trashed_quiz_reference", "warning", **context))
        if classification not in {"duplicate-canonical-link", "owner-mismatch", "canonical-link-missing"}:
            classification = "trashed"

    return ({
        "quizId": quiz_id,
        "classification": classification,
        "ownerClassification": owner,
        "quizStatus": quiz_status or None,
        "readOnly": True,
    }, issues, legacy)


def _integrity_status(issues):
    if any(issue.get("severity") == "blocked" for issue in issues):
        return "blocked"
    return "warning" if issues else "ok"


def _duplicate_order_issues(rows, *, owner_key, entity):
    grouped = {}
    for row in rows:
        key = (str(row.get(owner_key) or ""), row.get("display_order"))
        grouped.setdefault(key, []).append(str(row.get("id") or ""))
    return [
        _issue(
            f"duplicate_{entity}_display_order",
            "warning",
            ownerId=owner,
            displayOrder=order,
            ids=sorted(ids),
        )
        for (owner, order), ids in sorted(grouped.items(), key=lambda item: (item[0][0], str(item[0][1])))
        if len(ids) > 1
    ]


def _decode_components(components):
    """Decode each component's settings and collect the quizzes they reference."""
    decoded_settings = {}
    quiz_ids = set()
    initial_issues = []
    malformed_quiz = {}
    for component in components:
        component_id = str(component.get("id") or "")
        settings, settings_error = _decode_settings(component.get("settings_json"))
        decoded_settings[component_id] = settings
        if settings_error:
            initial_issues.append(_issue(
                settings_error,
                "blocked",
                componentId=component_id,
                freeCourseWeekId=str(component.get("free_module_id") or ""),
            ))
        quiz_id, malformed = _linked_quiz_id(settings)
        malformed_quiz[component_id] = (quiz_id, malformed)
        if quiz_id:
            quiz_ids.add(quiz_id)
    return decoded_settings, quiz_ids, initial_issues, malformed_quiz


def ownership_issues(course_id, weeks, components, quizzes, quiz_links, referenced_quiz_ids):
    """Report existing identity/ownership violations without repairing data."""
    week_by_id = {str(row.get("id") or ""): row for row in weeks}
    quiz_by_id = {str(row.get("id") or ""): row for row in quizzes}
    links_by_quiz = {}
    for link in quiz_links:
        links_by_quiz.setdefault(str(link.get("quiz_id") or ""), []).append(link)
    issues = []
    if len({str(row.get("id") or "") for row in weeks}) != len(weeks):
        issues.append(_issue("duplicate_free_week_id", "blocked"))
    if len({str(row.get("id") or "") for row in components}) != len(components):
        issues.append(_issue("duplicate_free_component_id", "blocked"))
    for week in weeks:
        if str(week.get("course_id") or "") != course_id:
            issues.append(_issue(
                "free_week_owner_mismatch", "blocked",
                freeCourseWeekId=str(week.get("id") or ""),
            ))
    for component in components:
        component_id = str(component.get("id") or "")
        week_id = str(component.get("free_module_id") or "")
        if week_id not in week_by_id:
            issues.append(_issue(
                "free_component_week_owner_mismatch", "blocked",
                componentId=component_id, freeCourseWeekId=week_id,
            ))
        if str(component.get("programme_id") or "") != FREE_COURSE_PROGRAMME_MARKER:
            issues.append(_issue(
                "free_component_programme_marker_mismatch", "blocked",
                componentId=component_id, freeCourseWeekId=week_id,
            ))
    for quiz_id, links in links_by_quiz.items():
        if len(links) > 1:
            issues.append(_issue(
                "duplicate_canonical_quiz_link", "blocked", quizId=quiz_id,
            ))
    for link in quiz_links:
        if str(link.get("free_course_id") or "") != course_id:
            continue
        quiz_id = str(link.get("quiz_id") or "")
        link_week_id = str(link.get("free_course_week_id") or "")
        quiz = quiz_by_id.get(quiz_id)
        if (
            link_week_id not in week_by_id
            or quiz is None
            or str(quiz.get("free_course_week_id") or "") != link_week_id
            or bool(quiz.get("week_id"))
            or bool(link.get("week_id"))
            or bool(link.get("module_catalogue_id"))
        ):
            issues.append(_issue(
                "canonical_quiz_link_owner_mismatch", "blocked",
                quizId=quiz_id, freeCourseWeekId=link_week_id,
            ))
        if quiz_id not in referenced_quiz_ids:
            issues.append(_issue(
                "unreferenced_canonical_quiz_link", "warning",
                quizId=quiz_id, freeCourseWeekId=link_week_id,
            ))
    issues.extend(_duplicate_order_issues(weeks, owner_key="course_id", entity="week"))
    issues.extend(_duplicate_order_issues(components, owner_key="free_module_id", entity="component"))

    return issues
