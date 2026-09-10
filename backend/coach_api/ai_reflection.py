"""AI-assisted draft for validating a learning reflection.

Why this is separate from ai_marking
------------------------------------
An assignment is a work product: the coach assesses an artefact against the KSBs
the activity carries and against the end-point assessment plan, and the draft
runs to 1000-1200 words. A reflection is a short piece of writing about one
activity -- a video watched, a reading finished -- and the question is narrower:
is it genuine, does it actually engage with *that* activity, and has the learner
taken something usable from it.

Running the assignment policy over a reflection produced a thousand words of
portfolio assessment about a fifteen-minute video, which no coach would read.
So the two have their own prompt documents (``AI_reflection_prompt.MD`` beside
``AI_marking_prompt.MD``, both at the repository root for the training team to
edit) and their own assembly.

What the model is given
-----------------------
The learner's reflection, their workplace-application note, the benefits they
selected, the planned and recorded time, the KSBs the curriculum assigned to
that activity, and the activity's own authored title, type and description.

That last one is what makes the central question answerable. Without it the
model cannot tell whether a reflection engages with the activity or is generic
enough to fit any of them -- and the prompt is explicit that nothing beyond the
authored description may be assumed about what a video or reading contained.
"""
import logging

from django.db import DatabaseError, connections

from .ai_marking import (
    REFLECTION_PROMPT_PATH,
    load_component_ksbs,
    load_prompt_document,
    _s,
)

logger = logging.getLogger(__name__)


def load_activity_context(activity_id):
    """The component's authored title, type and description, as plain text.

    Judging relevance needs something to judge against. Deliberately limited to
    what the author actually wrote: the prompt forbids inferring anything
    further about the activity's contents, and an empty description is reported
    as such rather than filled in.
    """
    try:
        with connections["default"].cursor() as cur:
            cur.execute(
                "select title, type, description from curriculum.components where id = %s",
                [_s(activity_id)],
            )
            row = cur.fetchone()
    except DatabaseError:
        logger.warning("Could not load activity context for %s", activity_id, exc_info=True)
        return ""

    if not row:
        return ""
    title, activity_type, description = row
    parts = [f"Title: {_s(title)}", f"Type: {_s(activity_type)}"]
    if _s(description):
        parts.append(f"Description: {_s(description)}")
    return "\n".join(parts)


def build_reflection_messages(submission, ksb_text, activity_context="", document=None):
    """The system and user messages for validating one reflection.

    The operating notes appended to the policy state the two things the model
    would otherwise guess at: whether it may name KSBs, and whether it knows
    enough about the activity to judge relevance. Saying so explicitly is what
    stops it inventing a code or describing a video it was never shown.
    """
    # ``document`` overrides the authored file for this one call -- the coach's
    # own edit from the marking page. Never written back to disk.
    document = (
        load_prompt_document(REFLECTION_PROMPT_PATH) if document is None else document
    )
    if not document.strip():
        return "", ""

    ksb_note = (
        "The KSBs listed are the ones the curriculum assigned to this activity. "
        "Refer only to codes in that list.\n"
        if ksb_text else
        "No KSBs are assigned to this activity, so say that none can be "
        "verified and do not name any.\n"
    )
    activity_note = (
        "The activity's authored title, type and description are provided. "
        "Judge relevance against those and nothing more.\n"
        if activity_context else
        "Only the activity's title and type are known, with no authored "
        "description. If that is too thin to judge relevance against, say so "
        "rather than inferring what the activity contained.\n"
    )

    system = (
        document
        + "\n\nAdditional operating notes for this deployment.\n"
        + "You are producing a draft for a qualified coach to review, edit and "
        + "decide upon. Do not state or imply a decision, and do not award KSBs.\n"
        + ksb_note
        + activity_note
    )

    reflection = _s(submission.get("learningReflection"))
    application = "\n".join(
        part for part in (
            _s(submission.get("applicationType")),
            _s(submission.get("applicationText")),
        ) if part
    )
    benefits = ", ".join(
        _s(b) for b in (submission.get("selectedBenefits") or []) if _s(b)
    )

    user = "\n".join([
        "Please review the following learning reflection.",
        "",
        f"Learner Name: {_s(submission.get('learner')) or 'not provided'}",
        f"Activity: {_s(submission.get('activityTitle')) or 'not provided'}",
        f"Activity type: {_s(submission.get('activityType')) or 'not provided'}",
        f"Module: {_s(submission.get('module')) or 'not provided'}",
        f"Week: {_s(submission.get('week')) or 'not provided'}",
        f"Planned off-the-job hours: {_s(submission.get('plannedOtjh')) or 'not stated'}",
        f"Time the learner recorded: {_s(submission.get('actualTimeHours')) or 'not stated'}",
        "",
        "The activity itself:",
        activity_context or "(no description was authored for this activity)",
        "",
        "The learner's reflection:",
        reflection or "(the learner wrote nothing)",
        "",
        "Their workplace application note:",
        application or "(none given)",
        "",
        "Employer benefits they selected:",
        benefits or "(none selected)",
        "",
        "KSBs assigned to this activity (authoritative, only these may be referred to):",
        ksb_text or "(none assigned)",
    ])
    return system, user


def generate_reflection_feedback(submission, prompt=None):
    """Draft feedback on one reflection. Returns ``(text, meta)``.

    ``prompt`` replaces the authored reflection policy for this call only; the
    reflection itself and the activity context still travel in the user
    message.

    Raises RuntimeError with a coach-readable message rather than letting a
    stack trace reach the UI.
    """
    from django.conf import settings

    from .ai_marking import MAX_REFLECTION_OUTPUT_TOKENS, _openai_client

    if not _s(submission.get("learningReflection")):
        raise RuntimeError("This submission has no written reflection to review.")

    activity_id = submission.get("activityId")
    ksb_text, ksb_count = load_component_ksbs(activity_id)
    activity_context = load_activity_context(activity_id)
    system, user = build_reflection_messages(
        submission, ksb_text, activity_context, document=prompt
    )
    if not system.strip():
        raise RuntimeError("The reflection prompt could not be loaded on the server.")

    client = _openai_client()
    if client is None:
        raise RuntimeError("The OpenAI client library is not installed on the server.")

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_completion_tokens=MAX_REFLECTION_OUTPUT_TOKENS,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the coach as one message
        logger.exception("Reflection feedback generation failed")
        raise RuntimeError(f"The AI service could not be reached: {exc}") from exc

    text = _s(response.choices[0].message.content if response.choices else "")
    if not text:
        raise RuntimeError("The AI service returned an empty response. Try again.")

    return text, {
        "model": settings.OPENAI_MODEL,
        "kind": "reflection",
        "promptSource": "custom" if prompt is not None else "default",
        "ksbCount": ksb_count,
        # So the coach can tell whether relevance was judged against a real
        # description or only a title.
        "hasActivityContext": bool(activity_context),
        "reflectionChars": len(_s(submission.get("learningReflection"))),
    }
