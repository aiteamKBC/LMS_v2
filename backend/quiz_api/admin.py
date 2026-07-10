from django.contrib import admin

from .models import QuizAnswer, QuizPackage, QuizQuestion


@admin.register(QuizPackage)
class QuizPackageAdmin(admin.ModelAdmin):
    list_display = ("title", "assessment_type", "package_type", "status", "questions", "schema_valid", "updated_at")
    list_filter = ("assessment_type", "status", "package_type", "schema_valid")
    search_fields = ("title", "module", "programme", "file_name")


@admin.register(QuizQuestion)
class QuizQuestionAdmin(admin.ModelAdmin):
    list_display = ("quiz", "question_text", "question_type", "sort_order")
    search_fields = ("question_text", "quiz__title")


@admin.register(QuizAnswer)
class QuizAnswerAdmin(admin.ModelAdmin):
    list_display = ("question", "answer_text", "is_correct", "sort_order")
    list_filter = ("is_correct",)
    search_fields = ("answer_text", "question__question_text")

# Register your models here.
