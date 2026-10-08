"""Stage verified WordPress courses for the 211 workbook learners only.

This does not update the ten-person Advanced Admin allowlist, canonical
memberships, learner progress, or any learner-facing API.
"""

import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.client import HTTPException
from pathlib import Path
from time import sleep

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from learner_api.models import LearnerProfile
from learner_api.subject_source import _page
from learner_api.wordpress_cohort_links import (
    collect_page, identity_index, verified_link,
)
from login.management.commands.apply_advanced_admin_scope import selected_rows
from login.models import AdvancedAdminLearnerScope


CREATE_TABLE = '''CREATE TABLE IF NOT EXISTS "Learner".wordpress_course_matches (
    aptem_id bigint PRIMARY KEY,
    profile_id bigint NOT NULL,
    enrolment_id bigint NOT NULL,
    email_sha256 char(64) NOT NULL,
    match_status text NOT NULL CHECK (match_status IN ('verified','not_found','ambiguous')),
    source_learner_ids integer[] NOT NULL DEFAULT '{}',
    enrolled_course_count integer NOT NULL CHECK (enrolled_course_count >= 0),
    eligible_course_count integer NOT NULL CHECK (eligible_course_count >= 0),
    courses jsonb NOT NULL,
    verified_at timestamptz NOT NULL DEFAULT now()
)'''

UPSERT = '''INSERT INTO "Learner".wordpress_course_matches
    (aptem_id,profile_id,enrolment_id,email_sha256,match_status,source_learner_ids,
     enrolled_course_count,eligible_course_count,courses,verified_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,now())
    ON CONFLICT (aptem_id) DO UPDATE SET
      profile_id=excluded.profile_id,enrolment_id=excluded.enrolment_id,
      email_sha256=excluded.email_sha256,match_status=excluded.match_status,
      source_learner_ids=excluded.source_learner_ids,
      enrolled_course_count=excluded.enrolled_course_count,
      eligible_course_count=excluded.eligible_course_count,
      courses=excluded.courses,verified_at=excluded.verified_at'''


def fetch_page(endpoint, secret, page):
    """Retry an interrupted transport; malformed source data must still fail."""
    for attempt in range(3):
        try:
            return _page(endpoint, secret, page)
        except (OSError, HTTPException, EOFError):
            if attempt == 2:
                raise
            sleep(2 * (attempt + 1))


class Command(BaseCommand):
    help = 'Verify WordPress enrolments by email and stage the 211 learner links without changing their LMS screens.'

    def add_arguments(self, parser):
        parser.add_argument('--workbook', required=True)
        parser.add_argument('--expect-admin-scope', type=int, default=10)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        path = Path(options['workbook'])
        if not path.is_file():
            raise CommandError('Workbook not found.')
        workbook = selected_rows(path)
        ids = [int(value) for value in workbook]
        db = connections['enrolment'].settings_dict
        self.stdout.write(f"Target: {db['HOST']} / {db['NAME']}; workbook learners: {len(workbook)}")

        admin_scope = set(AdvancedAdminLearnerScope.objects.using('enrolment').values_list('aptem_id', flat=True))
        if len(admin_scope) != options['expect_admin_scope'] or not admin_scope.issubset(workbook):
            raise CommandError('Advanced Admin scope changed or includes a learner outside the workbook.')
        rows = list(LearnerProfile.objects.using('enrolment').filter(aptem_id__in=ids).values(
            'id', 'aptem_id', 'enrolment_id', 'email'))
        profiles = {str(row['aptem_id']): row for row in rows}
        if len(rows) != 211 or set(profiles) != set(workbook) or any(
                row['enrolment_id'] is None for row in rows):
            raise CommandError('The workbook learners do not have 211 unique LMS links.')
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''SELECT l.aptem_id,i.source_learner_id,
                coalesce(nullif(i.source_payload->>'source_email',''),i.source_payload->>'learner_email'),
                coalesce((i.source_payload#>>'{legacy_alias,is_primary}')::boolean,
                         i.source_payload ? 'record_id') AS is_primary
                FROM "Learner".learners l
                JOIN "Learner".learner_external_identities i
                  ON i.learner_id=l.id AND i.source_system='old_lms' AND i.deleted_at IS NULL
                WHERE l.aptem_id=ANY(%s)''', [ids])
            identities = cursor.fetchall()
        try:
            exact, fallback, known_ids = identity_index(profiles, identities)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        if not settings.KBC_LMS_API_KEY or not settings.KBC_LMS_SCHEMA_URL:
            raise CommandError('WordPress source API is not configured.')

        stage = 'source page 1'
        try:
            first = fetch_page(settings.KBC_LMS_SCHEMA_URL, settings.KBC_LMS_API_KEY, 1)
            total = first['pagination']['total_pages']
            if type(total) is not int or not 1 <= total <= 200:
                raise ValueError('WordPress page count is invalid.')
            matches = {}
            stage = 'matching source page 1'
            collect_page(first, exact, fallback, known_ids, matches)
            del first
            with ThreadPoolExecutor(max_workers=2) as pool:
                jobs = {pool.submit(fetch_page, settings.KBC_LMS_SCHEMA_URL, settings.KBC_LMS_API_KEY, page): page
                        for page in range(2, total + 1)}
                for job in as_completed(jobs):
                    page = jobs.pop(job)
                    stage = f'source page {page}'
                    payload = job.result()
                    if payload['pagination'].get('total_pages') != total:
                        raise ValueError('WordPress pagination changed during verification.')
                    stage = f'matching source page {page}'
                    collect_page(payload, exact, fallback, known_ids, matches)
                    del payload
            stage = 'aggregating verified learner courses'
            verified = [verified_link(aptem_id, profile, matches.get(aptem_id),
                        fallback_identity=aptem_id in fallback.values())
                        for aptem_id, profile in profiles.items()]
        except (OSError, HTTPException, EOFError, ValueError, TypeError, KeyError) as exc:
            raise CommandError(f'WordPress verification failed while {stage}: '
                               f'{type(exc).__name__}. No data was saved.') from exc

        counts = Counter(row['match_status'] for row in verified)
        eligible = sum(row['eligible_course_count'] for row in verified)
        self.stdout.write(f"Verified 211 learners across {total} source pages: "
                          f"matched={counts['verified']}, not_found={counts['not_found']}, "
                          f"ambiguous={counts['ambiguous']}, eligible_courses={eligible}.")
        if not options['apply']:
            self.stdout.write('Dry run; no data was saved.')
            return

        with transaction.atomic(using='enrolment'):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute(CREATE_TABLE)
                for row in verified:
                    cursor.execute(UPSERT, [
                        row['aptem_id'], row['profile_id'], row['enrolment_id'],
                        row['email_sha256'], row['match_status'], row['source_learner_ids'],
                        row['enrolled_course_count'], row['eligible_course_count'],
                        json.dumps(row['courses']),
                    ])
                cursor.execute('''SELECT count(*),count(*) FILTER (WHERE match_status='verified'),
                    coalesce(sum(eligible_course_count),0)
                    FROM "Learner".wordpress_course_matches WHERE aptem_id=ANY(%s)''', [ids])
                if cursor.fetchone() != (211, counts['verified'], eligible):
                    raise CommandError('Saved WordPress links did not verify; transaction rolled back.')
                cursor.execute('SELECT aptem_id FROM login."Advanced_admin_learner_scope"')
                if {row[0] for row in cursor.fetchall()} != admin_scope:
                    raise CommandError('Advanced Admin scope changed; transaction rolled back.')
        self.stdout.write(self.style.SUCCESS('WordPress links saved; Advanced Admin scope and learner screens unchanged.'))
