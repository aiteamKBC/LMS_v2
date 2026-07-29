# The Neon chat tables pre-date this Django app and already exist in the
# ``chat`` PostgreSQL schema. This migration deliberately records the previous
# local model revision without issuing any DDL against the existing tables.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [('chat', '0002_alter_messagereceipt_read_at')]

    operations = [migrations.RunPython(migrations.RunPython.noop, migrations.RunPython.noop)]
