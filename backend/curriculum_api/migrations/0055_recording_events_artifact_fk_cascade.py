from django.db import migrations


def add_on_update_cascade(apps, schema_editor):
    """Let a recording artifact's id change without orphaning its watch events.

    curriculum.live_session_artifacts.id used to be a fresh uuid4() on every
    re-sync of the same Teams artifact (see the accompanying fix in
    upsert_live_session_artifact), which meant this foreign key could in
    principle already have blocked a re-sync with an IntegrityError once
    anyone had watched the recording -- ON DELETE CASCADE was set, but ON
    UPDATE was left at the default NO ACTION. The id is derived
    deterministically now, so it should only ever change once more per
    artifact (the one-time move off whatever id it happened to hold), but
    ON UPDATE CASCADE is the correct, permanent fix: the artifact row is the
    one both sides agree is "the same Teams artifact", and its watch events
    should always follow it rather than fail the whole re-sync.
    """
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass('curriculum.live_session_recording_events')")
        if not cursor.fetchone()[0]:
            return
        cursor.execute('''
            alter table curriculum.live_session_recording_events
            drop constraint if exists live_session_recording_events_artifact_id_fkey
        ''')
        cursor.execute('''
            alter table curriculum.live_session_recording_events
            add constraint live_session_recording_events_artifact_id_fkey
            foreign key (artifact_id) references curriculum.live_session_artifacts (id)
            on delete cascade on update cascade
        ''')


def revert(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass('curriculum.live_session_recording_events')")
        if not cursor.fetchone()[0]:
            return
        cursor.execute('''
            alter table curriculum.live_session_recording_events
            drop constraint if exists live_session_recording_events_artifact_id_fkey
        ''')
        cursor.execute('''
            alter table curriculum.live_session_recording_events
            add constraint live_session_recording_events_artifact_id_fkey
            foreign key (artifact_id) references curriculum.live_session_artifacts (id)
            on delete cascade
        ''')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0054_module_tutor_email'),
    ]

    operations = [
        migrations.RunPython(add_on_update_cascade, revert),
    ]
