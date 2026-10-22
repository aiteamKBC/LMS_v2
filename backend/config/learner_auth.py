"""Opt-in connection configuration only; never routes existing auth models.

LEARNER_AUTH_READS_ENABLED defaults off. LEARNER_AUTH_DB_{HOST,NAME,USER,
PASSWORD} must all be provided to register the dedicated connection; PORT is
5432 and SSLMODE is verify-full unless explicitly configured. No fallback to
DATABASE_URL or enrolment credentials. Reader transactions enforce READ ONLY;
the adapter additionally rejects owners, privileged roles and write grants.
"""
ALIAS = "learner_auth_read"


def configure_learner_auth(environ):
    enabled = environ.get("LEARNER_AUTH_READS_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
    keys = ("HOST", "NAME", "USER", "PASSWORD")
    values = {key: environ.get("LEARNER_AUTH_DB_" + key, "") for key in keys}
    if not any(values.values()) and not enabled:
        return False, {}
    if not all(values.values()):
        raise ValueError("Learner-auth requires a separately configured complete reader connection")
    port = int(environ.get("LEARNER_AUTH_DB_PORT", "5432"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid Learner-auth database port")
    sslmode = environ.get("LEARNER_AUTH_DB_SSLMODE", "verify-full")
    if sslmode not in {"disable", "require", "verify-ca", "verify-full"}:
        raise ValueError("Invalid Learner-auth SSL mode")
    return enabled, {ALIAS: {
        "ENGINE": "django.db.backends.postgresql", **values, "PORT": str(port),
        "CONN_MAX_AGE": 0, "CONN_HEALTH_CHECKS": True, "ATOMIC_REQUESTS": False,
        "OPTIONS": {"sslmode": sslmode, "connect_timeout": 5},
        # No startup options: pooled endpoints may refuse them. The adapter sets
        # transaction read-only/isolation explicitly before its first SELECT.
    }}
