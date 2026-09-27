"""Knowledge Base settings, read with safe defaults.

The defaults are the development posture: fake AI providers, local storage and
paid calls refused. A real provider needs BOTH ``KNOWLEDGE_BASE_PROVIDERS=openai``
and ``KNOWLEDGE_BASE_ALLOW_PAID=true`` -- one flag alone never spends money.
"""
from django.conf import settings


def _flag(name, default=False):
    value = getattr(settings, name, None)
    if value is None:
        import os
        value = os.environ.get(name, "")
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"} if value != "" else default


def _text(name, default):
    import os
    return str(getattr(settings, name, None) or os.environ.get(name) or default).strip().lower()


def providers():
    return _text("KNOWLEDGE_BASE_PROVIDERS", "fake")


def storage_mode():
    return _text("KNOWLEDGE_BASE_STORAGE", "local")


def paid_calls_allowed():
    return providers() == "openai" and _flag("KNOWLEDGE_BASE_ALLOW_PAID")
