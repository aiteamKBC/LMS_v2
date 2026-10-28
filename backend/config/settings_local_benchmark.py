"""Django settings for the disposable localhost Learner HTTP benchmark."""
from .local_benchmark import (
    assert_local_benchmark_databases,
    bootstrap_local_benchmark_environment,
)


_LOCAL_BENCHMARK_URL = bootstrap_local_benchmark_environment()

# The bootstrap above runs before the normal settings module can read `.env`.
from .settings import *  # noqa: E402,F403


RUN_LOCAL_BENCHMARK = True
DEBUG = False
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
CSRF_COOKIE_SECURE = False
SESSION_COOKIE_SECURE = False
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
DB_POOL = False

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "lms-local-http-benchmark",
    }
}
CHANNEL_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
}

for _alias, _config in DATABASES.items():
    _config["CONN_MAX_AGE"] = 0
    _config["CONN_HEALTH_CHECKS"] = True
    _config.setdefault("OPTIONS", {}).pop("pool", None)

assert_local_benchmark_databases(DATABASES, _LOCAL_BENCHMARK_URL)
