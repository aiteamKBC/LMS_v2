from django.urls import path
from . import views

# Mounted under /audit_api/. Flat URL patterns preserve the existing clone
# mount; transition views explicitly refuse clone requests.
urlpatterns = [
    path('old-otjh/monitor/', views.monitor_dashboard, name='old-otjh-monitor'),
    path('old-otjh/csrf/', views.csrf, name='old-otjh-csrf'),
    path('old-otjh/me/summary/', views.summary, name='old-otjh-summary'),
    path('old-otjh/start/', views.start, name='old-otjh-start'),
    path('old-otjh/coach/learners/', views.coach_learners, name='old-otjh-coach-learners'),
    path('old-otjh/refresh-months/', views.refresh_months, name='old-otjh-refresh-months'),
    path('old-otjh/content-check/', views.content_review, name='old-otjh-content-check'),
    path('old-otjh/sign-months/', views.bulk_signoff, name='old-otjh-sign-months'),
    path('old-otjh/material-documents/<int:row_id>/<int:material_id>/', views.material_document, name='old-otjh-material-document'),
    path('old-otjh/source-documents/<int:row_id>/<int:evidence_id>/<str:kind>/', views.source_document, name='old-otjh-source-document'),
    path('old-otjh/documents/<int:doc_id>/', views.document, name='old-otjh-document'),
    path('old-otjh/signatures/<str:file_id>/', views.signature_file, name='old-otjh-signature-file'),
    path('last-audit/manual/finalization', views.finalization, name='old-otjh-finalization'),
]
