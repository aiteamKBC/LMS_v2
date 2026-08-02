from django.contrib import admin

from .models import Conversation, Message, MessageReceipt


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "coach", "learner", "created_at", "updated_at")
    list_filter = ("created_at", "updated_at")
    search_fields = (
        "coach__id",
        "coach__name",
        "coach__email",
        "learner__full_name",
        "learner__email",
    )
    raw_id_fields = ("coach", "learner")
    readonly_fields = ("created_at", "updated_at")

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("coach", "learner")


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "conversation",
        "sender_display",
        "created_at",
        "edited_at",
        "is_deleted",
    )
    list_filter = ("is_deleted", "created_at", "edited_at")
    search_fields = (
        "body",
        "sender_coach__name",
        "sender_coach__email",
        "sender_learner__full_name",
        "sender_learner__email",
    )
    raw_id_fields = ("conversation", "sender_coach", "sender_learner")
    readonly_fields = ("created_at",)

    @admin.display(description="sender")
    def sender_display(self, obj):
        return obj.sender

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "conversation", "sender_coach", "sender_learner"
        )


@admin.register(MessageReceipt)
class MessageReceiptAdmin(admin.ModelAdmin):
    list_display = ("id", "message", "recipient_display", "read_at")
    list_filter = ("read_at",)
    search_fields = (
        "message__body",
        "recipient_coach__name",
        "recipient_coach__email",
        "recipient_learner__full_name",
        "recipient_learner__email",
    )
    raw_id_fields = ("message", "recipient_coach", "recipient_learner")

    @admin.display(description="recipient")
    def recipient_display(self, obj):
        return obj.recipient_coach or obj.recipient_learner

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "message", "recipient_coach", "recipient_learner"
        )
