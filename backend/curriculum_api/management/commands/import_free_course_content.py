"""Read-only plan by default; explicit target fingerprint and backup for apply."""
import hashlib
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection
from config.management_safety import read_only_databases

from curriculum_api.free_course_import import import_content, import_plan


class Command(BaseCommand):
    help = 'Import free-course content without replacing existing courses or learner history.'

    def add_arguments(self, parser):
        parser.add_argument('--export', required=True)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-target')
        parser.add_argument('--backup')

    def handle(self, **options):
        from curriculum_api import views as v
        if connection.vendor != 'postgresql':
            raise CommandError('This import requires the verified PostgreSQL target.')
        with connection.cursor() as cursor:
            cursor.execute('SELECT current_database()')
            if cursor.fetchone()[0] != connection.settings_dict['NAME']:
                raise CommandError('Connected database differs from configuration.')
        target = hashlib.sha256((connection.settings_dict['HOST'] + '/' + connection.settings_dict['NAME']).encode()).hexdigest()
        export = json.loads(Path(options['export']).read_text(encoding='utf-8'))
        try:
            with read_only_databases():
                _, counts = import_plan(export)
            if options['apply']:
                if options['expected_target'] != target or not options['backup']:
                    raise CommandError('Apply requires the plan target fingerprint and a new private backup path.')
                backup = {table: v.free_programme_fetch_all(table) for table in (
                    v.FREE_COURSES_TABLE, v.FREE_PROGRAMME_MODULES_TABLE, v.FREE_PROGRAMME_COMPONENTS_TABLE)}
                with Path(options['backup']).open('x', encoding='utf-8') as stream:
                    json.dump({'targetFingerprint': target, 'tables': backup}, stream, cls=DjangoJSONEncoder)
                counts = import_content(export)
            self.stdout.write(json.dumps({'targetFingerprint': target, 'applied': bool(options['apply']), **counts}))
        except (ValueError, OSError, KeyError) as exc:
            raise CommandError(str(exc)) from exc
