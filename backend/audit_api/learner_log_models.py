from django.db import models

from .db_source import resolve


class AuditDatabaseManager(models.Manager):
    def get_queryset(self):
        alias = resolve("audit")
        return super().get_queryset().using(alias)


class MreActivity(models.Model):
    objects = AuditDatabaseManager()
    plan_id = models.TextField(primary_key=True)
    month_no = models.IntegerField()
    month_unit = models.TextField()
    unit_planned_date = models.DateField()
    activity_date = models.DateField(null=True)
    week_sequence = models.TextField()
    activity_category = models.TextField()
    activity_unit = models.TextField()
    activity_description = models.TextField()
    delivery_method = models.TextField()
    planned_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True)
    key_ksbs = models.TextField(null=True)
    expected_evidence = models.TextField(null=True)
    source_course = models.TextField(null=True)
    source_url = models.TextField(null=True)
    source_basis = models.TextField(null=True)
    ibrahim_actual_lms_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True)
    aya_actual_lms_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True)
    huda_actual_lms_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True)
    ibrahim_activity_date = models.DateField(null=True)
    aya_activity_date = models.DateField(null=True)
    huda_activity_date = models.DateField(null=True)
    ibrahim_time_stamp_from_to = models.TextField(null=True)
    aya_time_stamp_from_to = models.TextField(null=True)
    huda_time_stamp_from_to = models.TextField(null=True)

    class Meta:
        managed = False
        db_table = '"Audit"."mre"'
        ordering = ["month_no", "unit_planned_date", "plan_id"]
