from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0012_coachcalendarcolorpreference")]

    operations = [
        migrations.RunSQL(
            sql='CREATE INDEX IF NOT EXISTS learner_reviews_learner_id_idx ON "Learner".reviews (learner_id)',
            reverse_sql='DROP INDEX IF EXISTS "Learner".learner_reviews_learner_id_idx',
        ),
        migrations.RunSQL(
            sql='CREATE INDEX IF NOT EXISTS learner_review_sections_review_id_idx ON "Learner".review_sections (review_id)',
            reverse_sql='DROP INDEX IF EXISTS "Learner".learner_review_sections_review_id_idx',
        ),
    ]
