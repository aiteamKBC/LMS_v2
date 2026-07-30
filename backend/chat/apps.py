from django.apps import AppConfig


class ChatConfig(AppConfig):
    """Application configuration for the private chat domain."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "chat"
