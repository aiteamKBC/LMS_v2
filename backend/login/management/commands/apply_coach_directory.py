"""Add the independent booking directory; never rewrite imported/admin-edited rows."""
import json
from pathlib import Path
from django.core.management.base import BaseCommand
from django.db import connections, transaction
from login.coach_directory import validated


class Command(BaseCommand):
    help = 'Create login.coach_directory and import the existing published booking catalogue once.'

    def handle(self, *args, **options):
        catalogue = json.loads((Path(__file__).resolve().parents[3] / 'old_otjh/data/coach_bookings.json').read_text(encoding='utf-8'))['coaches']
        with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cur:
            cur.execute("""CREATE TABLE IF NOT EXISTS login.coach_directory (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                name varchar(255) NOT NULL, slug varchar(255) NOT NULL UNIQUE,
                links jsonb NOT NULL DEFAULT '{}'::jsonb,
                version integer NOT NULL DEFAULT 1,
                updated_at timestamptz NOT NULL DEFAULT now())""")
            # A marker prevents deleted coaches being resurrected by a repeated deployment.
            cur.execute('CREATE TABLE IF NOT EXISTS login.coach_directory_import (source text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now())')
            cur.execute("INSERT INTO login.coach_directory_import(source) VALUES ('wordpress-catalogue-v1') ON CONFLICT DO NOTHING RETURNING source")
            if cur.fetchone():
                for coach in catalogue:
                    if coach['name'].strip().lower() == 'elaf' or coach['name'].strip().lower().startswith('olivia'):
                        continue
                    name, links = validated(coach)
                    cur.execute('INSERT INTO login.coach_directory(name,slug,links) VALUES (%s,%s,%s::jsonb) ON CONFLICT(slug) DO NOTHING', [name, coach['slug'], json.dumps(links)])
            cur.execute('SELECT count(*) FROM login.coach_directory')
            self.stdout.write(f'Coach directory ready: {cur.fetchone()[0]} records.')
