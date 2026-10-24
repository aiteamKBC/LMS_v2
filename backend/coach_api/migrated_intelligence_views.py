"""Opt-in Teams intelligence for an owned Aptem review overlay.

GET reads local state only. POST can start an eligible scheduled local review
from verified meeting evidence; it never changes the Aptem source.
"""
import hashlib
import json
from uuid import UUID
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from coach_api.auth import coach_access_required
from coach_api.migrated_completion_views import _coach_review
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance
from coach_api.migrated_reviews import SCHEDULED_WORK_STATUSES, meeting_summary_field
from coach_api.migrated_summary_binding import answer_version, binding_state, populate_answer, preserve_original
from coach_api.migrated_summary_generation import apply_suggestion, generation_status, summary_binding_response
from coach_api.migrated_summary_errors import summary_generation_error
from coach_api.migrated_template_sync import active_answers, snapshot_fingerprint
from .migrated_session_scope import booking_window, current_reports, report_window, scope_snapshot, session_provenance, summary_matches_session
from .migrated_summary_attempts import claim, owns, release, SummaryInProgress


def _association(request, review_id, *, lock=False):
    from coach_api.views import _owned_migrated_overlay
    from coach_api.review_sources import booking_for_overlay, ReviewIdentityConflict

    owner, definition = _coach_review(request, review_id)
    if not definition:
        return None, None, None
    overlay = None
    try:
        overlay = _owned_migrated_overlay(owner, definition, **({'lock': True, 'lock_calendar': True} if lock else {}))
        if not overlay:
            return None, None, None
        record = booking_for_overlay(overlay, lock=lock)
    except ReviewIdentityConflict:
        return overlay, None, definition
    family = definition["template"]["reviewTypeCode"]
    if family not in {"aptem_mcm", "aptem_progress_review"} or not record or (
        record.owner_email.casefold() != owner
        or record.event_type != ("mcr" if family == "aptem_mcm" else "progress-review")
        or not record.graph_event_id
        or record.sync_state != CoachCalendarEvent.SYNC_SYNCED
    ):
        return overlay, None, definition
    return overlay, record, definition


def _meeting_end(record):
    return booking_window(record)[1]


def _graph_target_failure(exc):
    """Imported adapter diagnostics; never expose provider bodies or target IDs."""
    cause = exc.__cause__ or exc
    upstream = getattr(cause, 'code', None)
    status, code, detail = {
        401: (502, 'GRAPH_AUTHENTICATION_FAILED', 'Microsoft could not authenticate the meeting service.'),
        403: (403, 'GRAPH_PERMISSION_ERROR', 'Microsoft denied access to this meeting. Ask support to check organizer access.'),
        404: (404, 'GRAPH_MEETING_NOT_FOUND', 'Microsoft could not find the linked meeting for this organizer.'),
        429: (429, 'GRAPH_THROTTLED', 'Microsoft temporarily limited meeting requests. Wait before checking again.'),
    }.get(upstream, (502, 'GRAPH_FETCH_FAILED', 'Microsoft could not resolve the linked meeting. Retry the session check.'))
    if isinstance(cause, TimeoutError) or isinstance(getattr(cause, 'reason', None), TimeoutError):
        status, code, detail = 504, 'GRAPH_TIMEOUT', 'Microsoft did not respond in time. Retry the session check.'
    payload = {'code': code, 'detail': detail, 'stage': 'meeting-target'}
    if isinstance(upstream, int):
        payload['graphStatus'] = upstream
    headers = getattr(cause, 'headers', None) or {}
    try:
        payload['request_id'] = str(UUID(str(headers.get('request-id', ''))))
    except (ValueError, TypeError, AttributeError):
        pass
    retry = str(headers.get('Retry-After', ''))
    if upstream == 429 and retry.isascii() and retry.isdigit() and len(retry) <= 8:
        payload['retryAfterSeconds'] = int(retry)
        payload['detail'] = f'Microsoft temporarily limited meeting requests. Wait {int(retry)} seconds before checking again.'
    return None, payload, status


def _transcript_collection(path):
    """Complete imported transcript metadata before any content is downloaded.

    Bound work and follow only the same Graph collection. Native/generic callers
    retain their existing fetch policy. An unfinished list is a failed resource,
    never evidence that the first page is a complete transcript.
    """
    from coach_api.views import get_graph_settings, microsoft_graph_request

    root = get_graph_settings()['base_url'].rstrip('/')
    collection = urlsplit(f'{root}/{path.lstrip("/")}')
    seen, rows = set(), {}
    for _ in range(5):
        if path in seen:
            raise RuntimeError('Teams transcript pagination repeated a page.')
        seen.add(path)
        page = microsoft_graph_request('GET', path)
        if not isinstance(page, dict) or not isinstance(page.get('value'), list):
            raise RuntimeError('Teams transcript metadata was incomplete.')
        for row in page['value']:
            if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'].strip():
                raise RuntimeError('Teams transcript metadata was incomplete.')
            if row['id'] in rows and rows[row['id']] != row:
                raise RuntimeError('Teams transcript metadata changed between pages.')
            rows[row['id']] = row
            if len(rows) > 100:
                raise RuntimeError('Teams transcript metadata exceeded the session check limit.')
        next_link = page.get('@odata.nextLink')
        if not next_link:
            return {'value': list(rows.values())}
        if not isinstance(next_link, str):
            raise RuntimeError('Teams transcript continuation was invalid.')
        try:
            next_page = urlsplit(next_link)
        except ValueError:
            raise RuntimeError('Teams transcript continuation was invalid.') from None
        if (next_page.scheme, next_page.netloc, next_page.path) != (collection.scheme, collection.netloc, collection.path) or next_page.fragment:
            raise RuntimeError('Teams transcript continuation did not match this meeting.')
        # The shared transport prefixes base_url. Retain the opaque query exactly.
        path = next_link[len(root) + 1:]
    raise RuntimeError('Teams transcript metadata exceeded the session check page limit.')


def _has_ended_session(record, snapshot, now):
    """A Graph attendance report proves a session ended, not a stopped recording.

    Only accept a report overlapping this booking. The same Teams URL can retain
    reports from earlier occurrences or from before a reschedule.
    """
    return any(report_window(report)[1] <= now for report in current_reports(record, snapshot))


def _summary(state):
    if not isinstance(state.get("summary"), dict):
        return None
    return {
        "summary": state["summary"],
        "status": state.get("summaryStatus", "ready"),
        "generatedAt": state.get("generatedAt"),
        "editedAt": state.get("editedAt"),
        "editedBy": state.get("editedBy", ""),
        "model": state.get("model", ""),
        "error": state.get("summaryError", ""),
    }


def _response(overlay, record, snapshot=None, *, errors=None, status=200):
    from coach_api.views import public_coach_meeting_artifact, stored_coach_meeting_snapshot, stored_coach_meeting_transcript_for_summary

    snapshot = scope_snapshot(record, snapshot if snapshot is not None else stored_coach_meeting_snapshot(record))
    state = overlay.meeting_intelligence or {}
    binding = summary_binding_response(overlay)
    latest_status = generation_status(state)
    codes = [code for code in state.get("errorCodes", []) if code != "AI_SUMMARY_FAILED"]
    summary = _summary(state)
    if summary and state.get('source') != 'uploaded_transcript' and (
            state.get('eventKey') != record.event_key or state.get('graphEventId') != record.graph_event_id
            or not state.get('transcriptArtifactId') or not state.get('transcriptHash')
            or not summary_matches_session(state, record, stored_coach_meeting_transcript_for_summary(record))):
        summary = None
        codes.append('SUMMARY_SESSION_MISMATCH')
    if latest_status == "failed":
        codes.append("AI_SUMMARY_FAILED")
    return JsonResponse({
        "event": {
            "eventKey": record.event_key,
            "source": record.event_type,
            "status": overlay.status,
            "learner": record.learner_name,
            "scheduledDate": record.scheduled_date.isoformat() if record.scheduled_date else None,
            "scheduledTime": record.scheduled_time.isoformat() if record.scheduled_time else None,
        },
        "attendance": snapshot["attendance"],
        "artifacts": [public_coach_meeting_artifact(item) for item in snapshot["artifacts"]],
        "meetingSummary": summary,
        "summaryBinding": binding,
        "progressVersion": answer_version(overlay),
        "answerVersion": answer_version(overlay),
        "reviewAnswers": active_answers(overlay.template_snapshot, overlay.answers),
        "intelligence": {
            "lastCheckedAt": state.get("lastCheckedAt"),
            "attendanceStatus": state.get("attendanceStatus", "not-checked"),
            "recordingStatus": state.get("recordingStatus", "unknown"),
            "transcriptStatus": state.get("transcriptStatus", "not-checked"),
            "summaryStatus": latest_status,
            "generationError": (state.get("summaryGeneration") or {}).get("error") if latest_status == "failed" else None,
            "transcriptArtifactId": state.get("transcriptArtifactId"),
            "errorCodes": codes,
        },
        "errors": errors if errors is not None else snapshot.get("errors", []),
        "partial": bool(errors if errors is not None else snapshot.get("partial")) or latest_status == "failed",
        "storage": snapshot.get("storage", {"stored": False}),
    }, status=status)


@coach_access_required
@require_GET
def migrated_review_intelligence(request, review_id):
    overlay, record, _definition = _association(request, review_id)
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if not record:
        return JsonResponse({"detail": "Migrated Teams meeting association is missing or inconsistent.", "code": "MEETING_NOT_FOUND"}, status=409)
    return _response(overlay, record)


def _check_basis(overlay, record):
    return (
        tuple(getattr(overlay, name, None) for name in ('pk', 'owner_email', 'learner_id', 'source_review_id', 'event_key')),
        tuple(getattr(record, name, None) for name in ('pk', 'event_key', 'owner_email', 'learner_id', 'graph_event_id',
                                                      'event_type', 'status', 'scheduled_date', 'scheduled_time', 'duration_minutes',
                                                      'meeting_link', 'graph_organizer_email')),
        snapshot_fingerprint(overlay.template_snapshot),
    )


def _check_writable(overlay, record, definition):
    if not overlay or not record:
        return JsonResponse({'detail': 'Review ownership or meeting association changed. Reload the review.', 'code': 'MEETING_NOT_FOUND'}, status=409)
    if (overlay.status not in SCHEDULED_WORK_STATUSES or definition.get('readOnly') or definition.get('previewOnly')
            or (definition.get('templateSync') or {}).get('status') == 'conflict'):
        return JsonResponse({'detail': 'Meeting intelligence is read-only at this review stage.'}, status=409)
    binding = binding_state(overlay)
    if binding.get('status') == 'invalid-binding':
        return JsonResponse({'detail': binding['message'], 'code': 'INVALID_SUMMARY_BINDING'}, status=409)
    return None


def _checked_lock(request, review_id, basis):
    overlay, record, definition = _association(request, review_id, lock=True)
    error = _check_writable(overlay, record, definition or {})
    if error is None:
        current = _check_basis(overlay, record)
        if current[2] != basis[2]:
            error = JsonResponse({'detail': 'The review template changed during generation. Reopen the review. Your saved answers are unchanged.',
                                  'code': 'template_sync_changed'}, status=409)
        elif current[:2] != basis[:2]:
            error = JsonResponse({'detail': 'Review ownership or meeting association changed during Check Session.', 'code': 'BOOKING_CONFLICT'}, status=409)
    return overlay, record, error


@coach_access_required
@require_POST
def migrated_review_check_session(request, review_id):
    from coach_api.views import (
        fetch_coach_meeting_graph_snapshot, openai_meeting_summary, meeting_summary_transcript_excerpt,
        persist_coach_meeting_snapshots, stored_coach_meeting_snapshot, stored_coach_meeting_transcript_for_summary,
    )

    overlay, record, definition = _association(request, review_id)
    if not overlay:
        return JsonResponse({'detail': 'Migrated review not found for this coach.'}, status=404)
    error = _check_writable(overlay, record, definition or {})
    if error is not None:
        return error
    basis = _check_basis(overlay, record)
    meeting_end = _meeting_end(record)
    if not meeting_end:
        return JsonResponse({'detail': 'The meeting needs a scheduled date and time before checking the session.'}, status=409)
    from .migrated_session_scope import attendance_reports_for_refresh, snapshot_version, validate_attendance_response
    previous = stored_coach_meeting_snapshot(record)
    expected_version = snapshot_version(previous)
    snapshot, error, status_code = fetch_coach_meeting_graph_snapshot(
        record, target_error_handler=_graph_target_failure, transcript_collection_fetcher=_transcript_collection,
        attendance_response_validator=validate_attendance_response)
    if error:
        code = error.get('code')
        if code == 'coach_online_meeting_unresolved':
            error = {**error, 'detail': 'Microsoft did not return a matching online meeting. Check the organizer, meeting association and access configuration.'}
            code = 'GRAPH_MEETING_UNRESOLVED'
        elif error.get('stage') != 'meeting-target':
            code = 'GRAPH_PERMISSION_ERROR' if status_code == 403 else 'MEETING_NOT_FOUND' if status_code == 409 else 'GRAPH_FETCH_FAILED'
        response = JsonResponse({**error, 'code': code}, status=status_code)
        if error.get('retryAfterSeconds') is not None:
            response['Retry-After'] = str(error['retryAfterSeconds'])
        return response
    now = timezone.now()
    from .imported_review_start import has_start_evidence, start_locked
    if has_start_evidence(record, snapshot):
        # Starting the Review is distinct from confirming the end for AI. A
        # valid early transcript may start it while the existing end gate still
        # rejects summary generation. Revalidate under the same writer locks.
        with transaction.atomic():
            locked, current_record, error = _checked_lock(request, review_id, basis)
            if error is not None:
                return error
            current_snapshot = stored_coach_meeting_snapshot(current_record)
            if snapshot_version(current_snapshot) != expected_version:
                return JsonResponse({'detail': 'Meeting evidence changed during Check Session. Retry the check.',
                                     'code': 'BOOKING_CONFLICT'}, status=409)
            family = 'MCM' if current_record.event_type == 'mcr' else 'PR'
            if start_locked(locked, current_record, family):
                basis = _check_basis(locked, current_record)
                record.status = current_record.status
    errors = list(snapshot.get('errors') or [])
    attendance_failed = any('attendance' in message.lower() for message in errors)
    if now < meeting_end and not (_has_ended_session(record, snapshot, now) or _has_ended_session(record, previous, now)):
        start, end = booking_window(record)
        timing = {'scheduledStart': start.isoformat(), 'scheduledEnd': end.isoformat(), 'timeZone': settings.TIME_ZONE}
        end_label = end.astimezone(ZoneInfo(settings.TIME_ZONE)).strftime('%d %b %Y %H:%M %Z')
        if attendance_failed:
            denied = (snapshot.get('resourceErrors') or {}).get('attendance') == 'permission'
            return JsonResponse({
                'detail': ('Microsoft denied access to the attendance report. Ask support to check Teams permissions.' if denied else
                           'The attendance report could not be fetched. Retry the session check; if it continues, contact support.')
                          + f' Session end cannot be confirmed yet. Scheduled end: {end_label} ({settings.TIME_ZONE}).',
                'code': 'GRAPH_PERMISSION_ERROR' if denied else 'ATTENDANCE_FETCH_FAILED', **timing,
            }, status=403 if denied else 502)
        return JsonResponse({
            'detail': 'Teams has not confirmed that this session has ended yet. If the call has ended, wait for its attendance report and check again. '
                      f'You can also check after the scheduled end: {end_label} ({settings.TIME_ZONE}).',
            'code': 'MEETING_END_NOT_CONFIRMED', **timing,
        }, status=409)

    # Cached evidence is eligible only for the same Graph event and call window.
    fresh = {(row.get('artifact_type'), row.get('graph_artifact_id')) for row in snapshot['artifacts']}
    cached = [row for row in previous.get('artifacts', [])
              if (row.get('metadata') or {}).get('_lms_graph_event_id') == record.graph_event_id
              and (row.get('artifact_type'), row.get('graph_artifact_id')) not in fresh]
    reports = attendance_reports_for_refresh(record, snapshot, previous)
    selected = scope_snapshot(record, {**snapshot, 'artifacts': [*cached, *snapshot['artifacts']], 'attendanceReports': reports})
    if reports and not current_reports(record, snapshot) and reports == previous.get('attendanceReports'):
        selected['attendanceTracker'] = previous.get('attendanceTracker') or selected['attendanceTracker']
    if selected['selectionError']:
        return JsonResponse({'detail': 'The transcript cannot be matched to one booked session. Multiple calls or missing call timing need review. Upload the correct session transcript instead.',
                             'code': selected['selectionError']}, status=409)
    transcript_rows = [row for row in selected['artifacts'] if row.get('artifact_type') == 'transcript']
    transcript_ids = sorted({row['graph_artifact_id'] for row in transcript_rows})
    persistable = [{**row, 'metadata': {**(row.get('metadata') or {}), '_lms_graph_event_id': record.graph_event_id}}
                   for row in selected['artifacts'] if not row.get('transcript_fetch_error')]
    token = None
    try:
        # All writers use learner -> calendar -> overlay. No provider I/O here.
        with transaction.atomic():
            locked, current_record, error = _checked_lock(request, review_id, basis)
            if error is not None:
                return error
            storage = persist_coach_meeting_snapshots(current_record, artifacts=persistable,
                attendance_reports=selected['attendanceReports'], attendance_tracker=selected['attendanceTracker'],
                imported_refresh={'snapshot': selected, 'expected_version': expected_version,
                    'start_review': (locked, 'MCM' if current_record.event_type == 'mcr' else 'PR', False)})
            if not storage.get('stored'):
                if storage.get('reason') in {'snapshot_superseded', 'snapshot_context_changed'}:
                    return JsonResponse({'detail': 'Meeting evidence changed during Check Session. Retry the check.',
                                         'code': 'BOOKING_CONFLICT'}, status=409)
                return JsonResponse({'detail': 'Teams snapshot storage is unavailable.', 'code': 'SNAPSHOT_STORAGE_UNAVAILABLE'}, status=503)
            if storage.get('reviewStarted'):
                # Our own status-only transition is now the basis. All other
                # booking/template changes still invalidate the provider wait.
                basis = _check_basis(locked, current_record)
                record.status = current_record.status
            transcript = stored_coach_meeting_transcript_for_summary(current_record, artifact_ids=transcript_ids)
            # A successful segment does not establish that the whole selected
            # call is available. A complete, same-event stored copy may recover
            # an individual content failure; a failed collection cannot prove
            # that all current segments were even listed.
            stored_ids = set((transcript or {}).get('artifactId', '').split(',')) - {''}
            incomplete = bool((snapshot.get('resourceErrors') or {}).get('transcripts')) or (
                bool(transcript_ids) and stored_ids != set(transcript_ids))
            if incomplete:
                transcript = None
                errors.append('The complete Teams transcript could not be retrieved. Retry Check Session or upload the complete session transcript. Your saved answer is unchanged.')
            prior_state = locked.meeting_intelligence or {}
            if (prior_state.get('summary') and prior_state.get('source') != 'upload'
                    and not summary_matches_session(prior_state, current_record, transcript)):
                errors.append('The stored suggestion cannot be verified for this session. Your saved answers are unchanged.')
            if transcript and not (locked.meeting_intelligence or {}).get('summary'):
                try:
                    token = claim(locked)
                except SummaryInProgress as exc:
                    return JsonResponse({'detail': str(exc), 'code': 'SUMMARY_IN_PROGRESS'}, status=409)

        generated, generation_error = None, None
        if token:
            try:
                generated = openai_meeting_summary(record, transcript['text'])
            except Exception as exc:
                generation_error = summary_generation_error(request, exc)

        with transaction.atomic():
            locked, current_record, error = _checked_lock(request, review_id, basis)
            if error is not None:
                return error
            if token and not owns(locked, token):
                return JsonResponse({'detail': 'A newer summary request replaced this attempt. Refresh the review.', 'code': 'SUMMARY_SUPERSEDED'}, status=409)
            state = dict(locked.meeting_intelligence or {})
            if token:
                state.pop('_summaryAttempt', None)
            preserve_original(state)
            fetch_failed = any(row.get('transcript_fetch_error') for row in transcript_rows) or any('transcript' in msg.lower() for msg in errors)
            gone = not transcript and any(' 410 ' in f" {row.get('transcript_fetch_error', '')} " for row in transcript_rows)
            codes = (['ATTENDANCE_NOT_AVAILABLE'] if attendance_failed else [])
            if incomplete:
                codes.append('TRANSCRIPT_INCOMPLETE')
            if (state.get('summary') and state.get('source') != 'upload'
                    and not summary_matches_session(state, current_record, transcript)):
                codes.append('SUMMARY_SESSION_MISMATCH')
            if not transcript:
                codes.append('TRANSCRIPT_UNAVAILABLE' if gone else 'TRANSCRIPT_FETCH_FAILED' if fetch_failed else 'TRANSCRIPT_PENDING')
            elif fetch_failed:
                codes.append('TRANSCRIPT_FETCH_FAILED')
            recording_failed = any('recordings' in msg.lower() for msg in errors)
            if recording_failed:
                codes.append('RECORDING_FETCH_FAILED')
            state.update(lastCheckedAt=timezone.now().isoformat(),
                attendanceStatus='available' if reports else 'fetch-failed' if attendance_failed else 'not-available',
                recordingStatus='available' if any(row.get('artifact_type') == 'recording' for row in selected['artifacts']) else 'unknown' if recording_failed else 'not-available',
                transcriptStatus='available' if transcript else 'unavailable' if gone else 'fetch-failed' if fetch_failed else 'pending', errorCodes=codes)
            if generated:
                summary, model = generated
                state.update(summary=summary, summaryStatus='ready', generatedAt=timezone.now().isoformat(),
                    generatedFromTranscript=True, transcriptArtifactId=transcript['artifactId'],
                    transcriptHash=hashlib.sha256(transcript['text'].encode('utf-8')).hexdigest(), model=model,
                    summaryError='', source='teams', eventKey=record.event_key, graphEventId=record.graph_event_id,
                    sessionProvenance=session_provenance(record),
                    generatedBy=locked.owner_email, transcriptTruncated=meeting_summary_transcript_excerpt(transcript['text'])[1])
                state.pop('summaryGeneration', None)
                preserve_original(state)
            elif generation_error:
                state.update(summaryStatus='failed', summaryError='AI summary generation failed. Check Session can retry.')
                codes.append('AI_SUMMARY_FAILED')
            if (transcript and isinstance(state.get('summary'), dict) and state.get('summaryStatus') == 'ready'
                    and summary_matches_session(state, current_record, transcript)):
                if binding_state(locked, state).get('fieldKey'):
                    provenance = {key: state.get(key) for key in ('generatedAt', 'generatedBy', 'model', 'transcriptArtifactId', 'transcriptHash')}
                    provenance.update(source='teams', eventKey=state.get('eventKey') or record.event_key, graphEventId=state.get('graphEventId'),
                                      transcriptTruncated=bool(state.get('transcriptTruncated')))
                    result = apply_suggestion(locked, state, state['summary'], provenance)
                else:
                    result = populate_answer(locked, state, '')
            else:
                result = populate_answer(locked, state, '')
                if result.get('fieldKey') or generation_error or state.get('summaryGeneration'):
                    state['summaryGeneration'] = {'status': 'failed' if generation_error else 'unavailable', 'source': 'teams',
                        'attemptedAt': timezone.now().isoformat(), 'attemptedBy': locked.owner_email, 'bindingResult': result.get('status')}
                    if generation_error:
                        state['summaryGeneration']['error'] = generation_error
            locked.meeting_intelligence = state
            locked.save(update_fields=['meeting_intelligence', 'updated_at'] + (['answers'] if result.get('status') == 'populated' else []))
            return _response(locked, current_record, errors=errors, status=207 if errors else 200)
    finally:
        if token:
            release(overlay.pk, overlay.owner_email, token)


@coach_access_required
def migrated_review_summary(request, review_id):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Method not allowed."}, status=405)
    from coach_api.views import normalize_meeting_summary_payload

    overlay, record, _definition = _association(request, review_id)
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if not record:
        return JsonResponse({"detail": "Migrated Teams meeting association is missing or inconsistent."}, status=409)
    try:
        payload = json.loads(request.body or b"{}")
    except (UnicodeDecodeError, ValueError):
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    if not isinstance(payload, dict) or not isinstance(payload.get("summary"), dict):
        return JsonResponse({"detail": "summary must be an object."}, status=400)
    summary = normalize_meeting_summary_payload(payload["summary"], record.event_type)
    with transaction.atomic():
        locked = ImportedReviewInstance.objects.select_for_update().get(pk=overlay.pk)
        if locked.status not in SCHEDULED_WORK_STATUSES:
            return JsonResponse({"detail": "Only scheduled or in-progress migrated summaries can be edited."}, status=409)
        if snapshot_fingerprint(locked.template_snapshot) != snapshot_fingerprint(overlay.template_snapshot):
            return JsonResponse({"detail": "The review template changed. Reopen the review before editing its summary.", "code": "template_sync_changed"}, status=409)
        try:
            if meeting_summary_field(getattr(locked, "template_snapshot", {}) or {}):
                return JsonResponse({"detail": "Edit the Meeting Summary answer in the review form."}, status=409)
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=409)
        state = dict(locked.meeting_intelligence or {})
        if not isinstance(state.get("summary"), dict):
            return JsonResponse({"detail": "Generate the meeting summary before editing it."}, status=409)
        preserve_original(state)
        state.update({
            "summary": summary,
            "summaryStatus": "edited",
            "editedAt": timezone.now().isoformat(),
            "editedBy": request.login_account.email,
        })
        locked.meeting_intelligence = state
        locked.save(update_fields=["meeting_intelligence", "updated_at"])
    return JsonResponse({"meetingSummary": _summary(state), "answerVersion": answer_version(locked),
                         "progressVersion": answer_version(locked), "summaryBinding": summary_binding_response(locked),
                         "reviewAnswers": active_answers(locked.template_snapshot, locked.answers)})
