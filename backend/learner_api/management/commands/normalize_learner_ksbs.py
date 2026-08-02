import logging

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from learner_api.active_users import (
    _resolve_ksb_profile_source_id,
    _resolve_programme_id,
    replace_learner_ksbs,
)
from learner_api.models import LearnerProfile


logger = logging.getLogger(__name__)


DDL = """
CREATE TABLE IF NOT EXISTS curriculum.ksb_profile_versions (
    id bigserial PRIMARY KEY,
    source_profile_id varchar(255) NOT NULL,
    version_hash varchar(64) NOT NULL,
    programme text NOT NULL DEFAULT '',
    definition_count integer NOT NULL DEFAULT 0 CHECK (definition_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT curriculum_ksb_profile_versions_source_hash_uniq
        UNIQUE (source_profile_id, version_hash)
);

CREATE TABLE IF NOT EXISTS curriculum.ksb_definitions (
    id bigserial PRIMARY KEY,
    profile_version_id bigint NOT NULL
        REFERENCES curriculum.ksb_profile_versions(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position > 0),
    code varchar(100) NOT NULL,
    number varchar(100) NOT NULL DEFAULT '',
    ksb_type varchar(100) NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    CONSTRAINT curriculum_ksb_definitions_version_code_uniq
        UNIQUE (profile_version_id, code)
);

CREATE INDEX IF NOT EXISTS curriculum_ksb_definitions_version_position_idx
    ON curriculum.ksb_definitions (profile_version_id, position);

CREATE TABLE IF NOT EXISTS "Learner".learner_ksb_assignments (
    learner_id bigint PRIMARY KEY
        REFERENCES "Learner".learners(id) ON DELETE CASCADE,
    profile_version_id bigint NOT NULL
        REFERENCES curriculum.ksb_profile_versions(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learner_ksb_assignments_profile_version_idx
    ON "Learner".learner_ksb_assignments (profile_version_id);
"""


class Command(BaseCommand):
    help = (
        "Create shared versioned KSB definitions and assign each learner to one "
        "profile version without deleting the legacy learner_ksbs snapshot."
    )

    def handle(self, *args, **options):
        connection = connections["enrolment"]
        with transaction.atomic(using="enrolment"):
            with connection.cursor() as cursor:
                cursor.execute(DDL)
                cursor.execute(
                    'SELECT learner_id, position, code, number, ksb_type, description '
                    'FROM "Learner".learner_ksbs ORDER BY learner_id, position, id'
                )
                rows = cursor.fetchall()

            grouped = {}
            for learner_id, _position, code, number, ksb_type, description in rows:
                grouped.setdefault(learner_id, []).append({
                    "code": code,
                    "number": number,
                    "type": ksb_type,
                    "description": description,
                })

            migrated = 0
            for learner_id, items in grouped.items():
                try:
                    learner = LearnerProfile.objects.using("enrolment").get(pk=learner_id)
                except LearnerProfile.DoesNotExist as exc:
                    raise CommandError(f"Legacy KSB rows reference missing learner {learner_id}.") from exc

                programme_id = _resolve_programme_id(learner.programme, training_plan=None)
                source_id = _resolve_ksb_profile_source_id(
                    programme_id=programme_id,
                    programme=learner.programme,
                    training_plan=None,
                )
                replace_learner_ksbs(
                    learner,
                    items,
                    source_profile_id=source_id or programme_id or learner.programme,
                )
                migrated += 1

            with connection.cursor() as cursor:
                cursor.execute('SELECT count(DISTINCT learner_id) FROM "Learner".learner_ksbs')
                legacy_learners = int(cursor.fetchone()[0] or 0)
                cursor.execute('SELECT count(*) FROM "Learner".learner_ksb_assignments')
                assignments = int(cursor.fetchone()[0] or 0)
                if assignments < legacy_learners:
                    raise CommandError(
                        f"Verification failed: {assignments} assignments for {legacy_learners} legacy learners."
                    )

        self.stdout.write(self.style.SUCCESS(
            f"Assigned {migrated} learners to shared versioned KSB definitions; "
            "legacy learner_ksbs rows were preserved."
        ))
