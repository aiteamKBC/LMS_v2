from django.db import models


class ModuleAuthoringModule(models.Model):
    module_catalogue_id = models.CharField(max_length=128, primary_key=True)
    programme_id = models.CharField(max_length=255, blank=True, default='')
    programme_name = models.CharField(max_length=255, blank=True, default='')
    cohort_id = models.CharField(max_length=255, blank=True, default='')
    cohort_name = models.CharField(max_length=255, blank=True, default='')
    group_id = models.CharField(max_length=255, blank=True, default='')
    group_name = models.CharField(max_length=255, blank=True, default='')
    title = models.CharField(max_length=500)
    description = models.TextField(blank=True, default='')
    status = models.CharField(max_length=32, default='draft')
    total_otjh = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    quality_score = models.IntegerField(default=0)
    source_type = models.CharField(max_length=64, blank=True, default='')
    source_id = models.CharField(max_length=128, blank=True, default='')
    imported_from_training_plan_id = models.CharField(max_length=128, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_modules'
        managed = False


class ModuleAuthoringWeek(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    module_catalogue_id = models.CharField(max_length=128, db_index=True)
    week_number = models.IntegerField(default=1)
    title = models.CharField(max_length=500, blank=True, default='')
    summary = models.TextField(blank=True, default='')
    learning_outcomes = models.JSONField(default=list, blank=True)
    display_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_weeks'
        managed = False


class ModuleAuthoringComponent(models.Model):
    TYPE_CHOICES = [
        ('live_session', 'Live session'),
        ('video', 'Video'),
        ('podcast', 'Podcast'),
        ('reading', 'Reading'),
        ('quiz', 'Quiz'),
        ('reflection', 'Reflection'),
        ('workplace_evidence', 'Workplace evidence'),
        ('assignment', 'Assignment'),
        ('checkpoint', 'Checkpoint'),
    ]

    id = models.CharField(max_length=128, primary_key=True)
    week_id = models.CharField(max_length=128, db_index=True)
    module_catalogue_id = models.CharField(max_length=128, db_index=True)
    type = models.CharField(max_length=64, choices=TYPE_CHOICES)
    title = models.CharField(max_length=500, blank=True, default='')
    description = models.TextField(blank=True, default='')
    expected_otjh = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    points = models.IntegerField(default=0)
    reflection_required = models.BooleanField(default=False)
    workplace_evidence_required = models.BooleanField(default=False)
    tutor_validation_required = models.BooleanField(default=False)
    display_order = models.IntegerField(default=0)
    settings_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_components'
        managed = False


class ModuleAuthoringKsbMapping(models.Model):
    CLASSIFICATION_CHOICES = [
        ('main', 'Main'),
        ('secondary', 'Secondary'),
        ('possible', 'Possible'),
        ('practice', 'Practice (legacy)'),
    ]

    id = models.CharField(max_length=128, primary_key=True)
    module_catalogue_id = models.CharField(max_length=128, db_index=True)
    week_id = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    component_id = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    ksb_id = models.CharField(max_length=255, blank=True, null=True)
    ksb_code = models.CharField(max_length=64)
    ksb_description = models.TextField(blank=True, default='')
    source_type = models.CharField(max_length=32, blank=True, default='')
    source_id = models.CharField(max_length=255, blank=True, default='')
    classification = models.CharField(max_length=32, choices=CLASSIFICATION_CHOICES, default='secondary')
    weight = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_ksb_mappings'
        managed = False


class ModuleAuthoringCompletionCriteria(models.Model):
    module_catalogue_id = models.CharField(max_length=128, primary_key=True)
    quizzes_completed_required = models.BooleanField(default=False)
    checkpoints_completed_required = models.BooleanField(default=False)
    average_score_required_enabled = models.BooleanField(default=False)
    average_score_required = models.IntegerField(default=70)
    total_score_required_enabled = models.BooleanField(default=False)
    total_score_required = models.IntegerField(default=100)
    additional_notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_completion_criteria'
        managed = False


class ModuleAuthoringAdvancedDetails(models.Model):
    module_catalogue_id = models.CharField(max_length=128, primary_key=True)
    background = models.TextField(blank=True, default='')
    epa_requirements = models.JSONField(default=list, blank=True)
    professional_qualification_outcomes = models.JSONField(default=list, blank=True)
    intent = models.TextField(blank=True, default='')
    learner_benefit = models.TextField(blank=True, default='')
    employer_benefit = models.TextField(blank=True, default='')
    sequence_purpose = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_advanced_details'
        managed = False


class CohortAuthoringDetails(models.Model):
    cohort_id = models.CharField(max_length=128, primary_key=True)
    cohort_name = models.CharField(max_length=500, blank=True, default='')
    programme_id = models.CharField(max_length=255, blank=True, default='')
    programme_name = models.CharField(max_length=255, blank=True, default='')
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    duration_months = models.IntegerField(default=0)
    color = models.CharField(max_length=32, blank=True, default='')
    status = models.CharField(max_length=32, default='planned')
    training_plan_ids = models.JSONField(default=list, blank=True)
    group_ids = models.JSONField(default=list, blank=True)
    module_names = models.JSONField(default=list, blank=True)
    holiday_ids = models.JSONField(default=list, blank=True)
    selected_holidays = models.JSONField(default=list, blank=True)
    holidays_in_range = models.JSONField(default=list, blank=True)
    holiday_summary = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True, default='')
    source_type = models.CharField(max_length=64, default='training_plan')
    source_id = models.CharField(max_length=128, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."cohort_authoring_details'
        managed = False
