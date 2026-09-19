"""Course-coach ownership and review rules for isolated personal submissions."""
import copy
from datetime import datetime

from django.db import connections
from django.utils import timezone

from . import personal_learning_store as store


def normal(value):
    return str(value or '').strip().casefold()


def coach_candidates():
    from login.identity import accesses_for_staff
    from .models import StaffUser
    return [{'id': row.id, 'uuid': str(row.uuid), 'name': row.username or '', 'email': row.email or ''}
            for row in StaffUser.objects.only('id', 'uuid', 'username', 'email', 'status', 'access', 'access_extra')
            if normal(row.status) not in {'archived', 'inactive', 'disabled'} and 'coach' in accesses_for_staff(row)]


def resolve_coach(group, candidates):
    # Curriculum assigns a coach to the module's group. Ambiguous names must
    # never give two staff accounts access to the same personal coursework.
    email = normal(group.get('coach_email'))
    name = normal(group.get('coach_name'))
    if not email and name in {'', 'unassigned', 'emptystring'}:
        return None
    matches = [row for row in candidates if (normal(row['email']) == email if email else
               name in {normal(row['name']), normal(row['email']), str(row['id']), normal(row['uuid'])})]
    return matches[0] if len(matches) == 1 else None


def module_coach(module_id):
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT row_to_json(g) FROM curriculum.modules m
            JOIN curriculum.groups g ON g.group_id=m.group_id AND g.deleted_at IS NULL
            WHERE m.module_catalogue_id=%s AND m.deleted_at IS NULL''', [module_id])
        row = cur.fetchone()
    return resolve_coach(store.json_value(row[0], dict), coach_candidates()) if row else None


def review_courses(request, submission_id=None):
    params = []
    clause = ''
    if submission_id:
        clause = " AND EXISTS (SELECT 1 FROM jsonb_each(e.submissions) s WHERE s.value->>'id'=%s)"
        params.append(str(submission_id))
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT e.account_id,e.module_id,e.submissions,a."Display_name",a."Email",row_to_json(g)
            FROM "Learner".personal_course_enrolments e
            JOIN login."Login_accounts" a ON a.id=e.account_id
            JOIN curriculum.modules m ON m.module_catalogue_id=e.module_id AND m.deleted_at IS NULL
            JOIN curriculum.groups g ON g.group_id=m.group_id AND g.deleted_at IS NULL
            WHERE e.submissions<>'{}'::jsonb''' + clause, params)
        rows = cur.fetchall()
    candidates = coach_candidates()
    for owner, module_id, submissions, name, email, group in rows:
        coach = resolve_coach(store.json_value(group, dict), candidates)
        if not coach or coach['id'] != request.coach_staff.id:
            continue
        # Covers both an administrator viewing their own coach and accounts
        # linked to the same person under another login.
        if owner == request.login_account.id or normal(email) in {normal(request.login_account.email), normal(coach['email'])}:
            continue
        yield {'accountId': owner, 'moduleId': module_id, 'learner': name or email,
               'submissions': store.json_value(submissions, dict), 'coach': coach}


def submission_item(course, submission):
    submitted = datetime.fromisoformat(submission['submittedAt']) if submission.get('submittedAt') else None
    elapsed = max((timezone.now() - submitted).days, 0) if submitted else 0
    status = 'pending' if submission.get('status') == 'submitted_for_tutor_review' else submission.get('status', 'draft')
    name = course['learner']
    monthly = submission.get('monthlyAssignment') or {}
    sections = [{'label': label, 'text': str(source.get(key) or '')} for source, key, label in [
        (submission, 'assignmentAnswer', 'Assignment answer'), (submission, 'whatYouLearned', 'What I learned'),
        (submission, 'businessImpact', 'Business impact'), (monthly, 'understood', 'Understanding'),
        (monthly, 'gainedSkills', 'Skills gained'), (monthly, 'lmsReflection', 'Monthly reflection'),
        (monthly, 'integratedReflection', 'Integrated understanding'), (monthly, 'careerImpact', 'Career impact'),
        (monthly, 'jobImpact', 'Job impact'), (monthly, 'employerImpact', 'Employer impact'),
        (monthly, 'actionPlan', 'Action plan'), (monthly, 'epaPreparedness', 'EPA preparedness')]
        if source.get(key)]
    for claim in monthly.get('claims') or []:
        sections.append({'label': f"KSB {claim.get('code', '')}", 'text': str(claim.get('explanation') or '')})
    for slide in monthly.get('slides') or []:
        sections.append({'label': f"Slide: {slide.get('title', '')}", 'text': str(slide.get('body') or '')})
    for file in monthly.get('evidence') or []:
        if file.get('url'):
            sections.append({'label': 'Evidence link', 'text': str(file['url'])})
    return {**submission, 'id': submission['id'], 'learnerKind': 'commercial', 'contentSections': sections,
            'learnerId': f"pl.{course['accountId']}.study.{course['moduleId']}", 'learner': name,
            'initials': ''.join(part[0].upper() for part in name.split()[:2]),
            'programme': submission.get('programmeName', ''), 'module': submission.get('moduleTitle', ''),
            'week': submission.get('weekTitle', ''), 'plannedOtjh': '', 'status': status,
            'learningReflection': submission.get('learningReflection') or submission.get('feedback') or '',
            'ksbCodes': submission.get('ksbCodes') or [], 'ksbExplanations': submission.get('ksbExplanations') or {},
            'confidenceBefore': submission.get('confidenceBefore') or {}, 'confidenceAfter': submission.get('confidenceAfter') or {},
            'selectedBenefits': submission.get('selectedBenefits') or [], 'evidenceFiles': submission.get('evidenceFiles') or [],
            'qualityScore': submission.get('qualityScore', 0), 'version': submission.get('version', 1),
            'submittedDisplay': submitted.strftime('%d/%m/%Y %H:%M') if submitted else '--',
            'elapsedDays': elapsed, 'isOverdue': status == 'pending' and elapsed >= 7, 'personalLearning': True}


def decide(state, submission_id, payload, actor, coach):
    submission = next((s for s in state['submissions'].values() if s.get('id') == str(submission_id)), None)
    if not submission or submission.get('status') == 'draft':
        raise LookupError('Submitted work not found.')
    if payload.get('version') != submission.get('version', 1):
        raise ValueError('This submission changed. Reload it before saving your review.')
    decision = payload.get('decision')
    feedback = str(payload.get('feedback') or '').strip()
    if decision not in {'accepted', 'referred', 'rejected'}:
        raise ValueError('Choose accept or return the work for improvement.')
    if len(feedback) > 20000 or (decision != 'accepted' and not feedback):
        raise ValueError('Provide feedback of up to 20,000 characters for this decision.')
    records = [row for row in state['progress'] if row.get('submissionId') == str(submission_id)]
    if not records:
        raise ValueError('The learner has not finished submitting this activity. Ask them to complete the activity first.')
    record = records[-1]
    at = timezone.now().isoformat()
    name = actor.display_name or actor.email
    history = submission.setdefault('reviewHistory', [])
    history.append({'decision': decision, 'feedback': feedback, 'reviewedAt': at,
                    'reviewerAccountId': actor.id, 'reviewedBy': name, 'courseCoachId': coach['id'],
                    'submission': copy.deepcopy({key: value for key, value in submission.items() if key != 'reviewHistory'}),
                    'timeTrackingSessionId': record.get('timeTrackingSessionId')})
    submission.update(status=decision, coachFeedback=feedback, reviewedBy=name, reviewedAt=at,
                      locked=decision == 'accepted', version=submission.get('version', 1) + 1)
    record.update(passed=decision == 'accepted', reviewedAt=at, reviewedBy=name, coachFeedback=feedback)
    return {'id': str(submission_id), 'status': decision, 'reviewedAt': at, 'version': submission['version']}
