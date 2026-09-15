import json
from datetime import date
from unittest.mock import patch

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


class ImportedModuleSessionCountTests(CurriculumPersistenceHarness):
    def test_module_closure_skips_saudi_day_and_workshop_without_changing_other_modules(self):
        module = {'sessions_number': 16, 'start_date': '2026-09-16', 'session_week_day': 'Monday, Wednesday',
                  'session_holidays': [{'id': 'saudi', 'label': 'Saudi National Day', 'startDate': '2026-09-23', 'endDate': '2026-09-23'}]}
        workshop = [{'id': 'workshop', 'label': 'Workshop', 'startDate': '2026-09-27', 'endDate': '2026-10-03'}]
        plan = views.module_delivery_session_plan(module, 16, date(2026, 9, 16), workshop)
        self.assertEqual(len(plan['sessions']), 16)
        self.assertEqual(plan['finalEndDate'], '2026-11-18')
        self.assertEqual(plan['skippedHolidays'], ['2026-09-23', '2026-09-28', '2026-09-30'])
        other = views.module_delivery_session_plan({**module, 'session_holidays': []}, 16, date(2026, 9, 16), workshop)
        self.assertIn('2026-09-23', [s['date'] for s in other['sessions']])

    def test_imported_live_sessions_replace_stale_count_without_counting_reading_row(self):
        weeks = [{
            'id': f'WEEK-IMPORT-{index}', 'weekNumber': index + 1, 'title': f'PCP {index + 1}',
            'components': [{'id': f'COMP-IMPORT-{index}', 'type': 'live-session', 'title': f'Live teaching {index + 1}', 'settings': {}}],
        } for index in range(16)]
        weeks.insert(2, {'id': 'WEEK-HOLIDAY', 'weekNumber': 3, 'title': 'Saudi National Day', 'components': [
            {'id': 'COMP-READING', 'type': 'reading', 'title': 'Holiday reading', 'settings': {}},
        ]})
        for index, week in enumerate(weeks):
            week['weekNumber'] = index + 1
        module_id = 'MOD-IMPORT-COUNT'
        payload = {
            'title': 'Advanced Project and Logistics Management', 'weeksNumber': 17,
            'sessionsNumber': 3, 'startDate': '2026-09-16', 'weekDays': 'Monday, Wednesday',
            'weekStructure': weeks,
        }
        saved = views.save_module_authoring_structure(module_id, payload)
        self.assertEqual(saved['sessionsNumber'], 16)
        self.assertEqual(saved['deliveryWeeks'], 8)
        self.assertEqual(len(saved['weekStructure']), 17)
        self.assertEqual({w['id'] for w in saved['weekStructure']}, {w['id'] for w in weeks})
        live = [c for w in saved['weekStructure'] for c in w['components'] if c['type'] == 'live-session']
        self.assertEqual(len(live), 16)
        self.assertEqual(len({c['settings']['sessionDate'] for c in live}), 16)
        self.assertEqual(saved['weekStructure'][2]['sessionDate'], '')
        for query in ('', '?weeks=17', '?sessions=16'):
            response = self.client.get(f'/curriculum_api/curriculum/modules/{module_id}/session-plan/{query}')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(len(response.json()['sessions']), 16)
        with patch.object(views, 'live_session_component_points', return_value=0):
            updated, created = views.attach_teams_meeting_to_module_weeks(module_id, {}, {}, [], create_missing=True, dry_run=True)
        self.assertEqual((updated, created), (16, 0))
        # Re-saving the payload sent by an old browser must not regress to 3.
        saved_again = views.save_module_authoring_structure(module_id, {**saved, 'sessionsNumber': 3})
        self.assertEqual(saved_again['sessionsNumber'], 16)

    def test_unfinished_calendar_weeks_keep_the_planned_session_count(self):
        saved = views.save_module_authoring_structure('MOD-EMPTY-COUNT', {
            'title': 'Eight teaching weeks', 'weeksNumber': 8, 'sessionsNumber': 16,
            'startDate': '2026-09-16', 'weekDays': 'Monday, Wednesday',
            'weekStructure': [{'weekNumber': index + 1, 'title': f'Week {index + 1}', 'components': []} for index in range(8)],
        })
        self.assertEqual(saved['sessionsNumber'], 16)
        self.assertEqual(len(saved['weekStructure']), 8)
