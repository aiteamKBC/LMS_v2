"""Two-part marking for monthly assignment reports.

A monthly report is one row in "Learner".learning_reflection_submissions, with
all nine wizard steps inside ``full_submission``. For marking, steps 2-4 are
assessed as the *assignment* and steps 5-8 as the *reflection*: the coach
queue shows the report twice, and each part gets its own decision and feedback.

The learner still sees one status and one feedback text per report. Each
part's decision is kept in ``full_submission.markingParts`` and pinned to the
row's ``submitted_at``, so a resubmission (which resets ``submitted_at``)
makes both parts pending again without anything having to clear them. Only
when both parts are decided for the current submission is the row itself
updated: accepted when both are accepted, otherwise the non-accepted outcome,
with both feedback texts combined under step headings.

Reports already decided before this existed keep their single decision: a row
is split only while it is awaiting review or once a part decision exists for
its current submission.
"""
from __future__ import annotations

import json
from datetime import timezone as dt_timezone
from html import escape

PART_ASSIGNMENT = "assignment"
PART_REFLECTION = "reflection"
MARKING_PARTS = (PART_ASSIGNMENT, PART_REFLECTION)

#: Where the part decisions live inside ``full_submission``. Server-owned: the
#: learner save path strips it from the posted payload.
PARTS_KEY = "markingParts"

#: The wizard steps each part covers, numbered as the learner sees them
#: (step 1 is the instructions and step 9 the quality checks; neither is marked).
PART_STEPS = {
    PART_ASSIGNMENT: (
        (2, "Assignment answer"),
        (3, "Evidence & cross-referencing"),
        (4, "KSBs & hours claimed"),
    ),
    PART_REFLECTION: (
        (5, "Full-month reflection"),
        (6, "Impact & employer benefit"),
        (7, "Action plan & EPA"),
        (8, "Coaching & presentation"),
    ),
}

#: When the two parts disagree, the report takes the non-accepted outcome.
#: Ordered so two different non-accepted outcomes resolve predictably.
_DECISION_PRECEDENCE = ("rejected", "referred", "escalated", "partial")

#: A monthly (nine-step) assignment report. Extra activities and older
#: assignment forms are not split.
MONTHLY_SQL = (
    "(lower(btrim(activity_type)) = 'assignment'"
    " and full_submission #>> '{monthlyAssignment,version}' = '2')"
)

#: ``submitted_at`` rendered exactly as :func:`submission_token` renders it in
#: Python, so a part decision can be matched to the submission it was made on
#: by text comparison (no cast that a malformed value could make fail).
_SUBMITTED_AT_TOKEN_SQL = (
    "to_char(submitted_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
)


def _part_is_current_sql(part_sql):
    return f"(full_submission -> '{PARTS_KEY}' -> {part_sql} ->> 'submittedAt' = {_SUBMITTED_AT_TOKEN_SQL})"


HAS_CURRENT_PART_SQL = "(" + " or ".join(_part_is_current_sql(f"'{part}'") for part in MARKING_PARTS) + ")"

#: Rows the coach marks in two parts.
SPLIT_SQL = f"({MONTHLY_SQL} and (status = 'submitted_for_tutor_review' or {HAS_CURRENT_PART_SQL}))"


def expanded_queue_sql(columns, assignment_types):
    """The marking queue as items rather than rows.

    A split row appears once per part, with ``status`` replaced by that part's
    own status; every other row appears once, unchanged. ``marking_kind`` is the
    tab the item belongs on and ``marking_part`` is null for unsplit rows.
    ``assignment_types`` is a literal tuple of lowercase activity types.
    """
    names = [name.strip() for name in columns.split(",") if name.strip()]
    plain = ", ".join(names)
    part_status = (
        f"case when {_part_is_current_sql('marking_part_values.part')}"
        f" then full_submission -> '{PARTS_KEY}' -> marking_part_values.part ->> 'decision'"
        " else status end as status"
    )
    split_columns = ", ".join(part_status if name == "status" else name for name in names)
    types = ", ".join("'" + value.replace("'", "''") + "'" for value in assignment_types)
    return f"""(
        select {plain}, status as row_status, null::text as marking_part,
               case when lower(btrim(activity_type)) in ({types}) then 'assignment' else 'reflection' end as marking_kind
          from "Learner".learning_reflection_submissions
         where not {SPLIT_SQL}
        union all
        select {split_columns}, status as row_status, marking_part_values.part as marking_part,
               marking_part_values.part as marking_kind
          from "Learner".learning_reflection_submissions
         cross join (values ('{PART_ASSIGNMENT}'), ('{PART_REFLECTION}')) as marking_part_values(part)
         where {SPLIT_SQL}
    ) as marking_items"""


def submission_token(submitted_at):
    """``submitted_at`` as the text a part decision is pinned to."""
    if not submitted_at:
        return ""
    return submitted_at.astimezone(dt_timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _mapping(value):
    return value if isinstance(value, dict) else {}


def _items(value):
    return value if isinstance(value, list) else []


def full_submission_of(row):
    """``full_submission`` as a dict, whether the driver decoded it or not."""
    value = row.get("full_submission")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return {}
    return _mapping(value)


def _text(value):
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value).strip())


def is_monthly(row):
    full = full_submission_of(row)
    return (
        _text(row.get("activity_type")).lower() == "assignment"
        and str(_mapping(full.get("monthlyAssignment")).get("version")) == "2"
    )


def current_parts(row):
    """Part decisions made on this row's current submission, keyed by part."""
    token = submission_token(row.get("submitted_at"))
    stored = _mapping(full_submission_of(row).get(PARTS_KEY))
    return {
        part: review
        for part in MARKING_PARTS
        if (review := _mapping(stored.get(part))) and token and review.get("submittedAt") == token
    }


def is_split(row):
    """Python mirror of :data:`SPLIT_SQL` for a single fetched row."""
    return is_monthly(row) and (
        row.get("status") == "submitted_for_tutor_review" or bool(current_parts(row))
    )


def combined_decision(first, second):
    if first == second:
        return first
    for decision in _DECISION_PRECEDENCE:
        if decision in (first, second):
            return decision
    return "accepted"


def part_heading(part):
    steps = PART_STEPS[part]
    title = "Assignment feedback" if part == PART_ASSIGNMENT else "Reflection feedback"
    return f"{title} (Steps {steps[0][0]}–{steps[-1][0]}: {', '.join(name for _, name in steps)})"


def part_label(part):
    steps = PART_STEPS[part]
    return f"{'Assignment' if part == PART_ASSIGNMENT else 'Reflection'} (Steps {steps[0][0]}–{steps[-1][0]})"


def part_row(row, part):
    """A single fetched row as one part: ``status`` becomes the part's status.

    The expanded list query does this in SQL; the detail, prompt and draft
    endpoints fetch the plain row and use this instead, so all agree.
    """
    review = current_parts(row).get(part)
    return {
        **row,
        "row_status": row.get("status"),
        "status": review.get("decision") if review else row.get("status"),
    }


def _feedback_html(feedback):
    text = _text(feedback)
    if not text:
        return "<p>No additional feedback.</p>"
    if "<" in text and ">" in text:
        return text
    return "".join(f"<p>{escape(line.strip())}</p>" for line in text.splitlines() if line.strip())


def combined_feedback(parts):
    """One feedback text for the learner, a headed section per part."""
    from .feedback_format import sanitize_feedback

    return sanitize_feedback("".join(
        f"<h3>{escape(part_heading(part))}</h3>{_feedback_html(parts[part].get('feedback'))}"
        for part in MARKING_PARTS
    ))


def combined_reviewer(parts):
    names = []
    for part in MARKING_PARTS:
        name = _text(parts[part].get("reviewedBy"))
        if name and name not in names:
            names.append(name)
    return " & ".join(names)[:255] or "Progress Coach"


def _yes_no(value):
    return "Yes" if value is True else "No"


def _entry(label, text, fmt="text", items=None):
    entry = {"label": label, "text": _text(text), "format": fmt}
    if items is not None:
        entry["items"] = items
    return entry


def _checks_entry(label, checks):
    items = [{"label": name, "passed": value is True} for name, value in checks]
    text = "\n".join(f"{item['label']}: {_yes_no(item['passed'])}" for item in items)
    return _entry(label, text, "checks", items)


def part_sections(full_submission, part):
    """The learner's answers for one part, grouped by wizard step.

    Returns ``[{"step", "title", "entries": [...]}]``. Every entry has a
    ``label`` (as the learner saw it on the form), a plain ``text`` rendering
    (used for the AI draft) and a ``format`` telling the review page how to lay
    it out; list-like formats also carry structured ``items``.
    """
    full = _mapping(full_submission)
    monthly = _mapping(full.get("monthlyAssignment"))
    content = {}

    if part == PART_ASSIGNMENT:
        content[2] = [
            _entry("Assignment question", full.get("assignmentQuestion")),
            _entry("Assignment answer", full.get("assignmentAnswer")),
            _entry("I learned…", full.get("whatYouLearned")),
            _entry("I understood…", monthly.get("understood")),
            _entry("I gained skills in…", monthly.get("gainedSkills")),
        ]
        evidence = []
        for entry in _items(monthly.get("evidence")):
            entry = _mapping(entry)
            evidence.append({
                "name": _text(entry.get("name")) or "Unnamed evidence",
                "url": _text(entry.get("url")),
                "points": _text(entry.get("points")),
            })
        evidence_text = "\n".join(
            (f"{item['name']} ({item['url']})" if item["url"] else item["name"])
            + (f" — linked to answer points: {item['points']}" if item["points"] else "")
            for item in evidence
        )
        content[3] = [_entry("Evidence attached", evidence_text or "No evidence attached.", "evidence", evidence)]
        time_entries = []
        for entry in _items(monthly.get("timeEntries")):
            entry = _mapping(entry)
            item = {"date": _text(entry.get("date")), "topic": _text(entry.get("topic")), "hours": _text(entry.get("hours"))}
            if any(item.values()):
                time_entries.append(item)
        claims = []
        for claim in _items(monthly.get("claims")):
            claim = _mapping(claim)
            code = _text(claim.get("code"))
            if code:
                claims.append({"code": code, "explanation": _text(claim.get("explanation")) or "No explanation supplied."})
        content[4] = [
            _entry("Hours claimed", full.get("actualTimeHours"), "value"),
            _entry("Time entries", "\n".join(
                " · ".join(piece for piece in (item["date"], item["topic"], f"{item['hours']} h" if item["hours"] else "") if piece)
                for item in time_entries
            ), "time", time_entries),
            _entry("KSB claims", "\n".join(f"{item['code']}: {item['explanation']}" for item in claims), "ksbs", claims),
            _checks_entry("Confirmations", [
                ("I have reviewed the planned hours and KSBs against my actual learning", monthly.get("plannedReviewed")),
                ("This activity developed new knowledge", monthly.get("newKnowledge")),
                ("This activity developed new skills or behaviours", monthly.get("newSkills")),
                ("Evidence sharing accepted by employer", monthly.get("sharingConsent")),
                ("Completed during paid working hours", monthly.get("paidHours")),
            ]),
        ]
    else:
        content[5] = [
            _entry("Reflect on your LMS activities and assignment", monthly.get("lmsReflection")),
            _entry("Additional activities outside the LMS", monthly.get("extraActivities")),
            _entry("How does the learning fit together?", monthly.get("integratedReflection")),
        ]
        content[6] = [
            _entry("Impact on your career", monthly.get("careerImpact")),
            _entry("Impact on your job performance", monthly.get("jobImpact")),
            _entry("Impact on employer performance", monthly.get("employerImpact")),
            _checks_entry("Confirmations", [
                ("I can explain how my employer has benefited from this learning", monthly.get("employerBenefit")),
            ]),
        ]
        content[7] = [
            _entry("Your action plan for next month", monthly.get("actionPlan")),
            _entry("How has this prepared you for EPA?", monthly.get("epaPreparedness")),
        ]
        slides = []
        for index, slide in enumerate(_items(monthly.get("slides")), start=1):
            slide = _mapping(slide)
            slides.append({"title": _text(slide.get("title")) or f"Slide {index}", "body": _text(slide.get("body"))})
        uploaded = _mapping(monthly.get("uploadedPresentation"))
        content[8] = [
            _checks_entry("Coaching & presentation", [
                ("Coaching meeting booked", bool(_text(monthly.get("meetingKey")))),
                ("Presentation reviewed by the learner", monthly.get("presentationReviewed")),
            ]),
            _entry("Uploaded presentation", uploaded.get("name"), "value"),
            _entry("Presentation slides", "\n\n".join(
                f"{index}. {item['title']}" + (f"\n{item['body']}" if item["body"] else "")
                for index, item in enumerate(slides, start=1)
            ), "slides", slides),
        ]

    return [
        {
            "step": step,
            "title": title,
            "entries": [entry for entry in content.get(step, []) if entry["text"]],
        }
        for step, title in PART_STEPS[part]
    ]


def sections_text(sections):
    """The part's answers as labelled prose for the AI draft."""
    blocks = []
    for section in sections:
        lines = [f"Step {section['step']} — {section['title']}"]
        if section["entries"]:
            lines.extend(f"{entry['label']}:\n{entry['text']}" for entry in section["entries"])
        else:
            lines.append("(nothing entered)")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def apply_part(item, row, part):
    """Turn a serialized queue row into one part's item.

    ``status`` already comes from the expanded query (or the caller); this
    overlays the part's own feedback and reviewer, and adds the part's step
    content so the review page and the AI draft see only that part.
    """
    review = current_parts(row).get(part, {})
    sections = part_sections(full_submission_of(row), part)
    item.update({
        "markingPart": part,
        "markingPartLabel": part_label(part),
        "markingSections": sections,
        "contentPreview": next((entry["text"] for section in sections for entry in section["entries"]), ""),
        "coachFeedback": review.get("feedback") or None,
        "reviewedBy": review.get("reviewedBy") or None,
        "reviewedAt": review.get("reviewedAt") or None,
        "rowStatus": row.get("row_status") or row.get("status"),
    })
    return item


def ai_submission(item):
    """The part item as the AI draft should see it.

    The learner's text for this part's steps replaces the generic reflection
    fields, so the assignment draft is written about steps 2-4 and the
    reflection draft about steps 5-8. Hours and KSB claims are step 4, so they
    travel with the assignment part only.
    """
    part = item.get("markingPart")
    submission = {
        **item,
        "learningReflection": sections_text(item.get("markingSections") or []),
        "applicationType": "",
        "applicationText": "",
        "selectedBenefits": [],
        "benefitExplanation": "",
    }
    if part == PART_REFLECTION:
        submission.update({"ksbExplanations": {}, "actualTimeHours": ""})
    return submission
