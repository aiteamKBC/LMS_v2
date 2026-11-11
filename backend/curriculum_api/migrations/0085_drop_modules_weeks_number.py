"""Drop the stored weeks_number column from curriculum.modules.

The column was written at save time and read back as the displayed week count.
It is now derived on the fly: the Module Builder reads len(active_week_rows(…)),
and learner/coach SQL paths use a correlated COUNT(*) subquery with
visible_week_sql().  The column is redundant and can be removed once all
application code that wrote or read it has been deployed.

RESTRICTION: use RESTRICT, not CASCADE.  If any view, function, trigger, or
foreign key still references weeks_number, the migration will fail visibly
rather than silently dropping dependent objects.

Rollback: add the column back as nullable and leave existing rows with NULL.
Application code no longer writes the column, so a rollback does not restore
historical values — it only reinstates the column so old code can be redeployed.
"""
from django.db import migrations


FORWARD = '''
ALTER TABLE curriculum.modules
    DROP COLUMN IF EXISTS weeks_number RESTRICT;
'''


REVERSE = '''
ALTER TABLE curriculum.modules
    ADD COLUMN IF NOT EXISTS weeks_number integer;
'''


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum_api', '0084_free_course_authoring_prerequisites'),
    ]

    operations = [migrations.RunSQL(FORWARD, REVERSE)]
