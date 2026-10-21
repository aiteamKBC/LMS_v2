from django.db import migrations


def supply_legacy_defaults(apps, schema_editor):
    """Some deployed databases retain columns from the older OTJH implementation.

    Current authoring stores hours in definition_json. Supply defaults only for
    legacy columns that exist without a default; retain every stored value and
    any environment's existing defaults. Fresh schemas need no extra columns.
    """
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'Coach' AND table_name = 'coach_migrated_review_template'
              AND column_name IN ('expected_otjh', 'counts_towards_otjh')
              AND column_default IS NULL""")
        columns = {row[0] for row in cursor.fetchall()}
        for column, default in (("expected_otjh", "0"), ("counts_towards_otjh", "false")):
            if column in columns:
                cursor.execute(f'ALTER TABLE "Coach".coach_migrated_review_template '
                               f'ALTER COLUMN "{column}" SET DEFAULT {default}')


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0027_personal_support_template")]

    # Retain compatibility defaults on reversal; removing them would break new
    # inserts again. No historical values or JSON definitions are rewritten.
    operations = [migrations.RunPython(supply_legacy_defaults, migrations.RunPython.noop)]
