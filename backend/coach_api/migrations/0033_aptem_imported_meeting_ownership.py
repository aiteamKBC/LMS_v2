"""Reserve provider onlineMeeting identity for a source-qualified imported Review.

This is a new empty registry. No historical booking is silently backfilled.
The calendar ORM addresses a compatibility view, so its FK targets the physical
Learner table explicitly. Apply only to a separately verified PostgreSQL target.
"""
from django.db import migrations, models
import django.db.models.deletion


def require_postgresql(_apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        raise RuntimeError('Imported meeting ownership requires PostgreSQL.')


FORWARD = r'''
ALTER TABLE "Coach"."coach_imported_meeting_ownership"
  ADD CONSTRAINT aptem_owner_calendar_fk
  FOREIGN KEY (calendar_event_id) REFERENCES "Learner".coach_calendar_event(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Coach"."coach_imported_meeting_ownership"
  ADD CONSTRAINT aptem_owner_source_fk
  FOREIGN KEY (source_review_id) REFERENCES "Learner".reviews(id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Coach"."coach_imported_meeting_ownership"
  ADD CONSTRAINT aptem_owner_provider_valid CHECK (
    tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
    AND organizer_id <> '00000000-0000-0000-0000-000000000000'::uuid
    AND online_meeting_id ~ '^[!-~]+$' AND online_meeting_id NOT LIKE '%://%'
    AND graph_event_id <> ''
    AND booking_fingerprint ~ '^[0-9a-f]{64}$'
    AND provenance = 'graph-calendar-verified'
  );

CREATE FUNCTION "Coach".aptem_imported_meeting_owner_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Verified meeting ownership cannot be deleted.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.source_review_id IS DISTINCT FROM OLD.source_review_id
      OR NEW.learner_id IS DISTINCT FROM OLD.learner_id
      OR NEW.review_event_key IS DISTINCT FROM OLD.review_event_key
      OR NEW.calendar_event_id IS DISTINCT FROM OLD.calendar_event_id
      OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
      OR NEW.organizer_id IS DISTINCT FROM OLD.organizer_id
      OR NEW.online_meeting_id IS DISTINCT FROM OLD.online_meeting_id
      OR NEW.graph_event_id IS DISTINCT FROM OLD.graph_event_id
      OR NEW.provenance IS DISTINCT FROM OLD.provenance
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR (OLD.state = 'cancelled' AND NEW.state <> 'cancelled') THEN
      RAISE EXCEPTION 'Verified meeting ownership cannot be transferred or replaced.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM "Learner".reviews s
      WHERE s.id = NEW.source_review_id AND s.learner_id = NEW.learner_id
        AND 'imported-review:' || s.aptem_review_id::text = NEW.review_event_key
    ) OR NOT EXISTS (
      SELECT 1 FROM "Learner".coach_calendar_event c
      WHERE c.id = NEW.calendar_event_id AND c.learner_id = NEW.learner_id
        AND c.event_key = NEW.review_event_key
        AND lower(c.owner_email) = lower(NEW.owner_email)
        AND c.graph_event_id = NEW.graph_event_id
    ) OR (NEW.overlay_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Coach".coach_imported_review_instance o
      WHERE o.id = NEW.overlay_id AND o.source_review_id = NEW.source_review_id
        AND o.learner_id = NEW.learner_id AND o.event_key = NEW.review_event_key
        AND lower(o.owner_email) = lower(NEW.owner_email)
    )) THEN
    RAISE EXCEPTION 'Verified meeting ownership association is inconsistent.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $guard$;

CREATE TRIGGER aptem_imported_meeting_owner_guard
  BEFORE UPDATE OR DELETE ON "Coach"."coach_imported_meeting_ownership"
  FOR EACH ROW EXECUTE FUNCTION "Coach".aptem_imported_meeting_owner_guard();

CREATE FUNCTION "Coach".aptem_owned_calendar_identity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $calendar$
BEGIN
  IF EXISTS (SELECT 1 FROM "Coach".coach_imported_meeting_ownership o
             WHERE o.calendar_event_id = OLD.id AND o.state = 'active') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Owned imported meeting calendar cannot be deleted.'
        USING ERRCODE = '23514';
    END IF;
    IF (NEW.event_key, NEW.learner_id, NEW.owner_email, NEW.graph_event_id,
        NEW.graph_organizer_email, NEW.meeting_link, NEW.graph_web_link)
       IS DISTINCT FROM
       (OLD.event_key, OLD.learner_id, OLD.owner_email, OLD.graph_event_id,
        OLD.graph_organizer_email, OLD.meeting_link, OLD.graph_web_link)
       AND current_setting('coach.aptem_owner_verified_sync', true) IS DISTINCT FROM 'on'
    THEN
      RAISE EXCEPTION 'Owned imported meeting identity requires verified synchronization.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $calendar$;

CREATE TRIGGER aptem_owned_calendar_identity_guard
  BEFORE UPDATE OR DELETE ON "Learner".coach_calendar_event
  FOR EACH ROW EXECUTE FUNCTION "Coach".aptem_owned_calendar_identity_guard();
'''

REVERSE = r'''
DO $reverse$
BEGIN
  IF EXISTS (SELECT 1 FROM "Coach"."coach_imported_meeting_ownership") THEN
    RAISE EXCEPTION 'Refusing to discard verified meeting ownership.';
  END IF;
END $reverse$;
DROP TRIGGER aptem_owned_calendar_identity_guard ON "Learner".coach_calendar_event;
DROP FUNCTION "Coach".aptem_owned_calendar_identity_guard();
DROP TRIGGER aptem_imported_meeting_owner_guard ON "Coach"."coach_imported_meeting_ownership";
DROP FUNCTION "Coach".aptem_imported_meeting_owner_guard();
'''


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0032_aptem_actual_session_claim_integrity')]
    operations = [
        migrations.RunPython(require_postgresql, migrations.RunPython.noop),
        migrations.CreateModel(
            name='ImportedMeetingOwnership',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name='ID')),
                ('source_review_id', models.BigIntegerField()),
                ('learner_id', models.IntegerField()),
                ('review_event_key', models.CharField(max_length=255)),
                ('calendar_event_id', models.BigIntegerField()),
                ('owner_email', models.EmailField(max_length=255)),
                ('tenant_id', models.UUIDField()),
                ('organizer_id', models.UUIDField()),
                ('online_meeting_id', models.CharField(max_length=240)),
                ('graph_event_id', models.CharField(max_length=255)),
                ('booking_fingerprint', models.CharField(max_length=64)),
                ('provenance', models.CharField(default='graph-calendar-verified', max_length=32)),
                ('state', models.CharField(default='active', max_length=16)),
                ('verified_at', models.DateTimeField()),
                ('overlay', models.ForeignKey(blank=True, null=True,
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='meeting_ownerships',
                    to='coach_api.importedreviewinstance')),
            ],
            options={
                'db_table': 'Coach"."coach_imported_meeting_ownership',
                'constraints': [
                    models.UniqueConstraint(fields=('tenant_id', 'organizer_id', 'online_meeting_id'),
                                            name='aptem_owner_provider_uniq'),
                    models.UniqueConstraint(fields=('calendar_event_id',),
                                            name='aptem_owner_calendar_uniq'),
                    models.UniqueConstraint(fields=('source_review_id',),
                                            condition=models.Q(state='active'),
                                            name='aptem_owner_active_source_uniq'),
                    models.CheckConstraint(condition=models.Q(state__in=['active', 'cancelled']),
                                           name='aptem_owner_state_valid'),
                    models.CheckConstraint(condition=~models.Q(online_meeting_id=''),
                                           name='aptem_owner_meeting_nonempty'),
                ],
            },
        ),
        migrations.RunSQL(FORWARD, REVERSE),
    ]
