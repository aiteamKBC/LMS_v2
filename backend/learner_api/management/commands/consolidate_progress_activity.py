from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction

from learner_api.models import LearnerProfile


PROGRESS_TABLE = '"Learner"."learner_progress_entries"'
ACTIVITY_TABLE = '"Learner"."learner_activity_events"'


class Command(BaseCommand):
    help = (
        "Move the historical Activity Feed into learner_progress_entries and "
        "remove the redundant learner_activity_events table."
    )

    def handle(self, *args, **options):
        database = router.db_for_write(LearnerProfile) or "default"
        connection = connections[database]

        with transaction.atomic(using=database):
            with connection.cursor() as cursor:
                cursor.execute("select to_regclass(%s)", ['"Learner".learner_progress_entries'])
                if cursor.fetchone()[0] is None:
                    raise CommandError("Learner.learner_progress_entries does not exist.")

                cursor.execute(
                    f"""
                    alter table {PROGRESS_TABLE}
                        add column if not exists feed_kind varchar(30) not null default '',
                        add column if not exists feed_action text not null default '',
                        add column if not exists feed_title text not null default '',
                        add column if not exists feed_detail text not null default '',
                        add column if not exists feed_occurred_at timestamp with time zone
                    """
                )
                cursor.execute(
                    f"""
                    create index if not exists idx_learner_progress_feed_time
                    on {PROGRESS_TABLE} (learner_id, feed_occurred_at desc)
                    where feed_kind <> ''
                    """
                )

                cursor.execute("select to_regclass(%s)", ['"Learner".learner_activity_events'])
                if cursor.fetchone()[0] is None:
                    self.stdout.write(self.style.SUCCESS("Activity data is already consolidated."))
                    return

                cursor.execute(f"select count(*) from {ACTIVITY_TABLE}")
                source_count = cursor.fetchone()[0]
                cursor.execute(
                    f"""
                    insert into {PROGRESS_TABLE} (
                        learner_id, entry_order, kind,
                        module_title, week_title,
                        component_ref, component_title, component_type,
                        quiz_ref, passed, submitted_at,
                        feed_kind, feed_action, feed_title, feed_detail, feed_occurred_at
                    )
                    select
                        event.learner_id,
                        coalesce(existing.max_order, 0)
                            + row_number() over (
                                partition by event.learner_id
                                order by event.event_order, event.id
                              ),
                        'activity_event',
                        coalesce(event.module_title, ''),
                        coalesce(event.week_title, ''),
                        event.component_ref,
                        coalesce(event.title, ''),
                        coalesce(event.component_type, ''),
                        event.quiz_ref,
                        event.passed,
                        event.occurred_at,
                        coalesce(event.kind, ''),
                        coalesce(event.action, ''),
                        coalesce(event.title, ''),
                        coalesce(event.detail, ''),
                        event.occurred_at
                    from {ACTIVITY_TABLE} event
                    left join (
                        select learner_id, max(entry_order) as max_order
                        from {PROGRESS_TABLE}
                        group by learner_id
                    ) existing on existing.learner_id = event.learner_id
                    """
                )
                migrated_count = cursor.rowcount
                if migrated_count != source_count:
                    raise CommandError(
                        f"Refusing to drop activity table: expected {source_count} rows, "
                        f"migrated {migrated_count}."
                    )

                cursor.execute(
                    f"select count(*) from {PROGRESS_TABLE} where kind = 'activity_event'"
                )
                stored_count = cursor.fetchone()[0]
                if stored_count < source_count:
                    raise CommandError(
                        f"Refusing to drop activity table: only {stored_count} migrated rows are visible."
                    )

                cursor.execute(f"drop table {ACTIVITY_TABLE}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Migrated {source_count} activity events into learner_progress_entries "
                "and removed learner_activity_events."
            )
        )
