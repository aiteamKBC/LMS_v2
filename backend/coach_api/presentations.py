"""Read-only downloads of the presentation saved with owned submitted work."""
import json
from copy import deepcopy
from pathlib import PurePosixPath

from django.db import DatabaseError
from django.http import HttpResponse, JsonResponse
from django.utils.dateparse import parse_datetime
from django.utils.http import content_disposition_header

from learner_api.monthly_assignment import mapping, text
from old_otjh.repository import query
from .auth import coach_access_required

PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
PPT = 'application/vnd.ms-powerpoint'
MAX_UPLOAD = 50 * 1024 * 1024
MAX_REFERENCE = 15 * 1024 * 1024


class PresentationProblem(Exception):
    def __init__(self, message, status=404):
        super().__init__(message)
        self.status = status


def _document(raw):
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        value = None
    if not isinstance(value, dict):
        raise PresentationProblem('The saved presentation could not be read. Please contact support.', 503)
    return deepcopy(value)


def _current(request, submitted_at, version=None):
    """Refuse a newer submission than the one currently shown in the review."""
    if version is not None and request.GET.get('version') is not None:
        expected = request.GET['version']
        if len(expected) > 20 or not expected.isascii() or not expected.isdigit() or int(expected) < 1:
            raise PresentationProblem('Choose a valid submission version.', 400)
        if int(expected) != version:
            raise PresentationProblem('This submission changed. Reload it before downloading its presentation.', 409)
    if request.GET.get('submittedAt') is not None:
        try:
            expected = parse_datetime(request.GET['submittedAt'])
        except (ValueError, TypeError):
            expected = None
        actual = parse_datetime(submitted_at) if isinstance(submitted_at, str) else submitted_at
        if expected is None or expected.utcoffset() is None:
            raise PresentationProblem('A valid submittedAt timestamp is required.', 400)
        if actual is None or actual.utcoffset() is None or actual != expected:
            raise PresentationProblem('This submission changed. Reload it before downloading its presentation.', 409)


def _official(request, submission_id):
    rows = query('''SELECT s.learner_kind,s.learner_id,s.activity_id,s.full_submission,s.submitted_at
        FROM "Learner".learning_reflection_submissions s
        JOIN "Learner".learners l ON l.enrolment_id::text=s.learner_id AND l.learner_type=s.learner_kind
        JOIN enrolment."Created_users" u ON u.id=l.enrolment_id AND lower(btrim(u."Email"))=lower(btrim(l.email))
        WHERE s.id=%s AND s.activity_type='assignment' AND s.status<>'draft'
          AND lower(btrim(l.coach_email))=%s
          AND NOT EXISTS (SELECT 1 FROM "Learner".learners other
                          WHERE other.enrolment_id=l.enrolment_id AND other.id<>l.id)
        LIMIT 2''', [str(submission_id), request.coach_email])
    if len(rows) != 1:
        raise PresentationProblem('Submitted assignment not found.')
    row = rows[0]
    _current(request, row['submitted_at'])

    def file_for(identifier, reference=False):
        # A selected upload belongs to this activity. Design references may be
        # reused across that learner's assignments, as in the existing exporter.
        clause = '' if reference else ' AND section_ref=%s'
        params = [str(identifier), row['learner_kind'], row['learner_id']]
        if not reference:
            params.append(row['activity_id'])
        files = query('''SELECT original_filename AS filename,container,blob_name AS "blobName",
            size_bytes AS "sizeBytes",status FROM "Learner".evidence_files
            WHERE id::text=%s AND learner_kind=%s AND learner_id=%s
              AND status='approved' ''' + clause, params)
        if len(files) != 1:
            raise PresentationProblem('The saved presentation file is unavailable or has not passed its file checks.')
        return files[0]

    return _document(row['full_submission']), file_for


def _personal(request, submission_id):
    from .personal_learning import selected_course
    from learner_api.personal_learning_store import load
    course, _ = selected_course(request, submission_id)
    state = load(course['accountId'], course['moduleId'])
    submission = next((row for row in state['submissions'].values() if row.get('id') == str(submission_id)), None)
    if not submission or submission.get('status') == 'draft' or submission.get('activityType') != 'assignment':
        raise PresentationProblem('Submitted assignment not found.')
    _current(request, submission.get('submittedAt'), submission.get('version', 1))

    def file_for(identifier, reference=False):
        file = state.get('evidence', {}).get(str(identifier))
        if (not file or file.get('deletedAt') or file.get('status') != 'approved'
                or (not reference and file.get('activityId', file.get('sectionRef')) != submission.get('activityId'))):
            raise PresentationProblem('The saved presentation file is unavailable or has not passed its file checks.')
        return file

    return _document(submission), file_for


def _file_bytes(file, *, reference=False):
    filename = str(file.get('filename') or '')
    extension = PurePosixPath(filename.replace('\\', '/')).suffix.lower()
    maximum = MAX_REFERENCE if reference else MAX_UPLOAD
    try:
        size = int(file.get('sizeBytes') or 0)
    except (ValueError, TypeError, OverflowError):
        size = 0
    if (file.get('status') != 'approved' or extension not in (('.pptx',) if reference else ('.ppt', '.pptx'))
            or not 0 < size <= maximum or not file.get('container') or not file.get('blobName')):
        raise PresentationProblem('The saved PowerPoint file is unavailable or invalid.')
    from learner_api.evidence_storage import download_blob_bytes
    try:
        content = download_blob_bytes(file['container'], file['blobName'], max_bytes=maximum)
    except Exception as exc:
        # Storage failures never become an empty or newly generated substitute.
        raise PresentationProblem('Could not retrieve the saved PowerPoint file. Please retry.', 503) from exc
    if not content or len(content) > maximum:
        raise PresentationProblem('The saved PowerPoint file is empty or too large.', 503)
    if len(content) != size:
        raise PresentationProblem('The saved PowerPoint file could not be retrieved completely. Please retry.', 503)
    safe_name = PurePosixPath(filename.replace('\\', '/')).name
    safe_name = ''.join(character for character in safe_name if ord(character) >= 32 and ord(character) != 127)
    safe_name = safe_name[:-len(extension)][:180 - len(extension)] + safe_name[-len(extension):]
    return content, safe_name, PPT if extension == '.ppt' else PPTX


def presentation_file(document, file_for):
    """Use the existing presentation selection rule: chosen upload, then slides."""
    monthly = mapping(document.get('monthlyAssignment'))
    uploaded = mapping(monthly.get('uploadedPresentation'))
    if uploaded:
        if not text(uploaded.get('id')):
            raise PresentationProblem('The saved presentation file is unavailable.')
        content, filename, content_type = _file_bytes(file_for(uploaded['id']))
        return content, filename, content_type, 'uploaded'
    slides = monthly.get('slides')
    if not slides:
        raise PresentationProblem('No presentation was saved with this submission.')
    if (not isinstance(slides, list) or not 1 <= len(slides) <= 200
            or any(not isinstance(slide, dict) or not text(slide.get('title')) or not text(slide.get('body'))
                   or len(text(slide.get('body'))) > 12000 for slide in slides)):
        raise PresentationProblem('The saved slides are incomplete or invalid and cannot be downloaded.', 422)
    from learner_api.presentation_design import build_deck, extract_design
    from learner_api.presentation_template import build_from_template
    from learner_api.compact_presentation import build_compact_deck, FORMAT
    from learner_api.standard_mcm_presentation import build_standard_deck, FORMAT as STANDARD_FORMAT
    presentation_format = monthly.get('presentationFormat')
    compact = presentation_format in (FORMAT, STANDARD_FORMAT)
    renderer = build_standard_deck if presentation_format == STANDARD_FORMAT else build_compact_deck
    design = mapping(monthly.get('presentationDesign'))
    try:
        if design:
            if not text(design.get('evidenceId')):
                raise PresentationProblem('The saved PowerPoint design reference is unavailable.', 422)
            reference, _, _ = _file_bytes(file_for(design['evidenceId'], reference=True), reference=True)
            extract_design(reference)
            content = renderer(slides, reference, design) if compact else build_from_template(slides, reference, design)
        else:
            content = renderer(slides) if compact else build_deck(slides)
    except PresentationProblem:
        raise
    except ValueError as exc:
        if compact:
            raise PresentationProblem(str(exc), 422) from exc
        raise PresentationProblem('Could not export the saved slides. Please retry or contact support.', 503) from exc
    except Exception as exc:
        raise PresentationProblem('Could not export the saved slides. Please retry or contact support.', 503) from exc
    if not content:
        raise PresentationProblem('Could not export the saved slides. Please retry.', 503)
    month = monthly.get('month')
    from learner_api.extra_activity_month import valid_activity_month
    filename = f'presentation-{month}.pptx' if valid_activity_month(month) else 'presentation.pptx'
    return content, filename, PPTX, 'generated'


@coach_access_required
def download(request, submission_id, personal=False):
    """No client slide payload, AI call, signed declaration or database write."""
    try:
        if request.method != 'GET':
            response = JsonResponse({'detail': 'Method not allowed.'}, status=405)
            response['Allow'] = 'GET'
        else:
            document, file_for = _personal(request, submission_id) if personal else _official(request, submission_id)
            content, filename, content_type, source = presentation_file(document, file_for)
            response = HttpResponse(content, content_type=content_type)
            response['Content-Disposition'] = content_disposition_header(True, filename)
            response['X-Presentation-Source'] = source
    except PresentationProblem as exc:
        response = JsonResponse({'detail': str(exc)}, status=exc.status)
    except LookupError:
        response = JsonResponse({'detail': 'Submitted assignment not found.'}, status=404)
    except PermissionError:
        response = JsonResponse({'detail': 'You do not have access to this presentation.'}, status=403)
    except DatabaseError:
        response = JsonResponse({'detail': 'The presentation is temporarily unavailable. Please retry.'}, status=503)
    except (ValueError, TypeError):
        response = JsonResponse({'detail': 'The saved presentation record could not be read. Please contact support.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    response['Vary'] = 'Cookie'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
