"""Audited, idempotent permission for one additional legacy quiz submission."""
from importlib import import_module
from uuid import uuid4

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Grant one additional submission for an owned completed legacy quiz; dry-run by default.'

    def add_arguments(self, parser):
        parser.add_argument('--kind', required=True, choices=('commercial', 'apprenticeship'))
        parser.add_argument('--enrolment-id', required=True, type=int)
        parser.add_argument('--course-id', required=True, type=int)
        parser.add_argument('--quiz-id', required=True, type=int)
        parser.add_argument('--ticket', required=True)
        parser.add_argument('--reason', required=True)
        parser.add_argument('--operator', required=True)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--install-storage', action='store_true')

    def handle(self, *args, **options):
        from learner_api.student_activity import _owned_quiz
        from learner_api.progress_transfer_store import lock_learner, assert_legacy_writable
        from learner_api.legacy_quiz_retakes import GRANTS

        db = connections['enrolment']
        if db.vendor != 'postgresql':
            raise CommandError('This operation requires a verified PostgreSQL database.')
        enrolment_id, course_id, quiz_id = (options[key] for key in ('enrolment_id', 'course_id', 'quiz_id'))
        if min(enrolment_id, course_id, quiz_id) <= 0:
            raise CommandError('Learner, course and quiz references must be positive.')
        if any(not options[key].strip() for key in ('ticket', 'reason', 'operator')):
            raise CommandError('Ticket, reason and operator are required.')

        with transaction.atomic(using='enrolment'):
            if not options['apply']:
                with db.cursor() as cursor:
                    cursor.execute('SET TRANSACTION READ ONLY')
            aptem_id, quiz = _owned_quiz(options['kind'], enrolment_id, course_id, quiz_id)
            if not quiz['completed'] or not (quiz.get('quiz') or {}).get('ready'):
                raise CommandError('Verify a completed owned quiz with valid grading content before granting a retake.')
            if not options['apply']:
                self.stdout.write('DRY RUN: owned completed quiz verified; one additional submission would be permitted.')
                return
            if options['install_storage']:
                with db.cursor() as cursor:
                    cursor.execute(import_module('learner_api.migrations.0025_legacy_quiz_retake_grants').SQL)
            with lock_learner(enrolment_id) as cursor:
                assert_legacy_writable(cursor, enrolment_id, course_id)
                cursor.execute(f'''INSERT INTO {GRANTS}
                    (id,enrolment_id,aptem_id,group_id,quiz_id,ticket_ref,reason,granted_by)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT(enrolment_id,group_id,quiz_id,ticket_ref) DO NOTHING RETURNING id''',
                    [uuid4(), enrolment_id, aptem_id, course_id, quiz_id,
                     options['ticket'].strip(), options['reason'].strip(), options['operator'].strip()])
                created = cursor.fetchone() is not None
        self.stdout.write(self.style.SUCCESS('One additional quiz submission granted.' if created
            else 'Existing ticket permission retained; no additional permission created.'))
