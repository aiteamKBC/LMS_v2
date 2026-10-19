"""Offline Knowledge Base regression settings; never imports config/.env."""
SECRET_KEY = "knowledge-base-offline-tests-only"
INSTALLED_APPS = [
    "django.contrib.contenttypes", "django.contrib.auth", "login", "enrolment_api",
    "learner_api", "quiz_api", "knowledge_base", "system_audit",
]
DATABASES = {name: {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
             for name in ("default", "enrolment")}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
MEDIA_ROOT = "unused-offline-test-media"
ROOT_URLCONF = "knowledge_base.urls"
KNOWLEDGE_BASE_STORAGE = "local"
KNOWLEDGE_BASE_PROVIDERS = "fake"
KNOWLEDGE_BASE_ALLOW_PAID = False
KNOWLEDGE_BASE_AZURE_CONTAINER = ""
AZURE_STORAGE_ACCOUNT = ""
AZURE_STORAGE_KEY = ""
OPENAI_API_KEY = "offline-test-key"
OPENAI_MODEL = "offline-test-model"
TEST_RUNNER = "django.test.runner.DiscoverRunner"
