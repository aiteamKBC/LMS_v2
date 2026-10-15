"""Programme cards count KSBs against the standard the programme applies.

SimpleTestCase only -- no test database; the standard lookup is replaced.
"""
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import views

ST0596 = [{'code': 'K1'}, {'code': 'k2'}, {'code': 'S1'}, {'code': 'K1'}, {'code': ''}]


class AppliedStandardRequiredCodesTests(SimpleTestCase):
    def test_a_programme_on_a_standard_counts_the_standard(self):
        with patch.object(views, 'standard_required_ksbs', return_value=ST0596) as lookup:
            codes = views.applied_standard_required_codes(
                {'ksb_profile_source_id': 'standard:ST0596-v1-0'}, {})
        lookup.assert_called_once_with('st0596-v1-0')
        self.assertEqual(codes, ['K1', 'K2', 'S1'])

    def test_one_lookup_per_standard_per_build(self):
        cache = {}
        config = {'ksb_profile_source_id': 'standard:st0596-v1-0'}
        with patch.object(views, 'standard_required_ksbs', return_value=ST0596) as lookup:
            views.applied_standard_required_codes(config, cache)
            views.applied_standard_required_codes(config, cache)
        lookup.assert_called_once()

    def test_a_profile_source_or_none_keeps_the_profile_match(self):
        with patch.object(views, 'standard_required_ksbs') as lookup:
            self.assertIsNone(views.applied_standard_required_codes({'ksb_profile_source_id': 'KSBP-1'}, {}))
            self.assertIsNone(views.applied_standard_required_codes({}, {}))
            self.assertIsNone(views.applied_standard_required_codes(None, {}))
        lookup.assert_not_called()

    def test_an_unknown_standard_keeps_the_profile_match(self):
        with patch.object(views, 'standard_required_ksbs', return_value=[]):
            self.assertIsNone(views.applied_standard_required_codes(
                {'ksb_profile_source_id': 'standard:st9999-v1-0'}, {}))
