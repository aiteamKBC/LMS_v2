"""Direct Python regression tests: no Django startup, database or network."""
import ast
from datetime import datetime, timezone
from pathlib import Path
import re
import sys
import types
import unittest
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('curriculum_api', package)
from curriculum_api.teams_presenter_roles import presenter_co_organizers, roles_changed
from curriculum_api.teams_meeting_options_policy import meeting_options_patch


class PresenterRoomRolesTests(unittest.TestCase):
    def test_presenter_keeps_lms_label_and_also_gets_coorganizer_role(self):
        presenters = ['Tutor@example.invalid']
        explicit = ['co@example.invalid']
        co = presenter_co_organizers(presenters, explicit, 'owner@example.invalid')
        self.assertEqual(co, ['co@example.invalid', 'tutor@example.invalid'])
        self.assertEqual(presenters, ['Tutor@example.invalid'])
        self.assertEqual(explicit, ['co@example.invalid'])
        body = meeting_options_patch({'roles'}, recording='none', lobby_scope='invited', spoken_language='en-GB',
                                     attendees=['learner@example.invalid'], presenters=presenters, co_organizers=co)
        self.assertEqual(set(body), {'participants', 'allowedPresenters'})
        self.assertEqual(body['participants']['attendees'], [
            {'upn': 'co@example.invalid', 'role': 'coorganizer'},
            {'upn': 'tutor@example.invalid', 'role': 'coorganizer'},
            {'upn': 'learner@example.invalid', 'role': 'attendee'},
        ])

    def test_owner_and_case_duplicates_do_not_use_extra_places(self):
        self.assertEqual(presenter_co_organizers(['TUTOR@example.invalid', 'OWNER@example.invalid'],
                                              ['tutor@example.invalid'], 'owner@example.invalid'),
                         ['tutor@example.invalid'])

    def test_limit_never_removes_existing_people_to_make_room(self):
        existing = [f'co{i}@example.invalid' for i in range(10)]
        self.assertEqual(len(presenter_co_organizers([], existing)), 10)
        with self.assertRaisesRegex(ValueError, 'up to 10 co-organizers'):
            presenter_co_organizers(['tutor@example.invalid'], existing)
        self.assertEqual(len(existing), 10)

    def test_unchanged_roles_are_not_an_implicit_repair_on_other_edits(self):
        self.assertFalse(roles_changed(['TUTOR@example.invalid'], [], ['tutor@example.invalid'], []))
        self.assertTrue(roles_changed(['tutor@example.invalid'], ['tutor@example.invalid'],
                                     ['tutor@example.invalid'], []))


class EventPayloadTests(unittest.TestCase):
    def payload_function(self):
        """Exercise the actual payload builder without importing the Django application."""
        source = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        names = {'teams_event_payload', 'teams_attendee_emails'}
        module = ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef)
                                  and node.name in names], type_ignores=[])
        scope = {
            '__name__': 'curriculum_api.views', '__package__': 'curriculum_api',
            'datetime': datetime, 'timezone': timezone, 're': re,
            'clean_str': lambda value: str(value or '').strip(),
            'teams_calendar_subject': lambda payload: 'Synthetic lesson',
            'teams_meeting_default_organizer': lambda: 'owner@example.invalid',
            'graph_timezone_iana': lambda settings: 'Europe/London', 'calendar_zone': ZoneInfo,
            'TEAMS_REPEAT_VALUES': {'none', 'weekly'},
            'calendar_targets': lambda payload, start, duration, repeat, count, zone: [{'start': start, 'end': start}],
            'graph_calendar_time': lambda instant, zone, graph_zone: {'dateTime': instant.isoformat(), 'timeZone': graph_zone},
            'teams_event_body_html': lambda title, details: title,
            'local_calendar_recurrence': lambda *args: None,
        }
        exec(compile(module, str(ROOT / 'views.py'), 'exec'), scope)
        return scope['teams_event_payload']

    def test_new_meeting_stores_both_roles_and_keeps_attendees_private(self):
        result = self.payload_function()({
            'localStartDateTime': '2026-11-12T09:00:00', 'startDateTimeUtc': '2026-11-12T09:00:00Z',
            'presenters': ['tutor@example.invalid'], 'coOrganizers': ['co@example.invalid'],
            'attendees': ['learner@example.invalid', 'tutor@example.invalid'],
        }, {})
        event, invited, presenters, co, attendees = result[:5]
        self.assertEqual(presenters, ['tutor@example.invalid'])
        self.assertEqual(co, ['co@example.invalid', 'tutor@example.invalid'])
        self.assertEqual(attendees, ['learner@example.invalid'])
        self.assertEqual(len(invited), 3)
        self.assertTrue(event['hideAttendees'])

    def test_existing_date_edit_can_preserve_legacy_roles_without_promoting(self):
        existing = [f'co{i}@example.invalid' for i in range(12)]
        result = self.payload_function()({
            'localStartDateTime': '2026-11-12T09:00:00', 'startDateTimeUtc': '2026-11-12T09:00:00Z',
            'presenters': ['tutor@example.invalid'], 'coOrganizers': existing,
        }, {}, promote_presenters=False)
        self.assertEqual(result[3], existing)


if __name__ == '__main__':
    unittest.main()
