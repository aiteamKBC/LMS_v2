from django.contrib import admin
from django import forms
from django.db import transaction

from .migrated_reviews import validate_definition
from .migrated_templates import validate_managed_definition, validate_slot
from .models import MigratedReviewTemplate


class MigratedReviewTemplateForm(forms.ModelForm):
    class Meta:
        model = MigratedReviewTemplate
        fields = "__all__"

    def clean_definition_json(self):
        value = self.cleaned_data["definition_json"]
        try:
            return validate_definition(value)
        except ValueError as exc:
            raise forms.ValidationError(str(exc)) from exc

    def clean(self):
        values = super().clean()
        key = (values.get("programme_key") or "").strip()
        scope = values.get("scope", self.instance.scope or "PROGRAMME")
        family = values.get("review_family", self.instance.review_family)
        key = key or self.instance.programme_key
        try:
            validate_slot(scope, family, key)
        except ValueError as exc:
            self.add_error(None, str(exc))
        if values.get("is_active") and family:
            try:
                validate_managed_definition(values.get("definition_json"))
            except ValueError as exc:
                self.add_error("definition_json", str(exc))
            assigned = MigratedReviewTemplate.objects.filter(
                scope=scope, programme_key=key, review_family=family, is_active=True,
            )
            if self.instance.pk:
                assigned = assigned.exclude(pk=self.instance.pk)
            if assigned.exists():
                self.add_error("is_active", "An approved template is already assigned to this programme and family.")
        return values


@admin.register(MigratedReviewTemplate)
class MigratedReviewTemplateAdmin(admin.ModelAdmin):
    form = MigratedReviewTemplateForm
    list_display = ("id", "scope", "programme_key", "review_family", "name", "is_active", "updated_at")
    list_filter = ("scope", "review_family", "is_active")
    search_fields = ("programme_key", "name")
    readonly_fields = ("created_at", "updated_at", "source_metadata")

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields + (("scope", "programme_key", "review_family") if obj else ())

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        from .migrated_template_sync import lock_template_family
        with transaction.atomic():
            lock_template_family(obj.review_family)
            super().save_model(request, obj, form, change)


