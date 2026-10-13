"""Hermetic SQLite-only test configuration; never imports production settings."""
from django.apps import AppConfig
class LearnerTestConfig(AppConfig):
    name="learner_api"
class LoginTestConfig(AppConfig):
    name="login"
SECRET_KEY="synthetic-mobile-comms-test-only"
INSTALLED_APPS=["django.contrib.auth","django.contrib.contenttypes",
               "mobile_comms.test_settings.LearnerTestConfig",
               "mobile_comms.test_settings.LoginTestConfig","mobile_comms"]
DATABASES={"default":{"ENGINE":"django.db.backends.sqlite3","NAME":":memory:"}}
DATABASE_ROUTERS=[]
USE_TZ=True
TIME_ZONE="Europe/London"
DEFAULT_AUTO_FIELD="django.db.models.BigAutoField"
MIDDLEWARE=[]
ROOT_URLCONF="mobile_comms.urls"
KBC_MOBILE_COMMS_ENABLED=True
ALLOWED_HOSTS=["testserver"]
MIGRATION_MODULES={"learner_api":None,"login":None}
PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"]

