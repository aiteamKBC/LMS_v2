"""Migrated summary suggestions; no Graph transport or Native lifecycle changes."""
from copy import deepcopy
import hashlib
import re

from django.utils import timezone

from .migrated_summary_binding import binding_state, populate_answer, preserve_original
from .migrated_reviews import TEXT_ANSWER_LIMIT


TIMING = re.compile(r"(?P<start>(?:\d{2,}:)?\d{2}:\d{2}\.\d{3})[ \t]+-->[ \t]+(?P<end>(?:\d{2,}:)?\d{2}:\d{2}\.\d{3})(?:[ \t]+[^\n]*)?")


def _timestamp(value):
    parts = value.split(":")
    minutes, seconds = int(parts[-2]), float(parts[-1])
    if minutes >= 60 or seconds >= 60:
        raise ValueError("The WebVTT transcript contains an invalid timestamp.")
    return (int(parts[0]) * 3600 if len(parts) == 3 else 0) + minutes * 60 + seconds


def parse_upload(upload):
    from .views import COACH_MEETING_TRANSCRIPT_UPLOAD_MAX_BYTES, coach_meeting_transcript_text

    if upload is None:
        raise ValueError("Select a .vtt or .txt transcript.")
    filename = str(upload.name).replace("\\", "/").rsplit("/", 1)[-1]
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension not in {"vtt", "txt"}:
        raise ValueError("Upload a transcript with a .vtt or .txt file extension.")
    if (upload.content_type or "").split(";", 1)[0].lower() not in {"", "text/vtt", "text/plain", "application/octet-stream"}:
        raise ValueError("Upload a plain-text .vtt or .txt transcript.")
    limit = COACH_MEETING_TRANSCRIPT_UPLOAD_MAX_BYTES
    if upload.size > limit:
        raise ValueError("The transcript must be no larger than 5 MB.")
    content = upload.read(limit + 1)
    if not content or len(content) > limit:
        raise ValueError("The transcript is empty or larger than the 5 MB limit.")
    try:
        decoded = content.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    except UnicodeDecodeError:
        raise ValueError("The transcript must use UTF-8 text encoding.") from None
    if any((ord(c) < 32 and c not in "\t\n") or 127 <= ord(c) < 160 for c in decoded):
        raise ValueError("The transcript contains binary or unsupported control characters.")
    text = decoded.strip()
    if extension == "vtt":
        blocks = re.split(r"\n[ \t]*\n", text)
        if not re.fullmatch(r"WEBVTT(?:[ \t].*)?", blocks[0].split("\n")[0]) or "-->" in blocks[0]:
            raise ValueError("The uploaded file is not a valid WebVTT transcript.")
        cues = []
        for block in blocks[1:]:
            lines = block.split("\n")
            if re.match(r"^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)", lines[0]):
                continue
            index = 0 if "-->" in lines[0] else 1
            timing = TIMING.fullmatch(lines[index]) if len(lines) > index else None
            if not timing or len(lines) <= index + 1 or _timestamp(timing['end']) <= _timestamp(timing['start']):
                raise ValueError("The WebVTT transcript contains a malformed or empty cue.")
            if any("-->" in line for line in lines[index + 1:]):
                raise ValueError("Separate WebVTT cues with a blank line.")
            cues.append(block)
        # Reuse the same spoken-text/speaker extraction used by Native and Teams.
        text = coach_meeting_transcript_text("WEBVTT\n\n" + "\n\n".join(cues))
    if not text.strip():
        raise ValueError("The uploaded file does not contain any transcript text.")
    return text, {"source": "uploaded_transcript", "filename": filename,
                  "contentHash": hashlib.sha256(content).hexdigest(),
                  "transcriptHash": hashlib.sha256(text.encode("utf-8")).hexdigest()}


def apply_suggestion(overlay, state, summary, provenance):
    """Caller holds the overlay lock. Both input sources use the same write rule."""
    from .views import meeting_summary_plain_text

    preserve_original(state)
    text = meeting_summary_plain_text(summary)
    if not isinstance(state.get("aiSummaryOriginal"), dict):
        state["aiSummaryOriginal"] = deepcopy(summary)
        state["aiSummaryProvenance"] = deepcopy(provenance)
    state["latestSummarySuggestion"] = {"summary": deepcopy(summary), "provenance": deepcopy(provenance)}
    result = populate_answer(overlay, state, text)
    state["latestSummarySuggestion"]["bindingResult"] = result.get("status")
    state["summaryGeneration"] = {"status": "ready", "source": provenance["source"],
                                  "attemptedAt": timezone.now().isoformat(), "attemptedBy": overlay.owner_email,
                                  "bindingResult": result.get("status"), "transcriptHash": provenance.get("transcriptHash")}
    return result


def summary_binding_response(overlay):
    """Coach-only presentation; party detail already removes summaryBinding."""
    from .views import meeting_summary_plain_text

    result = binding_state(overlay)
    if not result.get("fieldKey"):
        return result
    state = overlay.meeting_intelligence or {}
    latest = state.get("latestSummarySuggestion") or {}
    provenance = latest.get("provenance") or {}
    if isinstance(latest.get("summary"), dict):
        text = meeting_summary_plain_text(latest["summary"])
        result.update(suggestionText=text, suggestionSource=provenance.get("source"),
                      summaryTooLong=len(text) > TEXT_ANSWER_LIMIT,
                      generatedAt=provenance.get("generatedAt"), transcriptTruncated=bool(provenance.get("transcriptTruncated")),
                      replacementAvailable=bool(text and text != result.get("answer") and result["state"] != "NEVER_POPULATED"))
    elif result.get("status") == "summary-too-long":
        result["suggestionText"] = meeting_summary_plain_text(state.get("aiSummaryOriginal") or {})
    result["generationStatus"] = (state.get("summaryGeneration") or {}).get("status")
    return result
