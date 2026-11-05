"""One applied KSB source per programme, named the same everywhere.

``curriculum.programmes.ksb_profile_source_id`` is the authority. Applying a
standard never unlinks the programme from a manual profile's ``programme_ids``,
so PROG-PCP-L6 -- on ST0845 -- was still listed by the archived "Empty KSB
profile", and the programme card/header read that name while Coverage and
Achievement measured ST0845. These tests pin the stored source first, active
manual profiles still honoured, and archived ones never speaking for a programme.
"""
from contextlib import ExitStack
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import views


ST0845 = {
    'id': 'st0845-v1-1', 'code': 'ST0845', 'version': '1.1', 'name': 'Project controls professional',
    'ksbs': [{'code': 'K1', 'type': 'knowledge'}, {'code': 'S1', 'type': 'skill'}],
}
ST0310 = {
    'id': 'st0310-v1-5', 'code': 'ST0310', 'version': '1.5', 'name': 'Associate project manager',
    'ksbs': [{'code': 'K1', 'type': 'knowledge'}],
}
STANDARDS = {'st0845-v1-1': ST0845, 'st0310-v1-5': ST0310}

ARCHIVED_EMPTY = {
    'id': 'KSBP-EMPTY', 'ksb_profile_id': 'KSBP-EMPTY', 'name': 'Empty KSB profile', 'is_active': False,
    'programme_ids': ['PROG-PCP-L6', 'Project Controls Professional Level 6', 'PROG-BARE', 'Bare Programme'],
    'ksb_items': [],
}
ACTIVE_BESPOKE = {
    'id': 'KSBP-BESPOKE', 'ksb_profile_id': 'KSBP-BESPOKE', 'name': 'Bespoke data profile', 'is_active': True,
    'programme_ids': ['PROG-BESPOKE', 'Bespoke Programme', 'Named Only Programme'],
    'ksb_items': [{'type': 'K', 'code': '1'}, {'type': 'S', 'code': '1'}, {'type': 'B', 'code': '1'}],
}
PROFILES = [ARCHIVED_EMPTY, ACTIVE_BESPOKE]


def find_standard(identifier):
    return STANDARDS.get(str(identifier or '').lower())


def config(programme_id, name, source=''):
    return {'programme_id': programme_id, 'name': name, 'ksb_profile_source_id': source,
            'is_active': True, 'is_archived': False, 'status': 'active'}


def build(configs, profiles=PROFILES):
    with ExitStack() as stack:
        for name, value in (
            ('free_programme_fetch_all', []),
            ('cohort_authoring_detail_rows', []),
            ('active_learner_programme_counts', ({}, {})),
            ('programme_learner_ksb_progress', {}),
            ('programme_component_ksb_mapping_count', 0),
            ('authoring_programme_structure_counts', ({}, {})),
        ):
            stack.enter_context(patch.object(views, name, return_value=value))
        stack.enter_context(patch.object(views, 'find_skills_england_standard', side_effect=find_standard))
        return {item['sourceId']: item for item in views.build_programmes([], configs, profiles)}


class StoredSourceReaderTests(SimpleTestCase):
    def test_reads_every_stored_form(self):
        self.assertEqual(views.programme_config_ksb_source({'ksb_profile_source_id': 'standard:st0845-v1-1'}), ('standard', 'st0845-v1-1'))
        self.assertEqual(views.programme_config_ksb_source({'ksb_profile_source_id': 'profile:KSBP-1'}), ('framework', 'KSBP-1'))
        self.assertEqual(views.programme_config_ksb_source({'ksb_profile_source_id': 'KSBP-1'}), ('framework', 'KSBP-1'))
        self.assertEqual(views.programme_config_ksb_source({'ksb_profile_source_id': ''}), ('', ''))
        self.assertEqual(views.programme_config_ksb_source(None), ('', ''))

    def test_row_reader_delegates_to_it(self):
        rows = [config('PROG-PCP-L6', 'Project Controls Professional Level 6', 'standard:st0845-v1-1')]
        with patch.object(views, 'get_program_config_rows', return_value=rows):
            self.assertEqual(views.programme_row_ksb_source('PROG-PCP-L6'), ('standard', 'st0845-v1-1'))
            self.assertEqual(views.programme_row_ksb_source('Project Controls Professional Level 6'), ('standard', 'st0845-v1-1'))
            self.assertEqual(views.programme_row_ksb_source('PROG-UNKNOWN'), ('', ''))


class AppliedProfileTests(SimpleTestCase):
    def test_an_applied_standard_is_never_overridden_by_a_profile_listing_the_programme(self):
        row = config('PROG-PCP-L6', 'Project Controls Professional Level 6', 'standard:st0845-v1-1')
        self.assertIsNone(views.programme_applied_ksb_profile(row, PROFILES, row['name']))
        # Even an active profile listing it is a leftover link once a standard is applied.
        listed = {**ACTIVE_BESPOKE, 'programme_ids': ['PROG-PCP-L6', row['name']]}
        self.assertIsNone(views.programme_applied_ksb_profile(row, [listed], row['name']))

    def test_an_applied_active_manual_profile_is_honoured(self):
        row = config('PROG-BESPOKE', 'Bespoke Programme', 'KSBP-BESPOKE')
        self.assertIs(views.programme_applied_ksb_profile(row, PROFILES, row['name']), ACTIVE_BESPOKE)
        prefixed = config('PROG-BESPOKE', 'Bespoke Programme', 'profile:KSBP-BESPOKE')
        self.assertIs(views.programme_applied_ksb_profile(prefixed, PROFILES, row['name']), ACTIVE_BESPOKE)
        coverage_form = config('PROG-BESPOKE', 'Bespoke Programme', 'ksb-KSBP-BESPOKE')
        self.assertIs(views.programme_applied_ksb_profile(coverage_form, PROFILES, row['name']), ACTIVE_BESPOKE)

    def test_the_stored_profile_beats_another_profile_matching_the_name(self):
        row = config('PROG-X', 'Bespoke Programme', 'KSBP-EMPTY')
        self.assertIs(views.programme_applied_ksb_profile(row, PROFILES, row['name']), ARCHIVED_EMPTY)

    def test_an_explicitly_applied_archived_profile_is_still_the_programmes_source(self):
        row = config('PROG-PARKED', 'Parked Programme', 'KSBP-EMPTY')
        self.assertIs(views.programme_applied_ksb_profile(row, PROFILES, row['name']), ARCHIVED_EMPTY)

    def test_with_nothing_stored_only_an_active_profile_matches_by_name(self):
        bare = config('PROG-BARE', 'Bare Programme')
        self.assertIsNone(views.programme_applied_ksb_profile(bare, PROFILES, bare['name']))
        named = config('PROG-NAMED', 'Named Only Programme')
        self.assertIs(views.programme_applied_ksb_profile(named, PROFILES, named['name']), ACTIVE_BESPOKE)

    def test_a_stored_profile_that_no_longer_exists_does_not_fall_back_to_a_name(self):
        row = config('PROG-NAMED', 'Named Only Programme', 'KSBP-GONE')
        self.assertIsNone(views.programme_applied_ksb_profile(row, PROFILES, row['name']))


class ProgrammeCardLabelTests(SimpleTestCase):
    def test_the_card_names_the_applied_standard_not_an_archived_profile(self):
        programmes = build([config('PROG-PCP-L6', 'Project Controls Professional Level 6', 'standard:st0845-v1-1')])
        card = programmes['PROG-PCP-L6']
        self.assertEqual(card['standard'], 'Project controls professional')
        self.assertEqual(card['ksbProfileSourceId'], 'standard:st0845-v1-1')
        self.assertEqual(card['ksbTotal'], 2)

    def test_an_active_manual_profile_still_names_its_programme(self):
        programmes = build([config('PROG-BESPOKE', 'Bespoke Programme', 'KSBP-BESPOKE')])
        self.assertEqual(programmes['PROG-BESPOKE']['standard'], 'Bespoke data profile')
        self.assertEqual(programmes['PROG-BESPOKE']['ksbTotal'], 3)

    def test_with_nothing_stored_an_archived_profile_does_not_name_the_programme(self):
        programmes = build([config('PROG-BARE', 'Bare Programme'), config('PROG-NAMED', 'Named Only Programme')])
        self.assertEqual(programmes['PROG-BARE']['standard'], 'Bare Programme')
        self.assertEqual(programmes['PROG-BARE']['ksbTotal'], 0)
        self.assertEqual(programmes['PROG-NAMED']['standard'], 'Bespoke data profile')

    def test_changing_the_applied_source_changes_the_label(self):
        name = 'Project Controls Professional Level 6'
        before = build([config('PROG-PCP-L6', name, 'standard:st0310-v1-5')])['PROG-PCP-L6']
        after_standard = build([config('PROG-PCP-L6', name, 'standard:st0845-v1-1')])['PROG-PCP-L6']
        after_profile = build([config('PROG-PCP-L6', name, 'KSBP-BESPOKE')])['PROG-PCP-L6']
        unapplied = build([config('PROG-PCP-L6', name, '')])['PROG-PCP-L6']
        self.assertEqual(
            [before['standard'], after_standard['standard'], after_profile['standard'], unapplied['standard']],
            ['Associate project manager', 'Project controls professional', 'Bespoke data profile', name],
        )
        self.assertEqual([before['ksbTotal'], after_standard['ksbTotal'], after_profile['ksbTotal'], unapplied['ksbTotal']], [1, 2, 3, 0])

    def test_an_unknown_standard_falls_back_to_the_programme_name(self):
        programmes = build([config('PROG-ODD', 'Odd Programme', 'standard:st9999-v1-0')])
        self.assertEqual(programmes['PROG-ODD']['standard'], 'Odd Programme')


class CoverageSourceTests(SimpleTestCase):
    def infer(self, stored, profiles, programme_name):
        module_rows = [{'programme_name': programme_name, 'programme_id': 'PROG-X'}]
        with patch.object(views, 'programme_row_ksb_source', return_value=stored), \
             patch.object(views, 'get_ksb_profile_rows', return_value=profiles), \
             patch.object(views, 'build_skills_england_standards', return_value=[]):
            return views.infer_source_from_scope(module_rows, 'programme', 'PROG-X')

    def test_the_stored_standard_decides_coverage(self):
        self.assertEqual(
            self.infer(('standard', 'st0845-v1-1'), PROFILES, 'Bespoke Programme'),
            ('standard', 'st0845-v1-1', 'programme'),
        )

    def test_with_nothing_stored_an_archived_profile_is_not_the_coverage_source(self):
        self.assertEqual(self.infer(('', ''), PROFILES, 'Bare Programme'), ('', '', ''))

    def test_with_nothing_stored_an_active_profile_still_is(self):
        self.assertEqual(
            self.infer(('', ''), PROFILES, 'Named Only Programme'),
            ('framework', 'ksb-KSBP-BESPOKE', 'programme-name'),
        )


class AchievementSourceTests(SimpleTestCase):
    def projection(self, stored, items):
        payload = {'coverage': {'items': items, 'components': [], 'modules': []}, 'assignedLearners': [], 'consumptionSources': {'progress': []}}
        request = RequestFactory().get('/curriculum_api/curriculum/programmes/PROG-PCP-L6/ksb-achievement/')
        with patch.object(views, 'programme_achievement_inputs', return_value=(payload, None)), \
             patch.object(views, 'programme_row_ksb_source', return_value=stored), \
             patch.object(views, 'find_skills_england_standard', side_effect=find_standard), \
             patch.object(views, 'get_ksb_profile_rows', return_value=PROFILES):
            projection, error = views._achievement_projection(request, 'PROG-PCP-L6')
        self.assertIsNone(error)
        return projection['appliedSource']

    def test_achievement_names_the_standard_the_card_names(self):
        source = self.projection(('standard', 'st0845-v1-1'), [
            {'code': 'K1', 'source_type': 'standard', 'source_id': 'st0845-v1-1'},
            {'code': 'K9', 'source_type': 'framework', 'source_id': 'KSBP-EMPTY'},
        ])
        card = build([config('PROG-PCP-L6', 'Project Controls Professional Level 6', 'standard:st0845-v1-1')])['PROG-PCP-L6']
        self.assertEqual(source['id'], 'st0845-v1-1')
        self.assertEqual(source['label'], 'Project controls professional (ST0845 v1.1)')
        self.assertTrue(source['label'].startswith(card['standard']))
        self.assertEqual(source['definitionCount'], 1)

    def test_achievement_names_an_active_manual_profile(self):
        source = self.projection(('framework', 'KSBP-BESPOKE'), [
            {'code': 'K1', 'source_type': 'framework', 'source_id': 'KSBP-BESPOKE'},
        ])
        self.assertEqual((source['type'], source['id'], source['label']), ('framework', 'KSBP-BESPOKE', 'Bespoke data profile'))

    def test_achievement_reports_no_source_only_when_none_is_stored(self):
        source = self.projection(('', ''), [{'code': 'K1', 'source_type': 'framework', 'source_id': 'KSBP-EMPTY'}])
        self.assertEqual((source['id'], source['definitionCount']), ('', 0))
