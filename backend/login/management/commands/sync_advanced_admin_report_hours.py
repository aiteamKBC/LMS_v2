"""Cache Time spent from Aptem Additional Job Activity assessment PDFs.

The command is read-only until --apply is supplied. It stores only a report
reference fingerprint, extracted seconds, and extraction status, never PDF text.
"""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from learner_api.evidence_storage import download_blob_bytes
from login.assessment_report_hours import report_seconds


SOURCE_SQL = """
    select e.evidence_id, e.report_blob, e.spent_time
    from fetching_evidence.evidence_items e
    where lower(btrim(e.evidence_kind)) = 'file'
      and lower(btrim(coalesce(e.component_name, ''))) ~
          '(additional|additioinal)[[:space:]]+job[[:space:]]+activit(y|ies)|miscellan'
      and exists (
          select 1 from login."Advanced_admin_learner_scope" s
          where s.aptem_id = e.learner_id::text)
      and nullif(btrim(e.report_blob), '') is not null
"""

CREATE_SQL = """
    create table if not exists login."Advanced_admin_report_hours" (
        evidence_id bigint primary key,
        report_hash char(32) not null,
        seconds bigint check (seconds is null or seconds >= 0),
        extraction_status varchar(24) not null check
            (extraction_status in ('parsed', 'missing_time', 'unreadable',
                                   'download_failed', 'oversize')),
        checked_at timestamptz not null default now()
    )
"""

UPSERT_SQL = """
    insert into login."Advanced_admin_report_hours"
        (evidence_id, report_hash, seconds, extraction_status, checked_at)
    values (%s, %s, %s, %s, now())
    on conflict (evidence_id) do update set
        report_hash = excluded.report_hash,
        seconds = excluded.seconds,
        extraction_status = excluded.extraction_status,
        checked_at = now()
"""


def _read_report(row):
    evidence_id, blob, source_minutes = row
    fingerprint = hashlib.md5(blob.encode('utf-8')).hexdigest()
    try:
        pdf = download_blob_bytes('fetch-aptem-evidences', blob, max_bytes=5 * 1024 * 1024)
    except ValueError:
        return (evidence_id, fingerprint, None, 'oversize', False)
    except Exception:
        return (evidence_id, fingerprint, None, 'download_failed', False)
    try:
        seconds = report_seconds(pdf)
    except Exception:
        return (evidence_id, fingerprint, None, 'unreadable', False)
    if seconds is None:
        return (evidence_id, fingerprint, None, 'missing_time', False)
    differs = source_minutes is not None and Decimal(seconds) != Decimal(source_minutes) * 60
    return (evidence_id, fingerprint, seconds, 'parsed', differs)


class Command(BaseCommand):
    help = 'Read and cache Time spent from Additional Job Activity assessment PDFs.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expect-candidates', type=int)
        parser.add_argument('--limit', type=int)
        parser.add_argument('--workers', type=int, default=8)
        parser.add_argument('--refresh', action='store_true', help='Re-read unchanged report references.')

    def handle(self, *args, **options):
        database = connections['enrolment']
        if database.vendor != 'postgresql':
            raise CommandError('The enrolment database must be PostgreSQL.')
        if options['limit'] is not None and options['limit'] <= 0:
            raise CommandError('--limit must be positive.')
        if not 1 <= options['workers'] <= 16:
            raise CommandError('--workers must be between 1 and 16.')
        if options['apply'] and options['expect_candidates'] is None:
            raise CommandError('--apply requires --expect-candidates from a fresh dry run.')
        self.stdout.write(f"Target: enrolment / {database.settings_dict['NAME']}")

        with database.cursor() as cursor:
            cursor.execute("select to_regclass('login.\"Advanced_admin_report_hours\"')")
            table_exists = cursor.fetchone()[0] is not None
            if table_exists and not options['refresh']:
                source = SOURCE_SQL + """
                    and not exists (
                        select 1 from login."Advanced_admin_report_hours" h
                        where h.evidence_id = e.evidence_id
                          and h.report_hash = md5(e.report_blob))
                """
            else:
                source = SOURCE_SQL
            source += ' order by e.evidence_id'
            params = []
            if options['limit'] is not None:
                source += ' limit %s'
                params.append(options['limit'])
            cursor.execute(source, params)
            candidates = cursor.fetchall()

        count = len(candidates)
        self.stdout.write(f'Reports to read: {count}.')
        if not options['apply']:
            self.stdout.write('Dry run; no changes made.')
            return
        if count != options['expect_candidates']:
            raise CommandError('Report source changed since the dry run; no changes made.')

        logging.getLogger('azure').setLevel(logging.ERROR)
        with database.cursor() as cursor:
            cursor.execute(CREATE_SQL)

        totals = {'parsed': 0, 'missing_time': 0, 'unreadable': 0,
                  'download_failed': 0, 'oversize': 0, 'differs': 0}
        with ThreadPoolExecutor(max_workers=options['workers']) as pool:
            pending = []
            for result in pool.map(_read_report, candidates):
                evidence_id, fingerprint, seconds, status, differs = result
                pending.append((evidence_id, fingerprint, seconds, status))
                totals[status] += 1
                totals['differs'] += int(differs)
                if len(pending) == 100:
                    with transaction.atomic(using='enrolment'):
                        with database.cursor() as cursor:
                            cursor.executemany(UPSERT_SQL, pending)
                    pending.clear()
                    self.stdout.write(f"Processed {sum(totals[key] for key in totals if key != 'differs')} / {count} reports.")
            if pending:
                with transaction.atomic(using='enrolment'):
                    with database.cursor() as cursor:
                        cursor.executemany(UPSERT_SQL, pending)

        self.stdout.write(self.style.SUCCESS(
            f"Read {count} reports: parsed {totals['parsed']}, missing time {totals['missing_time']}, "
            f"unreadable {totals['unreadable']}, download failed {totals['download_failed']}, "
            f"oversize {totals['oversize']}; source minute differences {totals['differs']}."))
