from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("qms_api", "0002_deepdivesyncrun")]

    operations = [
        migrations.AddField(
            model_name="deepdiverecord",
            name="observer",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="deepdiverecord",
            name="reviewed_by",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
