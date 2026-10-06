"""Cover the fourth onboarding review, 'uln-privacy', by the booking uniqueness rule.

coach_calendar_booking_seq_uniq keeps one booking per (learner, event type,
sequence) for the learner-booked types, so a retried or concurrent booking can
never create a second meeting. The ULN Privacy Notice & Learner Acknowledgement
review is booked exactly like the other onboarding reviews, so it joins the list.

The partial index is rebuilt on whichever schema holds the base table. It was
created on "Coach".coach_calendar_event (0008), but some databases have since
moved that table to "Learner".coach_calendar_event and left a compatibility view
behind in "Coach" — an index cannot live on the view, so the table is looked up
rather than assumed. A database with neither (the test runner's own tables) is
left alone.

The drop and create run in this migration's transaction, so there is no moment
without the rule. Existing rows cannot conflict: no 'uln-privacy' event existed
before this change.
"""
from django.db import migrations, models

OLD_TYPES = ("catch-up", "student-support", "eligibility-review", "workspace", "training-plan")
NEW_TYPES = (*OLD_TYPES, "uln-privacy")


def _index_sql(types):
    listed = ", ".join(f"''{t}''" for t in types)
    return f'''
DO $$
DECLARE
    target_schema text;
BEGIN
    SELECT table_schema INTO target_schema
      FROM information_schema.tables
     WHERE table_name = 'coach_calendar_event'
       AND table_type = 'BASE TABLE'
       AND table_schema IN ('Learner', 'Coach')
     ORDER BY (table_schema = 'Learner') DESC
     LIMIT 1;
    IF target_schema IS NULL THEN
        RETURN;
    END IF;
    EXECUTE format('DROP INDEX IF EXISTS %I.coach_calendar_booking_seq_uniq', target_schema);
    EXECUTE format(
        'CREATE UNIQUE INDEX coach_calendar_booking_seq_uniq ON %I.coach_calendar_event '
        '(learner_id, event_type, sequence) WHERE event_type IN ({listed})',
        target_schema
    );
END
$$;
'''


class Migration(migrations.Migration):

    dependencies = [
        ("coach_api", "0015_importedreviewinstance"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(sql=_index_sql(NEW_TYPES), reverse_sql=_index_sql(OLD_TYPES)),
            ],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name="coachcalendarevent",
                    name="coach_calendar_booking_seq_uniq",
                ),
                migrations.AddConstraint(
                    model_name="coachcalendarevent",
                    constraint=models.UniqueConstraint(
                        condition=models.Q(event_type__in=list(NEW_TYPES)),
                        fields=("learner_id", "event_type", "sequence"),
                        name="coach_calendar_booking_seq_uniq",
                    ),
                ),
            ],
        ),
    ]
