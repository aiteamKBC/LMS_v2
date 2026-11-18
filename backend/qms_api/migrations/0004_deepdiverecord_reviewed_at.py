from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("qms_api", "0003_deepdiverecord_review_owners")]

    operations = [
        migrations.AddField(
            model_name="deepdiverecord",
            name="reviewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
