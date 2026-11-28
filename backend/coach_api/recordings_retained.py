"""Keep verified completed calls visible at their original calendar occurrence."""
from curriculum_api.models import CurriculumVideoImport
from .models import CoachingRecordingJob
from .recordings_calendar_media import calendar_key, event_context


def retained_events(owner, start, end, events):
    """Append only published historical calls, never recreate a Microsoft event."""
    from django.conf import settings
    from zoneinfo import ZoneInfo
    from .recordings_bunny import CUTOVER_DAY
    if end.astimezone(ZoneInfo(settings.TIME_ZONE)).date() < CUTOVER_DAY:
        return events
    assets = list(CurriculumVideoImport.objects.filter(target_kind='coach_recording', status='ready',
        scope__owner_email=owner, scope__original_occurrence_retained=True,
        scope__context__start__lt=end.isoformat(), scope__context__end__gt=start.isoformat()))
    if not assets:
        return events
    jobs = {job.pk: job for job in CoachingRecordingJob.objects.filter(kind='evidence', owner_email=owner,
        last_success_at__isnull=False, pk__in=[asset.scope.get('evidence_job') for asset in assets])}
    seen = {calendar_key(event_context(owner, event)) for event in events}
    output = list(events)
    for asset in assets:
        job = jobs.get(asset.scope.get('evidence_job'))
        if (not job or job.context != asset.scope.get('context') or job.context.get('owner') != owner
                or asset.target_id != calendar_key(job.context)
                or asset.scope.get('playback_verified_video_id') != asset.video_id):
            continue
        event = job.result.get('event') or {}
        artifact = next((item for item in job.result.get('artifacts', [])
                         if item.get('graph_artifact_id') == asset.scope.get('graph_artifact_id')), {})
        published = artifact.get('lmsBunnyRecording') or {}
        try:
            matches = event_context(owner, event) == job.context
        except (ValueError, TypeError, KeyError):
            matches = False
        if (not matches or event.get('isCancelled') or published.get('state') != 'ready'
                or published.get('importId') != str(asset.pk) or published.get('videoId') != asset.video_id
                or published.get('libraryId') != asset.library_id or asset.target_id in seen):
            continue
        seen.add(asset.target_id)
        output.append({**event, 'lmsHistoricalRecording': True})
    return output
