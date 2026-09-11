"""Renders a learner's Progress Review PPTX by CLONING the real KBC template
(templates/kbc_progress_review_template.pptx) and mutating its text, tables
and evidence-photo fills in place — never rebuilding shapes from scratch.

The template is itself a merge of two real, human-produced KBC Progress
Review decks (see progress_reviews_api/README.md for the full provenance and
the extracted design report). Its 19 slides, in order:

  0  Title
  1  Review Snapshot
  2  Progress Review Closure & Next Learning Phase
  3  Attendance & Engagement
  4  Programme Progress, OTJ & LMS
  5  EPA Readiness & Evidence Admin
  6  Assignments Submitted (3 evidence blocks)
  7  Assignment Portfolio Review
  8  Evidence Detail #1
  9  Evidence Detail #2
  10 Evidence Detail #3
  11 Workplace Application & Impact
  12 KSBs Evidenced: Knowledge (table)
  13 KSBs Evidenced: Skills (2 tables)
  14 KSBs Evidenced: Behaviours (table + evidence-row)
  15 Priority KSBs to Strengthen Next
  16 SMART Targets & Action Plan
  17 Professional Responsibilities & EPA Brief
  18 Manager Questions

Every shape index below was read directly off the template (see the
extraction scripts referenced in the README) — this module does no shape
searching by content, since the template's shape order is fixed and stable
for every generation run. A pack value equal to review_pack.NOT_AVAILABLE (or
missing) is written to the slide literally, exactly as the rest of this
feature never hides a gap — it never becomes a blank or a guess.
"""
from __future__ import annotations

import io
import logging
from pathlib import Path

from pptx import Presentation

from . import slide_cloner as sc
from . import text_fit as fit
from .evidence_images import ImageFetcher, default_image_fetcher
from .pptx_theme import THEME
from .review_pack import NOT_AVAILABLE

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).parent / "templates" / "kbc_progress_review_template.pptx"
TEMPLATE_VERSION = "v1"

MONTH_LABEL = "%B"


def _s(value) -> str:
    return NOT_AVAILABLE if value is None else str(value)


def _pct(value) -> str:
    return f"{value}%" if value not in (None, NOT_AVAILABLE) else NOT_AVAILABLE


def _shapes(slide):
    return list(slide.shapes)


def _shape_in_group(slide, group_index: int, child_index: int):
    """Reach a shape nested one level inside a top-level group — the template
    puts some full-width banner text (e.g. the Review Snapshot's closing
    "Overall:" judgement bar) inside a group with its background rectangle."""
    shapes = _shapes(slide)
    if group_index >= len(shapes):
        return None
    children = list(shapes[group_index].shapes)
    return children[child_index] if child_index < len(children) else None


def _set(slide, index: int, text: str) -> None:
    shapes = _shapes(slide)
    if index < len(shapes):
        sc.set_all_text(shapes[index], fit.clamp(text, 400))


def _set_in_group(slide, group_index: int, child_index: int, text: str) -> None:
    shape = _shape_in_group(slide, group_index, child_index)
    if shape is not None:
        sc.set_all_text(shape, fit.clamp(text, 400))


def _set_para(slide, index: int, para_index: int, text: str) -> None:
    shapes = _shapes(slide)
    if index < len(shapes):
        sc.set_paragraph_text(shapes[index], para_index, fit.clamp(text, 220))


def _set_bullets(slide, index: int, items: list, *, header_count: int = 1, limit: int = 5, prefix: str = "• ") -> None:
    shapes = _shapes(slide)
    if index >= len(shapes):
        return
    kept, overflow = fit.cap_list(items, limit)
    kept = [f"{prefix}{fit.bullet_line(item)}" for item in kept]
    if overflow:
        kept.append(f"{prefix}+{overflow} more — see the review pack for the rest.")
    sc.set_bullet_paragraphs(shapes[index], kept, header_count=header_count)


def _table(slide, occurrence: int = 0):
    return sc.find_table_shape(slide, occurrence)


def _month_range_label(start_iso: str, end_iso: str) -> str:
    from datetime import date

    try:
        start = date.fromisoformat(start_iso)
        end = date.fromisoformat(end_iso)
    except (TypeError, ValueError):
        return NOT_AVAILABLE
    if start.year == end.year and start.month == end.month:
        return start.strftime(f"{MONTH_LABEL} %Y")
    if start.year == end.year:
        return f"{start.strftime(MONTH_LABEL)} to {end.strftime(MONTH_LABEL)} {end.year}"
    return f"{start.strftime('%d %b %Y')} to {end.strftime('%d %b %Y')}"


def _date_label(iso_value: str) -> str:
    from datetime import date

    try:
        return date.fromisoformat(iso_value).strftime("%d %b %Y")
    except (TypeError, ValueError):
        return NOT_AVAILABLE


def _rag_label_and_tone(otj_status: str):
    """Maps this project's real 3-level OTJH status to the deck's RAG word and
    colour. Deliberately 3 levels, not the 5 the reference decks show in one
    example ("Amber-Green") — that finer grain has no source data behind it
    here, and this feature does not invent a distinction it cannot justify."""
    status = (otj_status or "").strip().lower()
    if status == "on track":
        return "Green", THEME.rag_green
    if status == "need attention":
        return "Amber", THEME.rag_amber
    if status == "at risk":
        return "Red", THEME.rag_red
    return NOT_AVAILABLE, THEME.text_muted


def _breadcrumb(pack) -> str:
    learner = pack["learner"]
    return f"{_s(learner.get('programme'))} | Progress Review | {_s(learner.get('full_name'))}"


def _set_breadcrumb(slide, pack, *, index: int = 3) -> None:
    _set(slide, index, _breadcrumb(pack))


def _photo_shapes(slide):
    """The evidence-photo picture-fill shapes on a slide, excluding the 3
    chrome images (background/logo/banner) and the wide decorative banner
    strip that some slides also carry — identified by aspect ratio, since the
    banner is far wider-than-tall relative to any real evidence photo."""
    pics = sc.picture_fill_shapes(slide)[3:]
    photos = []
    for shape, blip in pics:
        if shape.width and shape.height and (shape.width / shape.height) < 3:
            photos.append((shape, blip))
    return photos


# --------------------------------------------------------------------------- #
# slide populators
# --------------------------------------------------------------------------- #

def _populate_title(slide, pack):
    learner, review = pack["learner"], pack["review"]
    shapes = _shapes(slide)
    _set(slide, 5, _s(learner.get("programme")))
    _set(slide, 7, _s(learner.get("full_name")))
    _set(slide, 8, f"Employer: {_s(learner.get('employer'))}")
    _set(slide, 9, f"Manager: {_s(learner.get('manager_name'))}")
    period_label = f"{_date_label(review.get('review_period_start'))} to {_date_label(review.get('review_period_end'))}"
    _set(slide, 10, f"Review period: {period_label}")


def _populate_snapshot(slide, pack):
    progress, otj, attendance, ksbs = pack["progress"], pack["otj"], pack["attendance"], pack["ksbs"]
    review = pack["review"]
    month_label = _month_range_label(review["review_period_start"], review["review_period_end"])

    headline = (
        f"Programme progress is {_pct(progress.get('current_programme_progress_percentage'))} "
        f"against a {_pct(progress.get('target_progress_percentage'))} target, "
        f"with {_s(otj.get('completed_otj_hours'))} OTJ hours completed."
    )
    _set(slide, 5, headline)

    _set(slide, 8, _pct(attendance.get("attendance_percentage")))
    _set(slide, 9, f"Attendance across {month_label}")
    catch_ups_needed = attendance.get("catch_ups_needed")
    _set(slide, 10, "Catch-ups used where needed" if not catch_ups_needed else f"{catch_ups_needed} catch-up(s) still needed")

    _set(slide, 13, _pct(progress.get("current_programme_progress_percentage")))
    _set(slide, 15, f"Target: {_pct(progress.get('target_progress_percentage'))}")

    _set(slide, 18, f"{_s(otj.get('completed_otj_hours'))}h")
    _set(slide, 20, f"Variance: {_s(otj.get('variance'))}h")

    ksb_progress_all = ksbs.get("knowledge_evidenced", []) + ksbs.get("skills_evidenced", []) + ksbs.get("behaviours_evidenced", [])
    module_pct = pack["lms_modules"][0]["completion_percentage"] if pack["lms_modules"] else None
    _set(slide, 23, _pct(module_pct) if module_pct is not None else NOT_AVAILABLE)
    _set(slide, 24, "Key LMS module" if not pack["lms_modules"] else pack["lms_modules"][0]["module"])
    _set(slide, 25, "Keep clicking complete")

    rag_label, _tone = _rag_label_and_tone(otj.get("risk_status"))
    _set(slide, 28, rag_label)
    _set(slide, 29, _s(otj.get("risk_status")))

    coach_summary = [
        f"KSB coverage: {len(ksb_progress_all)} KSB(s) fully evidenced to date.",
        f"OTJ status: {_s(otj.get('risk_status'))}, forecast {_s(otj.get('forecast_hours'))}h.",
        f"Evidence this period: {len(pack['evidence'])} item(s) uploaded.",
    ]
    _set_bullets(slide, 31, coach_summary, header_count=1)

    focus = [f"{a['title']} — {a['detail']}" for a in pack["actions"]]
    _set_bullets(slide, 33, focus, header_count=1)

    learner_name = pack["learner"].get("full_name")
    if rag_label in ("Green",):
        judgement = f"Overall: {learner_name} is on track, with {_s(otj.get('risk_status')).lower()} OTJ progress."
    elif rag_label == NOT_AVAILABLE:
        judgement = f"Overall: {learner_name}'s progress this period is {NOT_AVAILABLE}."
    else:
        judgement = f"Overall: {learner_name} needs focused support this period — OTJ status is {_s(otj.get('risk_status')).lower()}."
    _set_in_group(slide, 35, 1, judgement)


def _populate_closure(slide, pack):
    """The one Curtis-sourced slide in the template — its shape order differs
    from every Bethanie-sourced slide (breadcrumb at index 2, not 3; the
    employer label and the closing action bar sit inside groups), mapped
    directly from the template inspection rather than reused indices."""
    review, progress, ksbs, learner = pack["review"], pack["progress"], pack["ksbs"], pack["learner"]
    _set_breadcrumb(slide, pack, index=2)

    priority_codes = ", ".join(item["code"] for item in ksbs.get("priority_next", [])[:4]) or NOT_AVAILABLE
    _set(slide, 4, f"The only overdue activity is this review. Once confirmed, focus moves to {progress.get('next_module')} and KSB evidence development.")

    _set(slide, 7, _date_label(review.get("review_date")))
    _set(slide, 8, f"Progress Review {_s(review.get('review_number'))}")
    _set(slide, 9, f"Complete today and confirm the review within 48 hours.")

    _set(slide, 12, _month_range_label(review.get("action_period_start"), review.get("action_period_end")))
    _set(slide, 13, "Live workplace evidence project")
    _set(slide, 14, (
        f"Agree one project by {_date_label(review.get('action_period_start'))}; "
        f"submit the verified pack by {_date_label(review.get('action_period_end'))}."
    ))

    evidence_needed = [
        f"Workplace evidence targeting {priority_codes}.",
        "Date, start time, finish time and actual OTJ hours.",
        "Concise notes and one example of workplace application.",
        "Reflection and relevant KSB mapping uploaded within 48 hours.",
    ]
    _set_bullets(slide, 16, evidence_needed, header_count=1, limit=4)

    protocol = [
        "Protect dedicated OTJ time each week.",
        "Record only genuine new learning; avoid duplicate OTJ claims.",
        "Retain drafts, screenshots and approval evidence.",
        "Raise access, release or workload barriers promptly.",
    ]
    _set_bullets(slide, 18, protocol, header_count=1, limit=4)

    practical_action = _shape_in_group(slide, 21, 1)
    if practical_action is not None:
        sc.set_all_text(practical_action, fit.clamp(
            f"Practical action: close review {review.get('review_number')} today; "
            f"agree the live evidence project by {_date_label(review.get('action_period_start'))}.",
            220,
        ))

    employer_label = _shape_in_group(slide, 22, 1)
    if employer_label is not None:
        sc.set_all_text(employer_label, _s(learner.get("employer")).upper())


def _populate_attendance(slide, pack):
    attendance = pack["attendance"]
    monthly = attendance.get("monthly_summary") or []
    slots = [(8, 9, 10), (13, 14, 15), (18, 19, 20)]
    for i, (month_idx, pct_idx, note_idx) in enumerate(slots):
        if i < len(monthly):
            entry = monthly[i]
            _set(slide, month_idx, entry["month"].split()[0])
            rate = round(entry["present"] / entry["sessions"] * 100) if entry.get("sessions") else None
            _set(slide, pct_idx, f"Attendance: {_pct(rate)}")
            _set(slide, note_idx, "Engagement sustained" if entry.get("absent", 0) == 0 else "Catch-up approach used")
        else:
            _set(slide, month_idx, NOT_AVAILABLE)
            _set(slide, pct_idx, NOT_AVAILABLE)
            _set(slide, note_idx, NOT_AVAILABLE)

    working_well = [attendance.get("engagement_notes") or NOT_AVAILABLE]
    _set_bullets(slide, 22, working_well, header_count=1)
    future_protocol = ["Any missed session should trigger a prompt catch-up, recorded the same week."]
    _set_bullets(slide, 24, future_protocol, header_count=1)


def _populate_progress_otj_lms(slide, pack):
    progress, otj = pack["progress"], pack["otj"]
    _set(slide, 10, f"Current: {_pct(progress.get('current_programme_progress_percentage'))}")
    _set(slide, 11, _pct(progress.get("current_programme_progress_percentage")))
    _set(slide, 14, f"Target: {_pct(progress.get('target_progress_percentage'))}")
    _set(slide, 15, _pct(progress.get("target_progress_percentage")))
    rag_label, _tone = _rag_label_and_tone(otj.get("risk_status"))
    _set(slide, 16, f"{_s(pack['learner'].get('full_name'))} is {rag_label.lower()} with progress." if rag_label != NOT_AVAILABLE else NOT_AVAILABLE)

    _set(slide, 21, _s(otj.get("completed_otj_hours")))
    _set(slide, 25, _s(otj.get("variance")))
    _set(slide, 26, "Ahead of track" if isinstance(otj.get("variance"), (int, float)) and otj["variance"] >= 0 else "Behind target")
    _set(slide, 30, "Healthy pace" if rag_label == "Green" else rag_label)
    _set(slide, 31, _s(otj.get("duplicate_or_weak_otj_warning")))

    modules = pack["lms_modules"]
    module_lines = [36, 39, 42]
    for idx, slot in enumerate(module_lines):
        if idx < len(modules):
            m = modules[idx]
            _set(slide, slot, f"{m['module']} {m['completion_percentage']}%")
        else:
            _set(slide, slot, NOT_AVAILABLE)
    _set(slide, 43, f"• Action: {progress.get('action_notes')}")


def _populate_epa(slide, pack):
    epa = pack["epa"]
    _set(slide, 8, _s(epa.get("current_readiness")))
    _set(slide, 9, (epa.get("portfolio_risks") or [NOT_AVAILABLE])[0])
    _set(slide, 12, _s(pack["progress"].get("overdue_lms_activities")))
    _set(slide, 15, (epa.get("evidence_admin_risks") or [NOT_AVAILABLE])[0])

    table_shape = _table(slide)
    if table_shape:
        rows = [
            ("Multiple Choice Test", epa.get("multiple_choice_test_confidence")),
            ("Project Showcase", epa.get("project_showcase_confidence")),
            ("Professional Discussion", epa.get("professional_discussion_confidence")),
        ]
        for row_index, (area, confidence) in enumerate(rows, start=1):
            sc.set_table_cell(table_shape, row_index, 0, area)
            sc.set_table_cell(table_shape, row_index, 1, fit.clamp(confidence, 30))
            sc.set_table_cell(table_shape, row_index, 2, fit.clamp(confidence, 90))


def _evidence_blocks(pack, limit=3):
    pool = pack["assignments"] + pack["workplace_activities"]
    if not pool:
        pool = pack["evidence"]
    kept, _overflow = fit.cap_list(pool, limit)
    return kept


def _populate_assignments(slide, pack):
    review = pack["review"]
    month_label = _month_range_label(review["review_period_start"], review["review_period_end"])
    _set(slide, 4, f"Assignments Submitted: {month_label}")

    blocks = _evidence_blocks(pack, 3)
    slots = [(9, 10, 11), (15, 16, 17), (21, 22, 23)]
    for i, (title_idx, detail_idx, value_idx) in enumerate(slots):
        if i < len(blocks):
            item = blocks[i]
            _set(slide, title_idx, fit.clamp(item.get("evidence_title"), 60))
            _set(slide, detail_idx, f"• {fit.bullet_line(item.get('evidence_summary'), 160)}")
            ksb = ", ".join(item.get("ksb_mappings") or []) or "workplace application"
            _set(slide, value_idx, f"Evidence value: {item.get('evidence_strength')}, evidences {ksb}")
        else:
            _set(slide, title_idx, NOT_AVAILABLE)
            _set(slide, detail_idx, NOT_AVAILABLE)
            _set(slide, value_idx, NOT_AVAILABLE)


def _populate_portfolio_review(slide, pack):
    evidence, ksbs = pack["evidence"], pack["ksbs"]
    blocks = _evidence_blocks(pack, 3)
    slots = [(8, 9, 10), (13, 14, 15), (18, 19, 20)]
    for i, (strength_idx, title_idx, note_idx) in enumerate(slots):
        if i < len(blocks):
            item = blocks[i]
            _set(slide, strength_idx, item.get("evidence_strength", NOT_AVAILABLE).title())
            _set(slide, title_idx, fit.clamp(item.get("evidence_title"), 40))
            _set(slide, note_idx, "Good for " + ", ".join(item.get("ksb_mappings") or []) if item.get("ksb_mappings") else NOT_AVAILABLE)
        else:
            _set(slide, strength_idx, NOT_AVAILABLE)
            _set(slide, title_idx, NOT_AVAILABLE)
            _set(slide, note_idx, NOT_AVAILABLE)

    _set(slide, 23, _s(pack["epa"].get("current_readiness")))
    _set(slide, 25, "Upload & map evidence")

    accepted = sum(1 for e in evidence if e.get("manager_verification_status") == "accepted")
    already_strong = [f"{accepted} evidence item(s) already manager-verified." if accepted else "No manager-verified evidence yet this period."]
    _set_bullets(slide, 27, already_strong, header_count=1)
    epa_ready = ["Add a one-page evidence cover sheet mapping each item to its KSBs and outcome."]
    _set_bullets(slide, 29, epa_ready, header_count=1)


def _populate_evidence_detail(slide, pack, month_offset: int, fetch_image: ImageFetcher):
    blocks = _evidence_blocks(pack, 999)
    start = month_offset * 4
    items = blocks[start : start + 4]

    review = pack["review"]
    label = _month_range_label(review["review_period_start"], review["review_period_end"])
    _set(slide, 4, f"Additional Job Activities: {label}" if month_offset == 0 else f"Additional Evidence {month_offset + 1}: {label}")

    bullets = [fit.bullet_line(item.get("evidence_summary")) for item in items] or [NOT_AVAILABLE]
    _set_bullets(slide, 7, bullets, header_count=1, limit=5)

    caption_indices = [10, 13, 16, 19]
    photos = _photo_shapes(slide)
    for i, caption_idx in enumerate(caption_indices):
        if i < len(items):
            _set(slide, caption_idx, fit.clamp(items[i].get("evidence_title"), 45))
            if i < len(photos):
                shape, _blip = photos[i]
                url = items[i].get("image_or_screenshot_link")
                data = fetch_image(url) if url and url != NOT_AVAILABLE else None
                if data:
                    try:
                        sc.replace_picture_fill(shape, data, slide.part)
                    except Exception as exc:
                        logger.warning("Progress review PPTX: could not embed evidence image: %s", exc)
        else:
            _set(slide, caption_idx, NOT_AVAILABLE)


def _populate_workplace_impact(slide, pack):
    learner, evidence = pack["learner"], pack["evidence"]
    _set(slide, 4, f"Workplace Application & Impact at {_s(learner.get('employer'))}")
    accepted = [e for e in evidence if e.get("manager_verification_status") == "accepted"]
    lines = [
        f"{len(accepted)} manager-verified evidence item(s) this period show applied contribution." if accepted else NOT_AVAILABLE,
        NOT_AVAILABLE,
        NOT_AVAILABLE,
        f"Evidence spans {', '.join(sorted({e.get('evidence_type') for e in evidence}))[:120]}." if evidence else NOT_AVAILABLE,
    ]
    for idx, text in zip((9, 13, 17, 21), lines):
        _set(slide, idx, text)


def _populate_ksb_table_slide(slide, rows: list, *, occurrence: int = 0):
    table_shape = _table(slide, occurrence)
    if not table_shape:
        return 0
    max_rows = len(table_shape.table.rows) - 1  # minus header
    for i in range(max_rows):
        if i < len(rows):
            sc.set_table_cell(table_shape, i + 1, 0, rows[i]["code"])
            sc.set_table_cell(table_shape, i + 1, 1, fit.clamp(rows[i]["description"], 300))
        else:
            sc.set_table_cell(table_shape, i + 1, 0, "")
            sc.set_table_cell(table_shape, i + 1, 1, "")
    return max(0, len(rows) - max_rows)


def _populate_priority_ksbs(slide, pack):
    priority = pack["ksbs"].get("priority_next", [])
    slots = [(9, 10), (14, 15), (19, 20), (24, 25)]
    for i, (title_idx, idea_idx) in enumerate(slots):
        if i < len(priority):
            item = priority[i]
            _set(slide, title_idx, fit.clamp(item["description"], 70))
            _set(slide, idea_idx, f"Evidence idea: {fit.bullet_line(item['how_to_evidence'], 180)}")
        else:
            _set(slide, title_idx, NOT_AVAILABLE)
            _set(slide, idea_idx, NOT_AVAILABLE)


def _populate_smart_targets(slide, pack):
    review, actions = pack["review"], pack["actions"]
    _set(slide, 3, f"SMART Targets & Action Plan: {_month_range_label(review['action_period_start'], review['action_period_end'])}")
    priority_codes = ", ".join(i["code"] for i in pack["ksbs"].get("priority_next", [])[:2]) or NOT_AVAILABLE
    focus_lines = [f"{i + 1}. {a['title']}: {a['detail']}" for i, a in enumerate(actions[:4])]
    _set_bullets(slide, 8, focus_lines, header_count=1, limit=4, prefix="")
    _set_bullets(slide, 9, [f"Treat KSB gaps ({priority_codes}) as evidence-building opportunities from live work."], header_count=1)
    for_learner = [f"Owner: {a['owner']} — due {_date_label(a['due_by'])}" for a in actions]
    _set_bullets(slide, 12, for_learner, header_count=1)
    evidence_to_upload = ["Project brief or plan", "Manager verification", "Reflection mapped to KSBs"]
    _set_bullets(slide, 15, evidence_to_upload, header_count=1)


def _populate_professional_responsibilities(slide, pack):
    employer = pack["learner"].get("employer")
    _set_bullets(slide, 8, [f"Protect everyone's right to learn and work safely at {employer}, free from harassment or discrimination."], header_count=1)
    _set_bullets(slide, 11, ["Democracy: encourage voice, challenge and feedback in every review."], header_count=1)
    _set_bullets(slide, 14, [
        "Multiple Choice Test: 50 questions, 90 minutes.",
        "Project Showcase and Professional Discussion draw directly on this portfolio.",
    ], header_count=1, limit=4)


def _populate_manager_questions(slide, pack):
    review = pack["review"]
    manager = pack["learner"].get("manager_name")
    _set(slide, 4, f"{manager}'s feedback will help measure programme impact, confidence and EPA readiness." if manager != NOT_AVAILABLE else NOT_AVAILABLE)
    questions = [f"{i + 1}. {q}" for i, q in enumerate(pack["manager_questions"])]
    _set_bullets(slide, 8, questions, header_count=1, limit=8, prefix="")
    _set_bullets(slide, 11, ["Impact observed:", "Improvements noticed:", "Support agreed:"], header_count=1, prefix="")
    priority_codes = ", ".join(i["code"] for i in pack["ksbs"].get("priority_next", [])[:3]) or NOT_AVAILABLE
    _set_bullets(slide, 14, [
        f"Project / activity: agree evidence for {priority_codes}",
        f"{pack['learner'].get('full_name')}'s role:",
        "Evidence to upload:",
        f"Review date: {_date_label(review.get('action_period_end'))}",
    ], header_count=1, prefix="")


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #

def generate_progress_review_pptx(pack: dict, *, fetch_image: ImageFetcher = default_image_fetcher) -> bytes:
    """Clone the KBC template and populate all 19 slides from `pack`."""
    prs = Presentation(str(TEMPLATE_PATH))
    slides = list(prs.slides)
    if len(slides) != 19:
        raise RuntimeError(f"Progress Review template must have 19 slides, found {len(slides)}.")

    _populate_title(slides[0], pack)

    for index in range(1, 19):
        if index == 2:
            continue  # the Curtis-sourced Closure slide sets its own breadcrumb at a different shape index
        _set_breadcrumb(slides[index], pack)

    _populate_snapshot(slides[1], pack)
    _populate_closure(slides[2], pack)
    _populate_attendance(slides[3], pack)
    _populate_progress_otj_lms(slides[4], pack)
    _populate_epa(slides[5], pack)
    _populate_assignments(slides[6], pack)
    _populate_portfolio_review(slides[7], pack)
    _populate_evidence_detail(slides[8], pack, 0, fetch_image)
    _populate_evidence_detail(slides[9], pack, 1, fetch_image)
    _populate_evidence_detail(slides[10], pack, 2, fetch_image)
    _populate_workplace_impact(slides[11], pack)

    knowledge_overflow = _populate_ksb_table_slide(slides[12], pack["ksbs"].get("knowledge_evidenced", []))
    skills = pack["ksbs"].get("skills_evidenced", [])
    skills_table_1_capacity = len(_table(slides[13], 0).table.rows) - 1 if _table(slides[13], 0) else 0
    _populate_ksb_table_slide(slides[13], skills[:skills_table_1_capacity], occurrence=0)
    _populate_ksb_table_slide(slides[13], skills[skills_table_1_capacity:], occurrence=1)
    _populate_ksb_table_slide(slides[14], pack["ksbs"].get("behaviours_evidenced", []))

    _populate_priority_ksbs(slides[15], pack)
    _populate_smart_targets(slides[16], pack)
    _populate_professional_responsibilities(slides[17], pack)
    _populate_manager_questions(slides[18], pack)

    if knowledge_overflow:
        logger.info("Progress review PPTX: %s Knowledge KSB row(s) did not fit the template table.", knowledge_overflow)

    buffer = io.BytesIO()
    prs.save(buffer)
    return buffer.getvalue()
