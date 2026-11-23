"""Graph-only merge. Do not target this leaf to reconcile Free Courses.

Target learner_api 0030 explicitly; targeting this merge would schedule all
unrecorded ancestors, including unrelated schema operations.
"""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0085_drop_modules_weeks_number'), ('curriculum_api', '0091_curriculum_video_source'), ('curriculum_api', '0091_module_week_boundary_mode')]
    operations = []
