"""Monthly assignment reports, laid out for the coach marking page.

A monthly report is one row in "Learner".learning_reflection_submissions, with
all nine wizard steps inside ``full_submission``. The review page shows it in
two tabs -- the assignment, KSBs & evidence (steps 2-4) and the reflection
(steps 5-8) -- and a third tab where the coach writes one feedback and makes one
decision for the whole report. The AI draft for that feedback is written from
both tabs' answers.
"""
from __future__ import annotations

import json

PART_ASSIGNMENT = "assignment"
PART_REFLECTION = "reflection"
MARKING_PARTS = (PART_ASSIGNMENT, PART_REFLECTION)

#: The wizard steps each tab covers, numbered as the learner sees them
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


def monthly_sections(row):
    """Both tabs' step content for a monthly report, or ``None`` for anything else."""
    if not is_monthly(row):
        return None
    full = full_submission_of(row)
    return {part: part_sections(full, part) for part in MARKING_PARTS}


def ai_submission(item):
    """The report as the AI draft should see it: every answer from steps 2-8.

    The generic reflection fields are replaced by the two tabs' answers, so the
    one feedback draft is written about the assignment and the reflection
    together. KSB explanations and claimed hours stay, since step 4 holds them.
    """
    sections = item.get("monthlySections") or {}
    text = "\n\n".join(
        f"{'ASSIGNMENT, KSBs & EVIDENCE' if part == PART_ASSIGNMENT else 'REFLECTION'} (Steps "
        f"{PART_STEPS[part][0][0]}-{PART_STEPS[part][-1][0]})\n{sections_text(sections.get(part) or [])}"
        for part in MARKING_PARTS
    )
    return {
        **item,
        "learningReflection": text,
        "applicationType": "",
        "applicationText": "",
        "selectedBenefits": [],
        "benefitExplanation": "",
    }
