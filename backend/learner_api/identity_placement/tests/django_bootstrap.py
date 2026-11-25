"""Minimal offline Django setup for direct/discovered capability tests."""

import importlib


def configure():
    from django.conf import settings

    if not settings.configured:
        settings.configure(
            SECRET_KEY="offline-identity-placement-check",
            INSTALLED_APPS=[],
            DATABASES={
                "default": {
                    "ENGINE": "django.db.backends.sqlite3",
                    "NAME": ":memory:",
                },
            },
        )
    from django.apps import AppConfig, apps

    if not apps.ready:
        # Bare application configs register the model labels needed by the
        # relocated parity suites without importing project settings or
        # invoking any AppConfig.ready() hooks.
        app_names = ("learner_api", "curriculum_api", "login")
        apps.populate([
            AppConfig(name, importlib.import_module(name))
            for name in app_names
        ])
