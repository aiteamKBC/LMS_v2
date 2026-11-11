"""Build English WebVTT from saved, verified transcript links; no I/O."""
import math
from html import escape

from .session_media_policy import artifact_metadata, recording_transcript_links
from .session_results_policy import instant


def webvtt(cues):
    def stamp(value):
        millis = round(value * 1000)
        seconds, millis = divmod(millis, 1000)
        minutes, seconds = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)
        return f'{hours:02}:{minutes:02}:{seconds:02}.{millis:03}'

    lines, seen = ['WEBVTT', ''], set()
    for cue in sorted(cues, key=lambda item: item['start']):
        start, end = cue['start'], cue['end']
        if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (start, end)):
            continue
        start = max(0, start)
        if round(end * 1000) <= round(start * 1000):
            continue
        text = str(cue.get('text') or '').strip()
        if not text:
            continue
        speaker = str(cue.get('speaker') or '').strip()
        text = escape((speaker + ': ' if speaker else '') + text)
        # A blank line terminates a VTT cue; keep a multi-paragraph utterance together.
        text = '\n'.join(line for line in text.splitlines() if line.strip())
        identity = (start, end, text)
        if identity in seen:
            continue
        seen.add(identity)
        lines.extend([f'{stamp(start)} --> {stamp(end)}', text, ''])
    return '\n'.join(lines) if seen else None


def recording_captions(recording, artifacts):
    links = recording_transcript_links(recording, artifacts)
    # Do not publish a partial track when another matched transcript is still pending.
    if not links or any(not link['timingReady'] or link['offsetSeconds'] is None for link in links):
        return None
    by_id = {item['id']: item for item in artifacts}
    begin, finish = instant(recording.get('created_datetime')), instant(recording.get('end_datetime'))
    duration = (finish - begin).total_seconds() if begin and finish and finish > begin else math.inf
    cues = []
    for link in links:
        for cue in artifact_metadata(by_id[link['id']])['lmsTranscriptTimeline']['cues']:
            start, end = cue.get('start'), cue.get('end')
            if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (start, end)):
                continue
            cues.append({**cue, 'start': start + link['offsetSeconds'],
                         'end': min(duration, end + link['offsetSeconds'])})
    return webvtt(cues)
