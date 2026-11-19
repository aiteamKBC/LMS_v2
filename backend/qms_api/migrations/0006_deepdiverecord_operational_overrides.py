from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("qms_api", "0005_deepdiverecord_notes")]

    operations = [
        migrations.AddField(
            model_name="deepdiverecord",
            name="operational_overrides",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
