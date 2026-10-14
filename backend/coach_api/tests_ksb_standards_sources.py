"""KSB standards migration: AI marking and caseload read the applied source.

SimpleTestCase only -- no test database, no network; database reads replaced.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from coach_api import ai_marking, views as coach_views
from learner_api import ksb_exclusions
from learner_api.ksb_sources import ResolvedKsbSource


def resolved(kind, source_id, *, label='', active=True, ref='', items=()):
    return ResolvedKsbSource(kind=kind, source_id=source_id, label=label, active=active,
                             standard_ref=ref, items=list(items))


class EpaStandardTests(SimpleTestCase):
    def test_standard_source_names_the_standard_directly(self):
        with patch.object(ai_marking, '_programme_links', return_value=(['PROG-ME-L4'], ['standard:st0596-v1-0'])), \
             patch.object(ai_marking, 'resolve_source') as resolve:
            self.assertEqual(ai_marking._programme_standard('Marketing Executive Level 4'), 'st0596')
        resolve.assert_not_called()

    def test_archived_applied_profile_still_gives_its_standard(self):
        with patch.object(ai_marking, '_programme_links', return_value=([], ['KSBP-1'])), \
             patch.object(ai_marking, 'resolve_source',
                          return_value=resolved('profile', 'KSBP-1', active=False, ref='st0845')):
            self.assertEqual(ai_marking._programme_standard('OTHM Level 7'), 'st0845')

    def test_no_source_and_no_programme_ids_means_no_standard(self):
        with patch.object(ai_marking, '_programme_links', return_value=([], [])):
            self.assertEqual(ai_marking._programme_standard('Unknown'), '')


class KsbFrameworkTests(SimpleTestCase):
    def test_standard_programme_reads_the_standard(self):
        items = [{'code': 'K1', 'description': 'Marketing theory'}, {'code': 'S2', 'description': 'Plan campaigns'}]
        with patch.object(ai_marking, '_programme_links', return_value=(['PROG-ME-L4'], ['standard:st0596-v1-0'])), \
             patch.object(ai_marking, 'resolve_source',
                          return_value=resolved('standard', 'st0596-v1-0', label='Marketing executive', items=items)), \
             patch.object(ai_marking, 'connections') as connections:
            text, count = ai_marking.load_ksb_framework('Marketing Executive Level 4')
        self.assertEqual(count, 2)
        self.assertTrue(text.startswith('Apprenticeship standard: Marketing executive (st0596-v1-0)'))
        self.assertIn('K1: Marketing theory', text)
        connections.__getitem__.assert_not_called()  # no profile scan needed

    def test_archived_applied_profile_is_still_used(self):
        items = [{'code': 'K1.1', 'description': 'Marketing theory'}]
        with patch.object(ai_marking, '_programme_links', return_value=(['PROG-X'], ['KSBP-1'])), \
             patch.object(ai_marking, 'resolve_source',
                          return_value=resolved('profile', 'KSBP-1', label='Old profile', active=False, items=items)):
            text, count = ai_marking.load_ksb_framework('Programme X')
        self.assertEqual(count, 1)
        self.assertTrue(text.startswith('KSB profile: Old profile'))

    def test_missing_source_falls_back_to_discovery_among_active_profiles(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(ai_marking, '_programme_links', return_value=([], [])), \
             patch.object(ai_marking, 'connections', {'default': connection}):
            self.assertEqual(ai_marking.load_ksb_framework('Unknown'), ('', 0))
        self.assertIn('is_active = true', cursor.execute.call_args.args[0])


class CaseloadExclusionTests(SimpleTestCase):
    def test_caseload_completed_codes_skip_registered_rows(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [(1, 'K2')]
        connection = MagicMock()
        connection.alias = 'learner'
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(coach_views, 'get_learner_db_alias', return_value='learner'), \
             patch.object(coach_views, 'connections', {'learner': connection}), \
             patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=True):
            result = coach_views.caseload_completed_ksb_codes([SimpleNamespace(id=1)])
        self.assertEqual(result, {1: {'K2'}})
        self.assertIn('learner_progress_ksb_exclusions', cursor.execute.call_args.args[0])
