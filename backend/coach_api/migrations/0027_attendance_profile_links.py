from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("coach_api", "0026_migrated_review_revisions"),
        ("learner_api", "0022_install_progress_transfer_storage"),
        ("learner_api", "0022_support_tickets"),
    ]

    # These columns and constraints were added to the externally owned Coach
    # tables before they were represented in Django state.  Keep the SQL
    # idempotent so applying this migration on an already-provisioned database
    # does not try to recreate them.
    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql="""
                    DO $$
                    BEGIN
                        IF to_regclass('"Coach".coach_manual_attendance') IS NOT NULL THEN
                            ALTER TABLE "Coach".coach_manual_attendance
                                ADD COLUMN IF NOT EXISTS learner_profile_link_id bigint;
                            ALTER TABLE "Coach".coach_manual_attendance
                                ADD COLUMN IF NOT EXISTS enrolment_link_id integer;
                            IF NOT EXISTS (
                                SELECT 1 FROM pg_constraint
                                WHERE conname = 'coach_manual_profile_link_fk'
                            ) THEN
                                ALTER TABLE "Coach".coach_manual_attendance
                                    ADD CONSTRAINT coach_manual_profile_link_fk
                                    FOREIGN KEY (learner_profile_link_id)
                                    REFERENCES "Learner".learners(id)
                                    ON DELETE SET NULL;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM pg_constraint
                                WHERE conname = 'coach_manual_enrolment_link_fk'
                            ) THEN
                                ALTER TABLE "Coach".coach_manual_attendance
                                    ADD CONSTRAINT coach_manual_enrolment_link_fk
                                    FOREIGN KEY (enrolment_link_id)
                                    REFERENCES enrolment."Created_users"(id)
                                    ON DELETE SET NULL;
                            END IF;
                        END IF;

                        IF to_regclass('"Coach".coach_attendance_adjustment') IS NOT NULL THEN
                            ALTER TABLE "Coach".coach_attendance_adjustment
                                ADD COLUMN IF NOT EXISTS learner_profile_link_id bigint;
                            IF NOT EXISTS (
                                SELECT 1 FROM pg_constraint
                                WHERE conname = 'coach_adjustment_profile_link_fk'
                            ) THEN
                                ALTER TABLE "Coach".coach_attendance_adjustment
                                    ADD CONSTRAINT coach_adjustment_profile_link_fk
                                    FOREIGN KEY (learner_profile_link_id)
                                    REFERENCES "Learner".learners(id)
                                    ON DELETE SET NULL;
                            END IF;
                        END IF;
                    END $$;
                    """,
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="coachmanualattendance",
                    name="learner_profile_link",
                    field=models.ForeignKey(
                        blank=True,
                        db_column="learner_profile_link_id",
                        db_index=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="coach_manual_attendance_links",
                        to="learner_api.learnerprofile",
                    ),
                ),
                migrations.AddField(
                    model_name="coachmanualattendance",
                    name="enrolment_link",
                    field=models.ForeignKey(
                        blank=True,
                        db_column="enrolment_link_id",
                        db_index=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="coach_manual_attendance_enrolment_links",
                        to="learner_api.enrolmentuser",
                    ),
                ),
                migrations.AddField(
                    model_name="coachattendancesourceadjustment",
                    name="learner_profile_link",
                    field=models.ForeignKey(
                        blank=True,
                        db_column="learner_profile_link_id",
                        db_index=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="coach_attendance_adjustment_links",
                        to="learner_api.learnerprofile",
                    ),
                ),
            ],
        ),
    ]
