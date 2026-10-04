from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0022_migrated_template_scopes")]

    operations = [
        # Django's RemoveConstraint uses an unqualified DROP INDEX for partial
        # unique constraints. Coach is outside the default search_path, so 0022
        # can leave this superseded index behind. Both new slot indexes already
        # enforce uniqueness. Reversing 0022 recreates the original constraint.
        migrations.RunSQL(
            'DROP INDEX IF EXISTS "Coach"."coach_migrated_template_one_active"',
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
