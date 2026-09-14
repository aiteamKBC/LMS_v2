from django.test import SimpleTestCase

from .otjh_totals import completed_otjh


class CompletedOtjhTests(SimpleTestCase):
    def test_only_accepted_assignment_time_is_added_to_actual(self):
        native = [{'id': 'accepted', 'type': 'assignment'},
                  {'id': 'pending', 'type': 'assignment'},
                  {'id': 'rejected', 'type': 'assignment'}]
        progress = [
            {'componentId': 'lesson', 'componentType': 'video', 'reportedTime': '30 minutes'},
            {'componentId': 'accepted', 'componentType': 'assignment', 'reportedTime': '2 hours'},
            {'componentId': 'pending', 'componentType': 'assignment', 'reportedTime': '6 hours'},
            {'componentId': 'rejected', 'componentType': 'assignment', 'reportedTime': '3 hours'},
        ]
        submissions = [
            {'component_ref': 'accepted', 'status': 'accepted', 'actual_time_hours': 2},
            {'component_ref': 'pending', 'status': 'pending_review', 'actual_time_hours': 6},
            {'component_ref': 'rejected', 'status': 'rejected', 'actual_time_hours': 3},
        ]
        self.assertEqual(completed_otjh(native, progress, submissions), 2.5)
