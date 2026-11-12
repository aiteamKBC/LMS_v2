from django.urls import path

from . import views, company_training

urlpatterns = [
    path("breathe/connections/<uuid:connection_id>/training", company_training.training),
    path("breathe/connections/<uuid:connection_id>/training/rules", company_training.save_rule),
    path("breathe/csrf", views.csrf_token, name="breathe-csrf"),
    path("breathe/connections", views.connections, name="breathe-connections"),
    path("breathe/connections/create", views.create_connection, name="breathe-create-connection"),
    path("breathe/tenants/<uuid:tenant_id>/signatory-grants", views.signatory_grants, name="breathe-signatory-grants"),
    path("breathe/tenants/<uuid:tenant_id>/signatory-grants/create", views.create_signatory_grant, name="breathe-create-signatory-grant"),
    path("breathe/connections/<uuid:connection_id>/sync", views.trigger_sync, name="breathe-trigger-sync"),
    path("breathe/connections/<uuid:connection_id>/status", views.connection_status, name="breathe-connection-status"),
    path("breathe/connections/<uuid:connection_id>/runs", views.sync_runs, name="breathe-sync-runs"),
    path("breathe/connections/<uuid:connection_id>/conflicts", views.scheduling_conflicts, name="breathe-scheduling-conflicts"),
    path("breathe/connections/<uuid:connection_id>/preview", views.preview, name="breathe-preview"),
    path("breathe/connections/<uuid:connection_id>/validate", views.validate_connection, name="breathe-validate"),
    path("breathe/connections/<uuid:connection_id>/approve-match", views.approve_match, name="breathe-approve-match"),
]
