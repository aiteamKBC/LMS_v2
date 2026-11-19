from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("qms_api", "0004_deepdiverecord_reviewed_at")]

    operations = [
        migrations.AddField(
            model_name="deepdiverecord",
            name="notes",
            field=models.TextField(blank=True),
        ),
    ]
