"""AST-loaded guard tests: no Django setup, database, Graph, or network."""
import ast
from datetime import date, time
from pathlib import Path
from types import SimpleNamespace
import unittest


class CalendarRecord:
    STATUS_SCHEDULED = 'scheduled'
    STATUS_NOT_SCHEDULED = 'not-scheduled'


class CoachNonDeliveryBookingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source_path = Path(__file__).with_name('views.py')
        tree = ast.parse(source_path.read_text(encoding='utf-8'))
        names = {
            'LearnerCalendarConflict',
            'reserve_coach_calendar_booking',
            'persist_calendar_sync_reservation',
            'booking_non_delivery_reason',
        }
        selected = [
            node for node in tree.body
            if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name in names
        ]
        namespace = {
            'CoachCalendarEvent': CalendarRecord,
            'date': date,
            'time': time,
            'normalize_email': lambda value: value,
            'clean_text': lambda value: str(value or '').strip(),
            'NON_DELIVERY_WEEKEND_MESSAGE': 'Sessions and meetings can only be booked Monday to Friday.',
            'england_non_delivery_reason': lambda value: (
                'Sessions and meetings can only be booked Monday to Friday.'
                if value.weekday() >= 5 else ''
            ),
        }
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(source_path), 'exec'), namespace)
        cls.conflict = namespace['LearnerCalendarConflict']
        cls.reserve = staticmethod(namespace['reserve_coach_calendar_booking'])
        cls.persist = staticmethod(namespace['persist_calendar_sync_reservation'])

    def test_new_booking_is_rejected_before_any_database_reservation(self):
        with self.assertRaisesRegex(self.conflict, 'Monday to Friday'):
            self.reserve(
                owner_email='coach@example.test', owner_name='Coach', learner_id=1,
                learner_name='Learner', learner_email='learner@example.test',
                # TEMPORARY: catch-ups may be booked at weekends, so this uses an MCM.
                session_type='mcr', scheduled_date=date(2026, 9, 19),
                scheduled_time=time(10, 0), duration_minutes=60, notes='',
                idempotency_key='booking-weekend-1',
            )

    def test_reschedule_is_rejected_before_the_transaction_starts(self):
        # TEMPORARY: catch-ups may be booked at weekends, so this uses an MCM.
        candidate = SimpleNamespace(event_type='mcr', scheduled_date=date(2026, 9, 20))
        with self.assertRaisesRegex(self.conflict, 'Monday to Friday'):
            self.persist(candidate)


if __name__ == '__main__':
    unittest.main()
