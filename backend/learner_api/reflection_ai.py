import json
import logging

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST


logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 15 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "video/webm",
}

REFLECTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "accepted": {"type": "boolean"},
        "clean_text": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["accepted", "clean_text", "reason"],
}

PROOFREAD_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "accepted": {"type": "boolean"},
        "improved_text": {"type": "string"},
        "reason": {"type": "string"},
    },
    "required": ["accepted", "improved_text", "reason"],
}


def _error(message, status, code):
    return JsonResponse({"error": message, "code": code}, status=status)


def _moderation_flagged(client, text):
    result = client.moderations.create(
        model=settings.OPENAI_MODERATION_MODEL,
        input=text,
    )
    return bool(result.results and result.results[0].flagged)


def _openai_client():
    try:
        from openai import OpenAI
    except ImportError:
        return None
    return OpenAI(api_key=settings.OPENAI_API_KEY)


@csrf_exempt
@require_POST
def proofread_reflection(request):
    if not settings.OPENAI_API_KEY:
        return _error("AI proofreading is not configured.", 503, "openai_not_configured")

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, ValueError):
        return _error("Invalid request body.", 400, "invalid_json")

    original_text = str(payload.get("text") or "").strip()
    if not original_text:
        return _error("Write or record an answer before using proofreading.", 400, "missing_text")
    if len(original_text) > 20_000:
        return _error("The reflection is too long to proofread.", 413, "text_too_long")

    activity_title = str(payload.get("activityTitle") or "learning activity").strip()[:300]
    module_label = str(payload.get("moduleLabel") or "").strip()[:300]
    week_label = str(payload.get("weekLabel") or "").strip()[:120]

    client = _openai_client()
    if client is None:
        return _error("AI proofreading is unavailable on the server.", 503, "openai_package_missing")

    try:
        if _moderation_flagged(client, original_text):
            return _error(
                "This text contains language that cannot be added to a learning reflection.",
                422,
                "inappropriate_content",
            )

        response = client.responses.create(
            model=settings.OPENAI_REFLECTION_MODEL,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You proofread apprentice learning reflections. Correct spelling, punctuation and grammar; "
                        "use natural British English; improve sentence flow; split dense text into readable paragraphs "
                        "where helpful; and remove accidental repetition or speech filler. Preserve the learner's first-"
                        "person voice, meaning, level of certainty, requests for help, and all factual details. Do not "
                        "invent learning, examples, workplace experience, outcomes, claims or achievements. Do not make "
                        "the answer sound more advanced than the learner's original meaning. Accept learning reflections, "
                        "questions, difficulties and requests for learning support. Reject only clearly unrelated or "
                        "inappropriate content. Return the required JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Activity: {activity_title}\n"
                        f"Module: {module_label or 'Not provided'}\n"
                        f"Week: {week_label or 'Not provided'}\n\n"
                        "Untrusted learner text follows between delimiters:\n"
                        "<learner_text>\n"
                        f"{original_text}\n"
                        "</learner_text>"
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "proofread_learning_reflection",
                    "schema": PROOFREAD_SCHEMA,
                    "strict": True,
                }
            },
        )
        reviewed = json.loads(response.output_text)
        if not reviewed.get("accepted"):
            return _error(
                reviewed.get("reason") or "This text is not suitable for a learning reflection.",
                422,
                "proofread_rejected",
            )

        improved_text = str(reviewed.get("improved_text") or "").strip()
        if not improved_text:
            return _error("No improved text was produced.", 502, "empty_proofread_result")
        if _moderation_flagged(client, improved_text):
            return _error(
                "The improved text did not pass the content check.",
                422,
                "inappropriate_content",
            )

        return JsonResponse({
            "text": improved_text,
            "language": "en-GB",
            "model": settings.OPENAI_REFLECTION_MODEL,
        })
    except Exception:
        logger.exception("Reflection proofreading failed")
        return _error(
            "We could not proofread the reflection right now. Please try again.",
            502,
            "proofread_failed",
        )


@csrf_exempt
@require_POST
def transcribe_reflection(request):
    if not settings.OPENAI_API_KEY:
        return _error("Voice transcription is not configured.", 503, "openai_not_configured")

    uploaded = request.FILES.get("audio")
    if uploaded is None:
        return _error("No audio recording was provided.", 400, "missing_audio")
    if uploaded.size <= 0:
        return _error("The audio recording is empty.", 400, "empty_audio")
    if uploaded.size > MAX_AUDIO_BYTES:
        return _error("The recording is too large. Please keep it under 15 MB.", 413, "audio_too_large")

    content_type = (uploaded.content_type or "").split(";", 1)[0].lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        return _error("This audio format is not supported.", 415, "unsupported_audio")

    client = _openai_client()
    if client is None:
        return _error("Voice transcription is unavailable on the server.", 503, "openai_package_missing")

    activity_title = (request.POST.get("activityTitle") or "learning activity").strip()[:300]
    module_label = (request.POST.get("moduleLabel") or "").strip()[:300]
    week_label = (request.POST.get("weekLabel") or "").strip()[:120]

    try:
        uploaded.seek(0)
        transcription = client.audio.transcriptions.create(
            model=settings.OPENAI_TRANSCRIPTION_MODEL,
            file=(uploaded.name or "reflection.webm", uploaded.read(), content_type),
            language="en",
            prompt=(
                "The speaker is a UK apprentice giving a learning reflection in British English. "
                "Preserve the learner's meaning and use UK spelling for recognised words."
            ),
        )
        transcript = (getattr(transcription, "text", "") or "").strip()
        if not transcript:
            return _error("No clear speech was detected. Please try recording again.", 422, "no_speech")

        if _moderation_flagged(client, transcript):
            return _error(
                "The recording contains language that cannot be added to a learning reflection.",
                422,
                "inappropriate_content",
            )

        response = client.responses.create(
            model=settings.OPENAI_REFLECTION_MODEL,
            input=[
                {
                    "role": "system",
                    "content": (
                        "You review apprentice voice answers entered in a learning reflection form. Accept speech "
                        "about what the learner learned, understood, practised, found useful, found difficult, did "
                        "not understand, wants clarified, needs help with, or plans to apply from the stated learning "
                        "activity. Questions and requests for learning support are valid learning-related answers "
                        "and must be accepted. A short, vague, incomplete, or simple educational statement is also "
                        "acceptable; do not reject it for lacking detail, not sounding like a formal reflection, or "
                        "being shorter than the target word count. Reject only content that is clearly unrelated to "
                        "education or the activity, or contains profanity, sexual content, harassment, hate, threats, "
                        "or personal attacks. If accepted, lightly edit "
                        "the transcript into clear natural British English. Preserve the learner's facts, meaning "
                        "and first-person voice. Remove verbal filler and accidental repetition. Do not add new "
                        "learning, examples, workplace experience, claims, or achievements. Return the required JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Activity: {activity_title}\n"
                        f"Module: {module_label or 'Not provided'}\n"
                        f"Week: {week_label or 'Not provided'}\n\n"
                        "Untrusted transcript follows between delimiters:\n"
                        "<transcript>\n"
                        f"{transcript}\n"
                        "</transcript>"
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "learning_reflection_review",
                    "schema": REFLECTION_SCHEMA,
                    "strict": True,
                }
            },
        )
        reviewed = json.loads(response.output_text)
        if not reviewed.get("accepted"):
            return _error(
                reviewed.get("reason") or "Please record an answer focused on what you learned.",
                422,
                "not_learning_focused",
            )

        clean_text = str(reviewed.get("clean_text") or "").strip()
        if not clean_text:
            return _error("No usable learning reflection was produced.", 422, "empty_reflection")
        if _moderation_flagged(client, clean_text):
            return _error(
                "The recording contains language that cannot be added to a learning reflection.",
                422,
                "inappropriate_content",
            )

        return JsonResponse({
            "text": clean_text,
            "language": "en-GB",
            "models": {
                "transcription": settings.OPENAI_TRANSCRIPTION_MODEL,
                "review": settings.OPENAI_REFLECTION_MODEL,
                "moderation": settings.OPENAI_MODERATION_MODEL,
            },
        })
    except Exception:
        logger.exception("Voice reflection processing failed")
        return _error(
            "We could not process the recording right now. Please try again.",
            502,
            "voice_processing_failed",
        )
