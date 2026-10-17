import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views


PROGRAMME = {'id': 'PROG-1', 'sourceId': 'PROG-1', 'name': 'Data Analyst'}
COHORT = {'id': 'C-1', 'programmeId': 'PROG-1', 'name': 'Sept 2026'}
GROUP = {'id': 'G-1', 'cohortId': 'C-1', 'programmeId': 'PROG-1', 'name': 'Group A'}
MODULE = {
    'id': 'MOD-1',
    'moduleCatalogueId': 'MOD-1',
    'weekStructure': [{'id': 'W-1', 'title': 'Week 1', 'components': [{'id': 'COMP-1'}]}],
}


def module_builder_must_not_run(*args, **kwargs):
    raise AssertionError('the shell must stop before the modules are built')


class ProgrammeDetailSectionTests(SimpleTestCase):
    """The programme page reads the detail document as a shell and its modules."""

    def build(self, section, build_modules=lambda *args, **kwargs: [dict(MODULE)]):
        rows = {'training': [], 'ksb_profiles': [], 'program_configs': [], 'modules': []}
        with patch.multiple(
            views,
            get_cached_curriculum_rows=lambda compact=True: rows,
            build_programmes=lambda *args, **kwargs: [dict(PROGRAMME)],
            repair_curriculum_parent_links=lambda *args, **kwargs: None,
            build_cohorts_and_groups=lambda *args, **kwargs: ([dict(COHORT)], [dict(GROUP)]),
            build_modules=build_modules,
            enrich_curriculum_modules_with_authoring_details=lambda modules: modules,
            programme_authoring_modules=lambda *args, **kwargs: [],
            programme_config_modules=lambda *args, **kwargs: [],
            get_holiday_rows=lambda *args, **kwargs: [],
            cohort_selected_holidays_by_id=lambda *args, **kwargs: {},
            build_sessions_basic=lambda *args, **kwargs: [{'id': 'S-1'}],
            component_builder_rows=lambda *args, **kwargs: self.fail('no section reads components'),
        ):
            return views.build_curriculum_programme_tree_detail_payload(
                'PROG-1', 'all', include_stats=False, include_components=False,
                include_tree=False, include_week_components=False, section=section,
            )

    def test_shell_is_the_programme_cohorts_and_groups_without_building_modules(self):
        payload = self.build('shell', build_modules=module_builder_must_not_run)

        self.assertEqual(payload['programme']['id'], 'PROG-1')
        self.assertEqual(set(payload['flat']), {'cohorts', 'groups', 'groupIds', 'weekTemplates'})
        self.assertEqual([cohort['id'] for cohort in payload['flat']['cohorts']], ['C-1'])
        self.assertEqual([group['id'] for group in payload['flat']['groups']], ['G-1'])
        self.assertEqual(payload['flat']['groupIds'], ['G-1'])
        self.assertNotIn('cohorts', {key for key in payload if key != 'flat'})

    def test_modules_section_is_the_week_outline_and_sessions_only(self):
        payload = self.build('modules')

        self.assertEqual(set(payload), {'schema', 'flat'})
        self.assertEqual(set(payload['flat']), {'modules', 'sessions'})
        module = payload['flat']['modules'][0]
        self.assertTrue(module[views.WEEK_OUTLINE_MODULE_FLAG])
        self.assertNotIn('components', module['weekStructure'][0])
        self.assertEqual(module['weekStructure'][0]['title'], 'Week 1')
        self.assertEqual(payload['flat']['sessions'], [{'id': 'S-1'}])

    def test_without_a_section_the_document_is_unchanged(self):
        payload = self.build(None)

        self.assertEqual(
            set(payload['flat']),
            {'cohorts', 'groups', 'groupIds', 'modules', 'sessions', 'weekTemplates'},
        )
        self.assertEqual(payload['programme']['id'], 'PROG-1')


class ProgrammeDetailSectionViewTests(SimpleTestCase):
    def get(self, section, query=''):
        calls = []

        def build(identifier, visibility, **options):
            calls.append((identifier, visibility, options))
            return {'schema': 'test', 'flat': {}}

        request = RequestFactory().get(f'/curriculum/programmes/PROG-1/detail/{section}/{query}')
        with patch.multiple(
            views,
            build_curriculum_programme_tree_detail_payload=build,
            cached_curriculum_value=lambda key, factory, **kwargs: factory(),
            repair_curriculum_parent_links=lambda *args, **kwargs: None,
        ):
            response = views.curriculum_programme_detail_section(request, 'PROG-1', section)
        return response, calls

    def test_each_section_is_built_lean(self):
        for section in ('shell', 'modules'):
            with self.subTest(section=section):
                response, calls = self.get(section, '?visibility=all')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(calls, [('PROG-1', 'all', {
                    'include_stats': False,
                    'include_components': False,
                    'include_tree': False,
                    'include_week_components': False,
                    'section': section,
                })])

    def test_an_unknown_section_is_not_found(self):
        response, calls = self.get('components')

        self.assertEqual(response.status_code, 404)
        self.assertEqual(calls, [])
        self.assertIn('error', json.loads(response.content))
