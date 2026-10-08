"""Read-only scope checks for Advanced Admin eligibility PDF data."""

import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from login.advanced_admin import learner_eligibility_form


class AdvancedAdminEligibilityFormTests(SimpleTestCase):
    def test_only_returns_the_requested_eligibility_form_for_the_scoped_learner(self):
        request = RequestFactory().get(
            '/login_api/advanced-admin/learners/42/eligibility/eligibility-review:7:1/form/'
        )
        profile = SimpleNamespace(id=42, enrolment_id=7)
        review = SimpleNamespace(event_key='eligibility-review:7:1')
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.models.EnrolmentReview.objects') as reviews, \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.review_form._serialize_form', return_value={'eventKey': review.event_key}) as serialize:
            reviews.filter.return_value.first.return_value = review
            learner = learners.get.return_value
            response = learner_eligibility_form.__wrapped__.__wrapped__(
                request, 42, review.event_key
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'eventKey': review.event_key})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        reviews.filter.assert_called_once_with(
            learner_kind='commercial', learner_id=7,
            review_type='eligibility-review', event_key='eligibility-review:7:1',
        )
        serialize.assert_called_once_with(review, learner, None)

    def test_out_of_scope_learner_does_not_query_a_review(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/99/eligibility/other/form/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.models.EnrolmentReview.objects') as reviews:
            response = learner_eligibility_form.__wrapped__.__wrapped__(request, 99, 'other')
        self.assertEqual(response.status_code, 404)
        reviews.filter.assert_not_called()

    def test_missing_event_key_does_not_open_another_review(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/eligibility/other/form/')
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(id=42, enrolment_id=7)), \
             patch('learner_api.models.EnrolmentReview.objects') as reviews, \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners:
            reviews.filter.return_value.first.return_value = None
            response = learner_eligibility_form.__wrapped__.__wrapped__(request, 42, 'other')
        self.assertEqual(response.status_code, 404)
        reviews.filter.assert_called_once_with(
            learner_kind='commercial', learner_id=7,
            review_type='eligibility-review', event_key='other',
        )
        learners.get.assert_not_called()
