"""Employer adapters for the existing read-only learner projections.

Callers must first authorize the employer and the source enrolment. These
adapters select the learner perspective; they never invoke learner HTTP views
or the legacy builder's activation, hydration and snapshot persistence.
"""
from old_otjh.service import ServiceError
from django.db import connections
from curriculum_api.learning_storage import read_sql

from . import canonical_learning, dashboard_tabs
from .employer_course_visibility import free_course_module_sql
from .identity import learner_profile_for_source
from .journal_sources import learner_journal_reads


def without_free_courses(payload):
    """Filter employer projections only; retain the learner's stored assignments."""
    def references(row, section):
        values = [row.get(key) for key in ('moduleId', 'module_id', 'moduleCatalogueId', 'catalogueId')]
        identity = row.get('id')
        if section in ('modules', 'programme', 'selectedModule') or str(identity or '').startswith(('current:', 'legacy:')):
            values.append(identity)
        return {str(value).removeprefix('current:') for value in values if value is not None and value != ''}

    ids = set()
    def collect(value, section='modules'):
        if isinstance(value, dict):
            ids.update(references(value, section))
            for key, item in value.items():
                collect(item, key)
        elif isinstance(value, list):
            for item in value:
                collect(item, section)
    collect(payload)
    rows = []
    if ids:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(read_sql(f'''SELECT m.module_catalogue_id, m.title,
                {free_course_module_sql(cursor.db)} AS is_free,
                m.source_type, m.source_id
                FROM curriculum.modules m WHERE m.module_catalogue_id=ANY(%s)
                  OR (m.source_type='mba-legacy' AND 'legacy:' || m.source_id=ANY(%s))''',
                cursor.db), [sorted(ids), sorted(ids)])
            rows = cursor.fetchall()
    excluded = {str(module_id) for module_id, _, is_free, _, _ in rows if is_free}
    excluded.update(f'legacy:{source_id}' for _, _, is_free, kind, source_id in rows
                    if is_free and kind == 'mba-legacy' and source_id)
    visible_titles = {title for _, title, is_free, _, _ in rows if not is_free}
    excluded_titles = {title for _, title, is_free, _, _ in rows if is_free} - visible_titles

    def hidden(value, section):
        return isinstance(value, dict) and (bool(references(value, section) & excluded)
            or value.get('isFreeCourse') is True or value.get('sourceType', value.get('source_type')) == 'free_course')

    def filtered(value, section='modules'):
        if isinstance(value, dict):
            return {key: [] if key in ('freeCourses', 'standaloneCourses')
                    else None if hidden(item, key) else filtered(item, key)
                    for key, item in value.items()}
        if isinstance(value, list):
            return [filtered(item, section) for item in value if not hidden(item, section)
                    and not (section == 'modules' and isinstance(item, str) and item in excluded_titles)]
        return value
    return filtered(payload)


def without_action_links(value):
    """Retain learning facts while withholding meeting/booking capabilities."""
    if isinstance(value, dict):
        return {key: None if key in {
            'joinUrl', 'meetingLink', 'bookingUrl', 'liveSessionUrl',
            'teamsMeetingUrl', 'extraTeamsMeetingUrl',
        } else without_action_links(item) for key, item in value.items()}
    if isinstance(value, list):
        return [without_action_links(item) for item in value]
    return value


def read_dashboard(source, kind, tab, request):
    with learner_journal_reads():
        # read_tab verifies the canonical profile against this exact enrolment,
        # uses heal=False and installs the same request caches as the learner.
        options = {'employer_performance': True} if tab == 'overview' and request.GET.get('performance') == '1' else {}
        return without_action_links(without_free_courses(dashboard_tabs.read_tab(source, kind, tab, request, **options)))


def _prepare_source(source):
    owner = canonical_learning.require_profile(source.pk)
    profile = learner_profile_for_source(source, source.pk, heal=False)
    if profile is None or profile.pk != owner['id'] or profile.enrolment_id != source.pk:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    source._canonical_profile = owner
    source._case_file_profile = profile
    dashboard_tabs.install_request_caches(source)
    return profile


def read_schedule(source, section):
    from .training_plan_dashboard import read_dashboard as read_schedule_dashboard
    with learner_journal_reads():
        # The header must resolve imported memberships as well as native plans.
        _prepare_source(source)
        return without_action_links(without_free_courses(read_schedule_dashboard(source, section=section)))


def read_plan(source):
    """Compatibility payload for the employer's full plan/KSB observer."""
    from .mappers import to_learner_detail
    from .weekly_learning import build_learning_content_summary
    from .learner_detail import _annotate_otjh, _live_otjh_snapshot, _apply_live_otjh_snapshot

    with learner_journal_reads():
        profile = _prepare_source(source)
        detail = to_learner_detail(source, profile)
        content = build_learning_content_summary(source, source.pk, learning_summary=True,
                                                 include_component_details=True, strict=True)
        for key in ('modules', 'week', 'components', 'retiredQuizComponents'):
            detail[key] = content[key]
        detail = without_free_courses(detail)
        detail['components'], detail['totalExpectedOtjh'] = _annotate_otjh(detail['components'])
        _apply_live_otjh_snapshot(detail, _live_otjh_snapshot(detail, profile))
        return without_action_links(detail)
