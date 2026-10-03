from django.contrib import admin
from django import forms

from .migrated_reviews import validate_definition
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
        if not key.startswith(("id:", "name:")) or not key.split(":", 1)[1].strip():
            self.add_error("programme_key", "Use an exact id:<programme id> or name:<programme name> key.")
        elif key.startswith("name:") and key != key.casefold():
            self.add_error("programme_key", "Name fallback keys must be lowercase.")
        if values.get("is_active") and key and values.get("review_family"):
            assigned = MigratedReviewTemplate.objects.filter(
                programme_key=key, review_family=values["review_family"], is_active=True,
            )
            if self.instance.pk:
                assigned = assigned.exclude(pk=self.instance.pk)
            if assigned.exists():
                self.add_error("is_active", "An approved template is already assigned to this programme and family.")
        return values


@admin.register(MigratedReviewTemplate)
class MigratedReviewTemplateAdmin(admin.ModelAdmin):
    form = MigratedReviewTemplateForm
    list_display = ("id", "programme_key", "review_family", "name", "is_active", "updated_at")
    list_filter = ("review_family", "is_active")
    search_fields = ("programme_key", "name")
    readonly_fields = ("created_at", "updated_at")


