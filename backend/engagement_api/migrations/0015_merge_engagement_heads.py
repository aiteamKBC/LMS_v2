"""Graph-only merge. Do not target this leaf to reconcile Free Courses.

Target learner_api 0030 explicitly; targeting this merge would schedule all
unrecorded ancestors, including unrelated schema operations.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0013_rename_learner_id_to_enrolment_id'), ('engagement_api', '0014_feedback_email_ticket_close')]
    operations = []
