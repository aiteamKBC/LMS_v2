"""Personal submissions and files, isolated from official learner evidence."""
import logging
import re
import uuid
from pathlib import PurePath

from django.conf import settings
from django.core import signing
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from . import personal_learning_store as store
from .personal_learning_policy import component_for, submission_key

log = logging.getLogger(__name__)
LOCKED = {'accepted', 'submitted_for_tutor_review'}
SUBMISSION_FIELDS = (
    'learningReflection', 'ksbCodes', 'ksbWeights', 'ksbExplanations', 'confidenceBefore', 'confidenceAfter',
    'applicationType', 'applicationText', 'evidenceFiles', 'evidenceConsentConfirmed', 'selectedBenefits',
    'benefitExplanation', 'actualTimeHours', 'completedDuringPaidHours', 'dateCompleted', 'otjhConfirmed',
    'signedDeclaration', 'assignmentAnswer', 'whatYouLearned', 'businessImpact', 'outsideWorkingHours',
    'outsideWorkingHoursConfirmed', 'monthlyAssignment', 'assignmentTimeSource',
)


def state_for(context):
    return store.load(context['account_id'], context['module_id']) if context['mode'] == 'study' else {'progress': [], 'submissions': {}, 'evidence': {}}


def assignment_checks(context, detail, state, payload):
    from .monthly_assignment import assignment_checks as shared_checks
    owned = {key for key, file in state.get('evidence', {}).items() if file['status'] == 'approved' and not file.get('deletedAt')}
    checks = shared_checks({**payload, 'learnerKind': 'commercial', 'learnerId': context['id']},
                           evidence_ids=owned, meeting_booked=False, allowed_ksbs={item['code'] for item in detail['ksbs']})
    # The owner approved a booking exemption for personal study only. Preserve
    # the check key/count without claiming that a meeting has been booked.
    if context['mode'] == 'study':
        return [{**check, 'passed': True, 'label': 'Coaching booking is not required for personal learning'}
                if check['key'] == 'meeting' else check for check in checks]
    return checks


def validate_assignment(context, detail, state, payload):
    checks = assignment_checks(context, detail, state, payload)
    missing = [check['label'] for check in checks if not check['passed']]
    if missing:
        raise ValueError('Complete the outstanding assignment requirements: ' + '; '.join(missing))
    return checks


def save_submission(context, account, detail, payload):
    from .personal_learning import activity_state, ensure_open
    ensure_open(detail, context)
    component = component_for(detail, payload.get('activityId'))
    # The same reflection form uses display nouns such as "slide deck" and
    # "session". Its labels must not choose the stored assessment rule/key.
    activity_type = 'quiz' if component.get('isQuiz') else component.get('type')
    activity_id = str(payload['activityId'])
    key = submission_key(component, activity_id)
    submit = payload.get('submissionMode') != 'draft'
    with activity_state(context) as state:
        previous = state['submissions'].get(key, {})
        if previous.get('status') in LOCKED:
            raise ValueError('This submission is locked for review or has already been accepted.')
        clean = {field: payload[field] for field in SUBMISSION_FIELDS if field in payload}
        clean.update(learnerKind='commercial', learnerId=context['id'], learnerName=account.display_name or account.email,
                     programmeName=detail['programme'], activityType=activity_type, activityId=activity_id,
                     activityTitle=component['component'], moduleTitle=component['module'], weekTitle=component['week'],
                     submissionOrigin='learner', submissionMode='submit' if submit else 'draft')
        if submit and activity_type == 'assignment':
            clean['qualityChecks'] = validate_assignment(context, detail, state, clean)
        elif submit and not str(clean.get('learningReflection') or '').strip():
            raise ValueError('Complete the learning reflection before submitting.')
        result = {**clean, 'id': previous.get('id') if previous.get('status') == 'draft' else str(uuid.uuid4()),
                  'version': previous.get('version', 0) + 1, 'reviewHistory': previous.get('reviewHistory', []),
                  'status': 'submitted_for_tutor_review' if submit else 'draft',
                  'coachFeedback': previous.get('coachFeedback'), 'reviewedBy': previous.get('reviewedBy'), 'reviewedAt': previous.get('reviewedAt'),
                  'submittedAt': timezone.now().isoformat() if submit else None, 'locked': submit}
        state['submissions'][key] = result
    return {'id': result['id'], 'status': result['status'], 'preview': context['mode'] != 'study'}


def file_status(state, file):
    submissions = [s for s in state['submissions'].values() if s.get('activityId') == file.get('activityId', file['sectionRef'])]
    return next((s['status'] for s in submissions if s.get('status') in LOCKED), '')


def public_file(state, file):
    return {key: file.get(key) for key in ('id', 'filename', 'contentType', 'sizeBytes', 'status', 'scanResult', 'sectionRef', 'uploadedAt', 'trainingPlanDetails')} | {
        'canDelete': not bool(file_status(state, file)), 'markingStatus': file_status(state, file)}


def owned_file(state, file_id):
    file = state.get('evidence', {}).get(file_id)
    if not file or file.get('deletedAt'):
        raise LookupError('Evidence not found in this personal course.')
    return file


def download_url(file):
    from .evidence_storage import get_download_sas
    if file['status'] != 'approved':
        raise PermissionError('This file is not approved for download.')
    return get_download_sas(file['container'], file['blobName'], file['filename'])


def evidence_request(request, context, detail, path, query):
    from .personal_learning import ensure_open
    from . import evidence_storage as storage
    base = f"/learner_api/evidence/commercial/{context['id']}/"
    suffix = path[len(base):]
    if request.method == 'GET':
        state = state_for(context)
        if not suffix:
            return JsonResponse({'results': [public_file(state, file) for file in state.get('evidence', {}).values()
                if not file.get('deletedAt') and (not query.get('section_ref') or file['sectionRef'] == query['section_ref'])
                and (not query.get('status') or file['status'] == query['status'])]})
        match = re.fullmatch(r'([^/]+)/download/', suffix)
        if match:
            return JsonResponse({'url': download_url(owned_file(state, match[1]))})
    if request.method in ('POST', 'DELETE'):
        ensure_open(detail, context)
        if context['mode'] != 'study':
            raise PermissionError('Preview does not save files. Join this course to upload evidence.')
        if request.method == 'POST' and suffix == 'upload/':
            from .evidence import _evidence_type_allowed, _scan, MAX_BYTES
            file = request.FILES.get('file')
            if file is None or file.size > MAX_BYTES or not _evidence_type_allowed(file):
                raise ValueError('Choose a supported evidence file of 50 MB or less.')
            section = str(request.POST.get('section_ref') or '')
            activity_id = section.removeprefix('presentation-reference-')
            component = component_for(detail, activity_id)
            if not storage.azure_configured():
                return JsonResponse({'error': 'Evidence storage is unavailable.'}, status=503)
            file_id = str(uuid.uuid4())
            name = PurePath(file.name.replace('\\', '/')).name
            blob = f"personal-learning/{context['account_id']}/{context['module_id']}/{file_id}/{name}"
            container = settings.AZURE_QUARANTINE_CONTAINER
            try:
                with store.edit(context['account_id'], context['module_id']) as state:
                    record = {'id': file_id, 'filename': name, 'sectionRef': section, 'activityId': activity_id,
                              'contentType': file.content_type, 'sizeBytes': file.size, 'uploadedAt': timezone.now().isoformat(),
                              'trainingPlanDetails': {key: component.get(key) for key in ('moduleId', 'weekId', 'componentId')},
                              'blobName': blob}
                    if file_status(state, record):
                        raise PermissionError('This activity has already been submitted. Its evidence is locked.')
                    storage.upload_to_quarantine(file, blob, file.content_type)
                    verdict = _scan(container, blob)
                    destination = settings.AZURE_APPROVED_CONTAINER if verdict == 'clean' else settings.AZURE_REJECTED_CONTAINER
                    storage.move_blob(container, destination, blob)
                    container = destination
                    record.update(container=container, status='approved' if verdict == 'clean' else 'rejected', scanResult=verdict)
                    state.setdefault('evidence', {})[file_id] = record
                return JsonResponse(public_file(state, record), status=201)
            except PermissionError:
                raise
            except Exception:
                # An upload may have succeeded before persistence failed. Keep
                # an explicit error and attempt cleanup; never report success.
                try:
                    storage.delete_blob(container, blob)
                except Exception:
                    log.warning('Personal evidence cleanup requires attention for upload %s.', file_id)
                log.error('Could not save personal course evidence for upload %s.', file_id)
                return JsonResponse({'error': 'Could not save the file. Please retry.'}, status=503)
        match = re.fullmatch(r'([^/]+)/', suffix)
        if request.method == 'DELETE' and match:
            with store.edit(context['account_id'], context['module_id']) as state:
                file = owned_file(state, match[1])
                if file_status(state, file):
                    raise PermissionError('Submitted evidence cannot be removed.')
                # Retain the audit snapshot; excluded from subsequent submissions.
                file['deletedAt'] = timezone.now().isoformat()
            return JsonResponse({'deleted': True})
    raise LookupError('Unknown personal evidence action.')


def presentation(context, payload):
    from .monthly_assignment import items, mapping, text, presentation_fingerprint
    from .presentation_design import build_deck, extract_design
    from .presentation_template import build_from_template
    slides = items(mapping(payload.get('monthlyAssignment')).get('slides'))
    if not 1 <= len(slides) <= 200:
        raise ValueError('Add between 1 and 200 slides before exporting.')
    if any(not text(mapping(s).get('title')) or not text(mapping(s).get('body')) or len(text(mapping(s).get('body'))) > 12000 for s in slides):
        raise ValueError('Each slide needs a title and body of no more than 12,000 characters.')
    design = mapping(mapping(payload.get('monthlyAssignment')).get('presentationDesign'))
    if design:
        _, reference = reference_template(context, design.get('evidenceId'))
        extract_design(reference)
        content = build_from_template(slides, reference, design)
    else:
        content = build_deck(slides)
    response = HttpResponse(content, content_type='application/vnd.openxmlformats-officedocument.presentationml.presentation')
    response['Content-Disposition'] = 'attachment; filename="monthly-assignment.pptx"'
    response['X-Presentation-Token'] = signing.dumps(presentation_fingerprint(payload), salt='monthly-assignment-pptx')
    return response


def reference_template(context, file_id):
    from .evidence_storage import download_blob_bytes
    file = owned_file(state_for(context), str(file_id))
    if file['status'] != 'approved' or not file['filename'].lower().endswith('.pptx'):
        raise ValueError('Choose an approved PowerPoint reference from this course.')
    return file['filename'], download_blob_bytes(file['container'], file['blobName'], max_bytes=15 * 1024 * 1024)


def handle_activity_request(request, context, account, detail, path, query, payload):
    from .personal_learning import ensure_open
    if path.startswith(f"/learner_api/evidence/commercial/{context['id']}/"):
        return evidence_request(request, context, detail, path, query)
    if request.method != 'POST':
        return None
    if path == '/learner_api/reflection/submissions/':
        return JsonResponse(save_submission(context, account, detail, payload))
    if path.startswith('/learner_api/reflection/assignment/'):
        ensure_open(detail, context)
        if path.endswith('/presentation-design/'):
            from .presentation_design import extract_design
            name, reference = reference_template(context, payload.get('evidenceId'))
            return JsonResponse({'design': {**extract_design(reference), 'name': name, 'evidenceId': str(payload.get('evidenceId'))}})
        component = component_for(detail, payload.get('activityId'))
        if component.get('type') != 'assignment':
            raise ValueError('Choose an assignment in this course.')
        if path.endswith('/check/'):
            return JsonResponse({'checks': assignment_checks(context, detail, state_for(context), payload)})
        if path.endswith('/presentation/'):
            return presentation(context, payload)
    return None
