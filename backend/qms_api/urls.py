from django.urls import path

from . import views


urlpatterns = [
    path("deep-dive/records/", views.deep_dive_records, name="deep-dive-records"),
    path("deep-dive/records/summary/", views.deep_dive_record_summaries, name="deep-dive-record-summaries"),
    path("deep-dive/import/", views.deep_dive_import, name="deep-dive-import"),
    path("deep-dive/sync/", views.deep_dive_sync, name="deep-dive-sync"),
    path("deep-dive/records/<uuid:record_id>/", views.deep_dive_record_detail, name="deep-dive-record-detail"),
    path("deep-dive/records/<uuid:record_id>/ilr/", views.deep_dive_ilr_contact, name="deep-dive-ilr-contact"),
]

