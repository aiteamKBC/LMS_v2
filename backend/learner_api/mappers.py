"""Map the flat/JSON EnrolmentUser row to the shapes the frontend expects.

Two output shapes:
  * to_list_row  -> UserListRow (Users List screen)
  * to_board     -> EnrolmentBoard (read-only details page)

And two inbound helpers:
  * write_fields -> validates + returns kwargs for create/update (flat columns)
  * validate_choices -> enforces the canonical option lists
"""
from .constants import STATUS_CHOICES, TYPE_CHOICES, PROGRAMME_STATUS_CHOICES


# --------------------------------------------------------------------------- #
# small defensive helpers                                                      #
# --------------------------------------------------------------------------- #
def _s(value):
    """Coerce to a trimmed string ('' for None)."""
    return "" if value is None else str(value).strip()


def _as_list(value):
    return value if isinstance(value, list) else []


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def _pick(d, *keys, default=""):
    """First present key from a dict, tolerant of camel/snake variants."""
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _maybe_json(value):
    """A TEXT column that might hold JSON. Returns parsed value or None."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        import json

        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return None


# --------------------------------------------------------------------------- #
# outbound: list row                                                           #
# --------------------------------------------------------------------------- #
def to_list_row(u):
    status = _s(u.status)
    utype = _s(u.type) or "User"
    return {
        "id": str(u.id),
        "name": _s(u.username),
        "type": utype,
        "email": _s(u.email),
        "group": _s(u.group),
        "subscriptionStatus": status,
        "subscriptionVerified": status.lower() == "fulluser",
        "learningPlan": utype == "User",
        "programmeStatus": _s(u.programme_status),
        "notesCount": 0,
        "hasTasks": utype == "User",
        "reference": _s(u.organization),
    }


# --------------------------------------------------------------------------- #
# outbound: full board                                                         #
# --------------------------------------------------------------------------- #
def _fs_block(assessments, exemption):
    exempt = False
    evidence = []
    ex = _as_dict(exemption)
    if ex:
        exempt = bool(ex.get("exempt"))
        evidence = _as_list(ex.get("evidence"))
    elif isinstance(exemption, bool):
        exempt = exemption
    return {"assessments": _as_list(assessments), "exempt": exempt, "evidence": evidence}


def _split_enrolled(value):
    """'31/10/2025 18:24:17 by Ayman Badewi' -> ('31/10/2025 18:24:17', 'Ayman Badewi')."""
    text = _s(value)
    if " by " in text:
        at, _, by = text.partition(" by ")
        return at.strip(), by.strip()
    return text, ""


def _review_groups(u):
    """Reviews / Review_documents -> [{programme, reviews:[...]}]."""
    raw = u.review_documents if u.review_documents is not None else u.reviews
    items = _as_list(raw)
    if not items:
        return []
    # Already grouped? (each item has a 'reviews' array)
    if all(isinstance(i, dict) and "reviews" in i for i in items):
        return [
            {"programme": _s(_pick(g, "programme")), "reviews": _as_list(g.get("reviews"))}
            for g in items
        ]
    # Flat list of reviews -> wrap under the user's programme.
    return [{"programme": _s(u.programme), "reviews": items}]


def _competencies(u):
    parsed = _maybe_json(u.competencies)
    items = _as_list(parsed)
    out = []
    for i, c in enumerate(items):
        d = _as_dict(c)
        out.append(
            {
                "id": _s(_pick(d, "id", default=f"comp-{i}")) or f"comp-{i}",
                "name": _s(_pick(d, "name")),
                "version": _s(_pick(d, "version", default="v1.0")) or "v1.0",
            }
        )
    return out


def _subscription(u):
    d = _as_dict(u.subscription_details)
    return {
        "startDate": _s(_pick(d, "startDate", "start_date")),
        "endDate": _s(_pick(d, "endDate", "end_date")),
        "status": _s(_pick(d, "status", default=u.status)),
    }


def to_board(u):
    enrolled_at, enrolled_by = _split_enrolled(u.enrolled_time_and_user)
    return {
        "user": {
            "id": str(u.id),
            "name": _s(u.username),
            "reference": _s(u.organization),
            "owner": enrolled_by or _s(u.line_manager),
        },
        "contact": {
            "email": _s(u.email),
            "phone": _s(u.phone_number),
            "dob": _s(u.date_of_birth),
            "groupMembership": _s(u.group),
            "signatureUrl": None,
            "hasMandate": False,
        },
        "activity": {
            "aptemUsage": "00:00",
            "daysTillNextReporting": 0,
            "lastLoggedIn": None,
            "logins": 0,
            "tasksAddedByUser": 0,
            "uncompletedTasks": 0,
            "adviceItemsAccessed": 0,
            "adviceLastAccessed": None,
            "actionPlans": "No plans created",
        },
        "programme": {
            "type": "Delivery",
            "name": _s(u.programme),
            "cohort": _s(u.cohort),
            "status": _s(u.programme_status) or "Non starter",
            "startDate": "",
            "endDate": _s(u.apprenticeship_end_date),
            "enrolledAt": enrolled_at,
            "enrolledBy": enrolled_by,
            "onboardingStatus": _s(u.onboarding_status) or "Not started",
            "onboardingCompletedAt": _s(u.onboarding_completed) or None,
        },
        "subProgrammes": _as_list(u.sub_programme),
        "aims": _as_list(u.aims_qualifications),
        "previousProgrammes": [],
        "functionalSkills": {
            "english": _fs_block(u.english_assessments, u.english_exemption),
            "maths": _fs_block(u.maths_assessments, u.maths_exemption),
            "ict": _fs_block(u.ict_assessments, u.ict_exemption),
        },
        "managedJobs": _as_list(_maybe_json(u.managed_jobs)),
        "tracker": _as_list(u.tracker),
        "milestones": _as_list(u.milestones),
        "notes": [],
        "courseProgress": [],
        "contacts": _as_list(u.contacts),
        "activities": _as_list(u.activity),
        "complianceDocuments": _as_list(u.compliance_documents),
        "reviewDocuments": _review_groups(u),
        "documents": _as_list(u.documents),
        "competencies": _competencies(u),
        "subscription": _subscription(u),
        "auditTrail": [],
        "trainingPlan": _as_list(u.learning_plan),
    }


# --------------------------------------------------------------------------- #
# inbound: create / update                                                     #
# --------------------------------------------------------------------------- #
# payload key -> model attribute (flat text columns only)
WRITABLE_FIELDS = {
    "username": "username",
    "email": "email",
    "phone": "phone_number",
    "dob": "date_of_birth",
    "type": "type",
    "status": "status",
    "programmeStatus": "programme_status",
    "programme": "programme",
    "cohort": "cohort",
    "group": "group",
    "employer": "employer",
    "organization": "organization",
    "reference": "organization",
    "lineManager": "line_manager",
    "onboardingStatus": "onboarding_status",
    "onboardingCompleted": "onboarding_completed",
}


# --------------------------------------------------------------------------- #
# structured training plan (shared by apprenticeship + delivery learners)     #
# --------------------------------------------------------------------------- #
# Shape: [{moduleId, moduleTitle, weeks: [{weekId, weekTitle,
#          components: [{componentId, componentTitle}]}]}, ...]
# Written wholesale by the training-plan wizard (frontend owns the shape);
# ids are curriculum authoring table primary keys, so downstream lookups
# (KSBs, expected_otjh) can match exactly instead of by title.
def _normalize_training_plan(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError("trainingPlan must be a list.")
    return value


def flatten_training_plan(plan):
    """Structured plan -> (module titles, week entries, component entries),
    each entry carrying its curriculum id alongside its title for exact
    downstream lookups (KSBs, expected_otjh) instead of fragile title matching.
    """
    modules, weeks, components = [], [], []
    for m in _as_list(plan):
        if not isinstance(m, dict):
            continue
        module_title = _s(m.get("moduleTitle"))
        module_id = m.get("moduleId")
        if module_title:
            modules.append(module_title)
        for w in _as_list(m.get("weeks")):
            if not isinstance(w, dict):
                continue
            week_title = _s(w.get("weekTitle"))
            week_id = w.get("weekId")
            weeks.append({
                "module": module_title or None, "week": week_title,
                "moduleId": module_id, "weekId": week_id,
            })
            for c in _as_list(w.get("components")):
                if not isinstance(c, dict):
                    continue
                components.append({
                    "module": module_title or None, "week": week_title or None,
                    "component": _s(c.get("componentTitle")),
                    "moduleId": module_id, "weekId": week_id, "componentId": c.get("componentId"),
                })
    return modules, weeks, components


def _split_csv(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [part.strip() for part in str(value).split(",") if part.strip()]


def _legacy_plan_from_csv(source):
    """Best-effort reconstruction of the structured plan shape from the old
    comma-joined Modules/Weeks/Components text columns, for learners who
    haven't re-saved their plan since the structured format was introduced.
    No ids are available for this data, so expectedOtjh/KSB lookups downstream
    fall back to title matching for these entries only."""
    modules_csv = getattr(source, "modules", None)
    weeks_csv = getattr(source, "weeks", None)
    components_csv = getattr(source, "components", None)
    if not (modules_csv or weeks_csv or components_csv):
        return []

    module_titles = _split_csv(modules_csv)

    week_entries = []  # (module_title|None, week_title)
    for entry in _split_csv(weeks_csv):
        parts = [p.strip() for p in entry.split("·")]
        if len(parts) >= 2:
            week_entries.append((parts[0], " · ".join(parts[1:])))
        elif parts and parts[0]:
            week_entries.append((None, parts[0]))

    component_entries = []  # (module_title|None, week_title|None, component_title)
    for entry in _split_csv(components_csv):
        parts = [p.strip() for p in entry.split("·")]
        if len(parts) >= 3:
            component_entries.append((parts[0], parts[1], " · ".join(parts[2:])))
        elif len(parts) == 2:
            component_entries.append((None, parts[0], parts[1]))
        elif parts and parts[0]:
            component_entries.append((None, None, parts[0]))

    plan = []
    for module_title in module_titles:
        weeks = []
        for mod, week_title in week_entries:
            if mod != module_title:
                continue
            comps = [
                {"componentId": None, "componentTitle": comp_title}
                for cmod, cweek, comp_title in component_entries
                if cmod == module_title and cweek == week_title
            ]
            weeks.append({"weekId": None, "weekTitle": week_title, "components": comps})
        plan.append({"moduleId": None, "moduleTitle": module_title, "weeks": weeks})
    return plan


def get_training_plan(source):
    """The structured plan for a CommercialUser or EnrolmentUser instance.
    Falls back to reconstructing one from the legacy CSV columns if the
    learner hasn't been re-saved since the structured format was introduced."""
    plan = getattr(source, "training_plan", None)
    if plan is None:
        plan = getattr(source, "learning_plan", None)
    if plan:
        return plan
    return _legacy_plan_from_csv(source)


class ValidationError(Exception):
    """Raised with a user-facing message when a payload fails validation."""


def validate_choices(payload):
    checks = (
        ("status", STATUS_CHOICES),
        ("type", TYPE_CHOICES),
        ("programmeStatus", PROGRAMME_STATUS_CHOICES),
    )
    for key, allowed in checks:
        val = payload.get(key)
        if val not in (None, "") and val not in allowed:
            raise ValidationError(f"Invalid {key}: {val!r}. Allowed: {', '.join(allowed)}")


def write_fields(payload, *, require_create=False):
    """Validate a payload and return {model_attr: value} for the flat columns."""
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    validate_choices(payload)
    if require_create:
        if not _s(payload.get("username")):
            raise ValidationError("username is required.")
        if not _s(payload.get("email")):
            raise ValidationError("email is required.")
    fields = {}
    for key, attr in WRITABLE_FIELDS.items():
        if key in payload:
            val = payload[key]
            fields[attr] = None if val is None else str(val).strip()
    if "trainingPlan" in payload:
        fields["learning_plan"] = _normalize_training_plan(payload["trainingPlan"])
    return fields


# --------------------------------------------------------------------------- #
# delivery (enrolment."Commercial_users")                         #
# --------------------------------------------------------------------------- #
# payload key -> model attribute
COMMERCIAL_WRITABLE_FIELDS = {
    "username": "username",
    "email": "email",
    "phone": "phone_number",
    "employer": "employer",
    "lineManager": "line_manager",
    "organization": "organization",
    "programmeStatus": "programme_status",
    "programme": "programme",
    "cohort": "cohort",
    "group": "group",
    "modules": "modules",
    "weeks": "weeks",
    "components": "components",
}


def to_commercial_row(u):
    return {
        "id": str(u.id),
        "username": _s(u.username),
        "email": _s(u.email),
        "phone": _s(u.phone_number),
        "employer": _s(u.employer),
        "lineManager": _s(u.line_manager),
        "organization": _s(u.organization),
        "programmeStatus": _s(u.programme_status),
        "programme": _s(u.programme),
        "cohort": _s(u.cohort),
        "group": _s(u.group),
        "modules": _s(u.modules),
        "weeks": _s(u.weeks),
        "components": _s(u.components),
        "trainingPlan": _as_list(u.training_plan),
    }


def write_commercial_fields(payload, *, require_create=False):
    """Validate a payload and return {model_attr: value} for Commercial_users columns."""
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    if require_create:
        if not _s(payload.get("username")):
            raise ValidationError("username is required.")
        if not _s(payload.get("email")):
            raise ValidationError("email is required.")
    ps = payload.get("programmeStatus")
    if ps not in (None, "") and ps not in PROGRAMME_STATUS_CHOICES:
        raise ValidationError(
            f"Invalid programmeStatus: {ps!r}. Allowed: {', '.join(PROGRAMME_STATUS_CHOICES)}"
        )
    fields = {}
    for key, attr in COMMERCIAL_WRITABLE_FIELDS.items():
        if key in payload:
            val = payload[key]
            fields[attr] = None if val is None else str(val).strip()
    if "trainingPlan" in payload:
        fields["training_plan"] = _normalize_training_plan(payload["trainingPlan"])
    return fields


# --------------------------------------------------------------------------- #
# outbound: learner detail (workspace/learner page)                           #
# --------------------------------------------------------------------------- #
def to_learner_detail(source, learner_profile):
    """Shape a CommercialUser/EnrolmentUser (+ its learner profile, if any)
    for the learner workspace page. `learner_profile` is None when the learner
    isn't currently active. The training plan itself comes straight from the
    source record's structured plan column, so it's visible even for learners
    who aren't currently active; KSBs, progress, and activity feed are read
    from the normalized Learner.* tables exposed through LearnerProfile."""
    modules, week, components = flatten_training_plan(get_training_plan(source))

    # Unified progress log holds both quiz attempts and video completions,
    # distinguished by "kind" (a record without a "kind" is treated as a quiz
    # attempt, for any pre-"kind" data).
    progress = _as_list(learner_profile.training_plan_progress) if learner_profile else []
    quiz_attempts = [r for r in progress if r.get("kind", "quiz") == "quiz"]
    video_progress = [r for r in progress if r.get("kind") == "video"]
    # Generic non-quiz component completions (podcast/reading/slides/reflection/…),
    # written by learner_api.components.submit_component_progress.
    component_progress = [r for r in progress if r.get("kind") == "component"]
    # Activity feed source of truth: Learner.learner_activity_events, newest first.
    activity_feed = learner_profile.activity_feed_entries(newest_first=True) if learner_profile else []

    return {
        "id": str(source.id),
        "name": _s(source.username),
        "email": _s(source.email),
        "phone": _s(source.phone_number),
        "programme": _s(source.programme),
        "programmeStatus": _s(source.programme_status),
        "cohort": _s(source.cohort),
        "group": _s(source.group),
        "employer": _s(getattr(source, "employer", "")),
        "lineManager": _s(getattr(source, "line_manager", "")),
        "isActive": learner_profile is not None,
        "modules": modules,
        "week": week,
        "components": components,
        "ksbs": _as_list(learner_profile.ksbs) if learner_profile else [],
        "quizAttempts": quiz_attempts,
        "videoProgress": video_progress,
        "componentProgress": component_progress,
        "activityFeed": activity_feed,
    }
