"""Monthly Coaching Meeting (MCM) PPTX — the same real-data pipeline as the
Progress Review deck, scoped to one month instead of one 12-week review.

How an MCM differs from a Progress Review (and so what this deck keeps):

  Progress Review   every 12 weeks, tripartite (learner + coach + line
                    manager), a formal checkpoint on the whole programme:
                    KSB coverage, portfolio, EPA readiness, manager feedback.
  MCM               monthly, learner + coach, a check-in on the month just
                    gone: attendance, OTJ hours, LMS progress, evidence
                    submitted, workplace application, wellbeing/safeguarding,
                    and SMART targets for the month ahead.

For audit and Ofsted (EIF "quality of education" and "personal development")
the monthly record has to show real progress against the plan, protected
off-the-job time, KSB development from live work, safeguarding/Prevent and
British Values revisited, and dated SMART targets. So the MCM deck is the
Progress Review template with the review-only slides removed (closure, EPA
readiness, portfolio review, two of the three evidence-detail slides, the full
KSB tables and the manager-questions slide) and every "Progress Review" label replaced. Nothing
is rebuilt, so branding and the "Not available, never guessed" rule carry
over unchanged.
"""
from __future__ import annotations

import io
from datetime import date, timedelta
from typing import Optional

from . import pptx_generator as gen
from . import slide_cloner as sc
from . import text_fit as fit
from .evidence_images import ImageFetcher, default_image_fetcher
from .period import ReviewPeriod

REVIEW_KIND = "mcm"
REVIEW_LABEL = "Monthly Coaching Meeting"
DEFAULT_INTERVAL = timedelta(weeks=4)

# Template slide indices kept for an MCM, in deck order (see pptx_generator's
# module docstring for the full 19-slide list). Slide 8 is the learner's
# "work this month" photo slide — the MCM opens with the learner presenting it.
MCM_SLIDES = (0, 1, 3, 4, 6, 8, 11, 15, 16, 17)


def _interval(programme_id: Optional[str]) -> timedelta:
    """The programme's MCM recurrence from its Curriculum template, or 4
    weeks. A months-based template also maps to 4 weeks: the window only has
    to cover "the month since the last meeting"."""
    if programme_id:
        try:
            from coach_api.views import REVIEW_TYPE_CODE_MCM
            from curriculum_api.review_instances import get_review_type_template, template_recurrence_config

            row = get_review_type_template(programme_id, REVIEW_TYPE_CODE_MCM)
        except Exception:
            row = None
        if row:
            recurrence = template_recurrence_config(row)
            if recurrence["unit"] == "weeks":
                return timedelta(weeks=recurrence["interval"])
            if recurrence["unit"] == "days":
                return timedelta(days=recurrence["interval"])
    return DEFAULT_INTERVAL


def build_mcm_period(meeting_date: date, *, programme_id: Optional[str] = None) -> ReviewPeriod:
    """The month being reviewed (the interval up to and including the meeting)
    and the month ahead that the agreed SMART targets apply to."""
    interval = _interval(programme_id)
    return ReviewPeriod(
        review_number=None,
        review_date=meeting_date,
        review_period_start=meeting_date - interval + timedelta(days=1),
        review_period_end=meeting_date,
        action_period_start=meeting_date + timedelta(days=1),
        action_period_end=meeting_date + interval,
    )


def label_pack(pack: dict) -> dict:
    """Tag a review pack as an MCM so the shared slide populators label it."""
    pack["review"]["review_kind"] = REVIEW_KIND
    pack["review"]["review_label"] = REVIEW_LABEL
    return pack


def _delete_slide(prs, index: int) -> None:
    slide_ids = prs.slides._sldIdLst
    slide_id = list(slide_ids)[index]
    prs.part.drop_rel(slide_id.rId)
    slide_ids.remove(slide_id)


def _set_in_group(slide, group_index: int, child_index: int, text: str, limit: int = 200) -> None:
    shape = gen._shape_in_group(slide, group_index, child_index)
    if shape is not None:
        sc.set_all_text(shape, fit.clamp(text, limit))


def _relabel(slides, pack) -> None:
    """Replace the wording on the kept slides that only makes sense for a
    12-week tripartite review."""
    learner = pack["learner"]
    name = learner.get("full_name")
    title, snapshot, priority, smart, responsibilities = (
        slides[0], slides[1], slides[15], slides[16], slides[17],
    )
    gen._set(title, 4, REVIEW_LABEL)
    period = f"{gen._date_label(pack['review'].get('review_period_start'))} to {gen._date_label(pack['review'].get('review_period_end'))}"
    gen._set(title, 10, f"Month reviewed: {period}")
    gen._set(title, 9, f"Coach: {gen._s(learner.get('coach'))}")

    gen._set(snapshot, 4, "Monthly Snapshot")

    codes = ", ".join(item["code"] for item in pack["ksbs"].get("priority_next", [])[:2]) or gen.NOT_AVAILABLE
    _set_in_group(priority, 27, 1, f"Agreed this month: one live piece of work where {name} can evidence {codes}.")

    gen._set(smart, 4, "Measurable next steps for the month ahead, agreed and dated in this meeting.")
    _set_in_group(smart, 16, 1, f"Agreed today: {name}'s targets, owners and dates for the next coaching meeting.")

    gen._set(responsibilities, 3, "Wellbeing, Safeguarding & British Values")
    gen._set(responsibilities, 4, (
        f"Monthly check-in: is {name} safe and well, supported at {gen._s(learner.get('employer'))}, "
        "and aware of Prevent and how to raise a concern?"
    ))


def generate_mcm_pptx(pack: dict, *, fetch_image: ImageFetcher = default_image_fetcher) -> bytes:
    """Render the full Progress Review deck from an MCM-labelled pack, relabel
    it, then drop the review-only slides."""
    prs = gen.render_progress_review(label_pack(pack), fetch_image=fetch_image)
    _relabel(list(prs.slides), pack)
    gen._remove_source_employer_logos(prs)
    for index in sorted(set(range(len(prs.slides))) - set(MCM_SLIDES), reverse=True):
        _delete_slide(prs, index)
    buffer = io.BytesIO()
    prs.save(buffer)
    return buffer.getvalue()
