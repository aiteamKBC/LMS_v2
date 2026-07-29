"""Minimal settings used to run isolated chat tests locally and in CI."""

from .settings import *  # noqa: F401,F403

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "channels",
    "rest_framework",
    "chat",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "test-chat.sqlite3",
    }
}

DATABASE_ROUTERS = []
ROOT_URLCONF = "config.test_urls"
CHAT_TEST_MODE = True
MIGRATION_MODULES = {"chat": None}
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}
