"""Lossless identities and completion facts for legacy free-course adoption.

These helpers do not read or write a database. Existing live teaching is kept
when explicitly requested by the adoption command; new live content stays blocked.
"""
from copy import deepcopy
from hashlib import sha256


SOURCE_SYSTEM = 'legacy_free_courses'


def adopted_id(prefix, course_id, source_id):
    """Stable canonical IDs make retries address the same authored records."""
    if not course_id or not source_id:
        raise ValueError('Legacy course and content identities are required.')
    digest = sha256(f'{course_id}\0{source_id}'.encode('utf-8')).hexdigest()[:32].upper()
    return f'{prefix}-FREE-{digest}'


def course_payload(course, source_weeks, *, preserve_live=False):
    """Map one course without changing its source rows or stripping settings."""
    course_id = course['id']
    weeks = []
    seen_weeks, seen_components = set(), set()
    ordered = sorted(source_weeks, key=lambda week: (week.get('displayOrder', 0), week.get('weekNumber', 0)))
    for index, source_week in enumerate(ordered):
        if source_week.get('courseId') != course_id:
            raise ValueError('A source week belongs to another free course.')
        source_week_id = source_week['id']
        if source_week_id in seen_weeks:
            raise ValueError('Duplicate source week identity.')
        seen_weeks.add(source_week_id)
        week_id = adopted_id('WEEK', course_id, source_week_id)
        components = []
        for source in source_week.get('components') or []:
            if not preserve_live and str(source.get('type', '')).lower().replace('_', '-').replace(' ', '-') == 'live-session':
                raise ValueError('Resolve legacy live-session handling before adopting this course.')
            source_id = source['id']
            if source_id in seen_components:
                raise ValueError('Duplicate source component identity.')
            seen_components.add(source_id)
            component = deepcopy(source)
            settings = component.get('settings') or {}
            if not isinstance(settings, dict):
                raise ValueError('Legacy component settings must be an object.')
            # The legacy importer labelled uploaded videos as external links.
            # Keep their resource URL, but use the ordinary uploaded-video mode
            # so the new editor can validate and save the existing content.
            video_url = str(settings.get('videoUrl') or '')
            if (component.get('type') == 'video' and video_url.startswith('/')
                    and not video_url.startswith('//')
                    and video_url == settings.get('uploadedFileUrl')
                    and settings.get('sourceType') in ('External Link', 'External link')):
                settings = {**settings, 'sourceType': 'HTML (MP4)', 'provider': 'Upload file',
                            'legacyFreeVideoSourceType': settings['sourceType']}
            component.update(
                id=adopted_id('COMP', course_id, source_id), weekId=week_id,
                ksbMappings=[],
                reflectionQuestion=str(settings.get('reflectionPrompt') or ''),
                settings={**settings, 'legacyFreeCourseId': course_id, 'legacyFreeComponentId': source_id},
            )
            component.pop('moduleId', None)
            components.append(component)
        weeks.append({
            'id': week_id, 'weekNumber': source_week.get('weekNumber') or index + 1,
            'title': source_week.get('weekTitle') or f'Week {index + 1}',
            'summary': '', 'components': components, 'ksbMappings': [],
        })
    return {
        'catalogueId': adopted_id('MOD', course_id, course_id),
        'title': course.get('course_name') or '',
        'description': course.get('description') or '',
        'coverImage': course.get('cover_image_url') or '',
        'isFreeCourse': True, 'sourceType': 'free_course', 'sourceId': course_id,
        'learnerRosterMode': 'manual', 'weekStructure': weeks,
    }


def completion_fields(completion, *, profile_id, module, week, component):
    """Preserve a completion instant without inventing time, grades or approval.

    Return ORM fields separately from the externally provisioned ledger fields.
    The existing completion rule reads activity_status; accepted remains false and
    stored zero seconds prevent native-time fallback from crediting history.
    """
    course_id = module['sourceId']
    settings = component['settings']
    if (completion.get('free_course_ref') != course_id
            or settings.get('legacyFreeCourseId') != course_id
            or completion['component_ref'] != settings.get('legacyFreeComponentId')):
        raise ValueError('Historical completion does not belong to this component.')
    completed_at = completion['completed_at']
    if completed_at is None:
        raise ValueError('Historical completion requires its original timestamp.')
    return {
        'learner_id': profile_id, 'kind': 'component',
        'module_ref': module['catalogueId'], 'module_title': module['title'],
        'week_ref': week['id'], 'week_title': week['title'],
        'component_ref': component['id'], 'component_title': component.get('title') or '',
        'component_type': component.get('type') or '',
        'legacy_component_ref': completion['component_ref'],
        'component_link_status': 'resolved_to_current_component',
        'component_link_source': SOURCE_SYSTEM,
        'submitted_at': completed_at,
        'feedback': 'Completed in the legacy free course. No retrospective hours awarded.',
    }, {
        'source_system': SOURCE_SYSTEM,
        'activity_status': 'Completed', 'accepted': False, 'actual_seconds': 0,
        'actual_basis': 'legacy_free_course_completion',
        'source_payload': {
            'legacyFreeCourseId': course_id,
            'legacyFreeComponentId': completion['component_ref'],
            'legacyCompletionId': completion['id'],
        },
    }
