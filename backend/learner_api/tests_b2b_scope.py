from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from . import employer_portal


class B2BEmployerScopeTests(SimpleTestCase):
    def test_manager_keeps_the_existing_owner_scope(self):
        employer = SimpleNamespace(pk=7, portal_role='manager', employer_group_ids=[10])
        self.assertEqual(employer_portal._employer_scope_ids(employer), [7])

    def test_hr_scope_includes_contacts_from_the_same_organisation(self):
        employer = SimpleNamespace(pk=7, portal_role='hr', employer_group_ids=[10, 11])
        query = Mock()
        query.values_list.side_effect = [[7, 8], [8, 9]]
        with patch.object(employer_portal.Employer.objects, 'filter', return_value=query) as filter_mock:
            scope = employer_portal._employer_scope_ids(employer)
        self.assertEqual(set(scope), {7, 8, 9})
        self.assertEqual(filter_mock.call_count, 2)

