"""One-time, review-owned continuation of saved Skills Radar assessments.

Called only by assigned-coach initialization/open under the current overlay
lock. Never updates the source review or reads meeting artifacts.
"""
from copy import deepcopy

from django.db import connections
from django.utils import timezone

from .migrated_reviews import EDITABLE_STATUSES, all_fields
from .migrated_skills_radar import is_radar_section
from .models import ImportedReviewInstance

FAMILY = 'PR_SKILLS_RADAR'


def previous_radar(overlay, definition):
    """Reuse imported-review identity and chronological ordering rules."""
    from . import views
    from .migrated_previous import _sources, _source_identity, _programme, _normal

    owner = overlay.owner_email.strip().casefold()
    profiles = views.fetch_caseload_dashboard_profiles(owner)
    identities, conflicts = views.resolve_effective_aptem_ids(profiles)
    learner = overlay.learner_id
    if learner in conflicts or learner not in identities:
        return None, 'The learner identity could not be verified.'
    sources = _sources(learner, FAMILY)
    current = [(row, review) for row, review in sources if row['id'] == overlay.source_review_id]
    if len(current) != 1 or not _source_identity(current[0][0], learner, identities[learner]):
        return None, 'The current review identity could not be verified.'
    row, review = current[0]
    target = review.get('plannedDate')
    if not target:
        return None, 'The current review has no planned date.'
    programme = _programme(row, review) or _normal(definition.get('programme'))
    candidates = []
    for row, review in sources:
        if row['id'] == overlay.source_review_id:
            continue
        prior_programme = _programme(row, review)
        if programme and prior_programme and programme != prior_programme:
            continue
        planned = review.get('plannedDate')
        if not planned or planned == target:
            return None, 'The order of previous Skills Radar reviews is ambiguous.'
        if planned < target:
            candidates.append((row, review))
    if not candidates:
        return None, None
    latest = max(review['plannedDate'] for _, review in candidates)
    candidates = [(row, review) for row, review in candidates if review['plannedDate'] == latest]
    if len(candidates) != 1:
        return None, 'Multiple previous Skills Radar reviews share the same planned date.'
    row, review = candidates[0]
    if not _source_identity(row, learner, identities[learner]):
        return None, 'The previous review identity could not be verified.'
    previous = ImportedReviewInstance.objects.filter(source_review_id=row['id']).first()
    if previous is None:
        return None, 'The previous review has no saved LMS Skills Radar assessments.'
    if previous.learner_id != learner or previous.owner_email.strip().casefold() != owner:
        return None, 'The previous review is not available to the assigned coach.'
    prior_definition = views._imported_review_definition(owner, previous.event_key, pdf_only=True, learners=profiles)
    if (not prior_definition or prior_definition['instance']['learnerId'] != learner
            or str(prior_definition['historicalReview']['id']) != str(row['id'])):
        return None, 'The previous review association could not be verified.'
    source = (previous.template_snapshot or {}).get('templateSource') or {}
    expected_key = views.migrated_programme_key(definition.get('programmeId'), definition.get('programme'))
    if source.get('family') != FAMILY or (source.get('programmeKey') and source['programmeKey'] != expected_key):
        return None, 'The previous review belongs to a different programme or review type.'
    return (previous, latest), None


def carry_forward_locked(overlay, definition):
    """Seed once, preserving even explicitly cleared current assessments."""
    if not connections['default'].in_atomic_block:
        raise RuntimeError('Skills Radar continuation requires the review transaction.')
    snapshot = overlay.template_snapshot or {}
    if (overlay.status not in EDITABLE_STATUSES
            or (snapshot.get('templateSource') or {}).get('family') != FAMILY):
        return False
    sections = [s for s in snapshot.get('sections') or [] if is_radar_section(s)]
    fields = [f for s in sections for f in s.get('fields') or [] if f.get('skillsRadar')]
    if not fields or any(s.get('radarContinuation', {}).get('status') in {'copied', 'first', 'preserved'} for s in sections):
        return False
    answers = deepcopy(overlay.answers or {})
    audit = (overlay.meeting_intelligence or {}).get('answerEdits') or {}
    if any(f['key'] in answers or f['key'] in audit for f in fields):
        state = {'status': 'preserved', 'message': 'Your saved Skills Radar assessments have been kept.'}
        prior = None
    else:
        prior, reason = previous_radar(overlay, definition)
        state = {'status': 'unavailable' if reason else 'first',
                 'message': reason or 'First Skills Radar review: assess the programme competencies.'}
    copied = {}
    if prior:
        previous, planned = prior
        old = {f['key']: f for f in all_fields(previous.template_snapshot) if f.get('skillsRadar')}
        for field in fields:
            key = field['key']
            source = old.get(key)
            if not source:
                continue
            metadata, old_metadata = field['skillsRadar'], source['skillsRadar']
            # Exact identity, question and scale: never map by code alone or
            # reinterpret an Aptem eight-point score as a five-point score.
            if any(metadata.get(k) != old_metadata.get(k) for k in
                   ('questionId', 'standardId', 'question', 'kind', 'role', 'levels')):
                continue
            value = (previous.answers or {}).get(key)
            if isinstance(value, str) and value in field.get('options', []):
                copied[key] = value
        state = {'status': 'copied' if copied else 'unavailable',
                 'message': ('Started from the previous review’s saved assessments. You can update them for this review.'
                             if copied else 'The previous review has no saved assessments with matching questions and scales.'),
                 'sourceReview': previous.event_key, 'plannedDate': str(planned),
                 'sourceVersion': previous.updated_at.isoformat()}
        if copied:
            state['copiedAt'] = timezone.now().isoformat()
            skipped = sum(isinstance(value, str) and value != '' and key not in copied
                          for key, value in (previous.answers or {}).items() if key in old)
            if skipped:
                state['message'] += ' Some previous assessments could not be copied because their questions or scales do not match.'
    result = deepcopy(snapshot)
    for section in result.get('sections') or []:
        if not is_radar_section(section):
            continue
        section['radarContinuation'] = deepcopy(state)
        for field in section.get('fields') or []:
            if field.get('skillsRadar'):
                field['skillsRadar']['continuation'] = deepcopy(state)
                if field['key'] in copied:
                    field['skillsRadar']['carriedAnswer'] = copied[field['key']]
    if result == snapshot and not copied:
        return False
    overlay.template_snapshot = result
    overlay.answers = {**answers, **copied}
    overlay.save(update_fields=['template_snapshot', 'answers', 'updated_at'])
    return True
