"""The audit API mounted a second time, against the cloned database.

``/hours_test_api/<path>`` serves exactly the same views as
``/audit_api/<path>`` — same code, same request/response contract — but every
query inside them resolves to the ``audit_clone`` connection (see
``db_source.py``). The HOURS-TEST workspace can therefore edit hours freely
without any of it reaching the live audit data.

The pattern list is derived from ``urls.py`` rather than copied, so a route
added there is automatically available to HOURS-TEST too.
"""

from django.urls import path

from .actual_hours import views as actual_hours_views
from .db_source import clone_view
from .urls import urlpatterns as live_urlpatterns


urlpatterns = [
    path(
        str(entry.pattern),
        clone_view(entry.callback),
        entry.default_args,
        name=f"hours-test-{entry.name}" if entry.name else None,
    )
    for entry in live_urlpatterns
]

# Clone-only routes. These are appended AFTER the derived list on purpose: the
# Actual Hours review writes proposals, findings and (on approval) actual_hours,
# so it must never be reachable from the live /audit_api mount. Adding any of
# them to urls.py would invert that guarantee — the views also assert
# db_source.is_clone() as a second line of defence.
urlpatterns += [
    path("last-audit/actual-hours/summary", clone_view(actual_hours_views.summary),
         name="hours-test-actual-hours-summary"),
    path("last-audit/actual-hours/validate", clone_view(actual_hours_views.validate),
         name="hours-test-actual-hours-validate"),
    path("last-audit/actual-hours/propose", clone_view(actual_hours_views.propose),
         name="hours-test-actual-hours-propose"),
    path("last-audit/actual-hours/approve", clone_view(actual_hours_views.approve),
         name="hours-test-actual-hours-approve"),
    path("last-audit/actual-hours/reject", clone_view(actual_hours_views.reject),
         name="hours-test-actual-hours-reject"),
    path("last-audit/actual-hours/analytics", clone_view(actual_hours_views.analytics),
         name="hours-test-actual-hours-analytics"),
    # Learner Journal Activity-log rows (the monthly report's own Actual column).
    path("last-audit/journal-hours/summary", clone_view(actual_hours_views.journal_summary),
         name="hours-test-journal-hours-summary"),
    path("last-audit/journal-hours/calculate", clone_view(actual_hours_views.journal_calculate),
         name="hours-test-journal-hours-calculate"),
    path("last-audit/journal-hours/approve", clone_view(actual_hours_views.journal_approve),
         name="hours-test-journal-hours-approve"),
    path("last-audit/journal-hours/reject", clone_view(actual_hours_views.journal_reject),
         name="hours-test-journal-hours-reject"),
]
