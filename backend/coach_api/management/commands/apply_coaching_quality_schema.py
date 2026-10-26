"""Explicit additive schema installation in the verified Coaching Session DB."""
from pathlib import Path
from django.core.management.base import BaseCommand,CommandError
from coach_api.quality_review_store import connect,ReviewUnavailable


class Command(BaseCommand):
    help = 'Check/apply the isolated lms_quality schema. Never runs on an HTTP request.'

    def add_arguments(self,parser):
        parser.add_argument('--expected-project',required=True)
        parser.add_argument('--expected-branch',required=True)
        parser.add_argument('--apply',action='store_true')
        parser.add_argument('--schema-version',type=int,choices=(1,2),default=2)

    def handle(self,*args,**options):
        try:
            with connect(write=options['apply']) as connection:
                target = connection.execute("SELECT current_setting('neon.project_id',true) AS project,current_setting('neon.branch_id',true) AS branch").fetchone()
                if target != {'project':options['expected_project'],'branch':options['expected_branch']}:
                    raise CommandError('The configured Coaching Session database is not the explicitly selected target.')
                if options['apply']:
                    connection.execute('SELECT pg_advisory_xact_lock(1346525001,4)')
                    for version in range(1,options['schema_version']+1):
                        sql = (Path(__file__).resolve().parents[2]/'sql'/f'coaching_quality_v{version}.sql').read_text(encoding='utf-8')
                        connection.execute(sql,prepare=False)
                tables = connection.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='lms_quality' ORDER BY table_name").fetchall()
                self.stdout.write('Verified Coaching Session target. Quality tables: '+', '.join(row['table_name'] for row in tables))
        except ReviewUnavailable as error:
            raise CommandError(str(error)) from None
