"""One evidence reader shared by the drawer, downloads and keyword checks."""
import logging
from django.db import DatabaseError
from .recordings_saved_evidence import saved_evidence as source_evidence
from .recordings_transcripts import local_transcript, cached_microsoft_transcript, microsoft_transcript
from .recordings_parts import merge_transcripts

log = logging.getLogger(__name__)


def saved_evidence(record, job, *, learner_ids=None, part='all'):
    data = source_evidence(record, job, learner_ids=learner_ids, part=part)
    if part == 'attendance' or data['transcript']:
        return data
    try:
        transcript = local_transcript(record) or cached_microsoft_transcript(record, job)
    except (DatabaseError, ValueError):
        log.warning('Local coaching transcript could not be read.')
        transcript = cached_microsoft_transcript(record, job)
    return {**data, 'state': 'matched', 'analysisState': data['state'], 'transcript': transcript} if transcript else data


def check_microsoft_transcript(record, job, data):
    value = microsoft_transcript(record, job)
    transcript=merge_transcripts(data['transcript'],value['transcript'])
    return {**data, **({'state': 'matched', 'analysisState': data.get('analysisState', data['state']),
        'transcript': transcript} if transcript else {}),
        'transcriptCheck': {key: value[key] for key in ('state', 'code')}}
