from django.urls import path

from . import documents, extended_ilr, views

urlpatterns = [
    path('health/', views.health, name='enrolment-health'),
    path('commercial-users/<int:pk>/board/', views.commercial_board, name='commercial-board'),
    # Extended ILR questionnaire (kind: apprenticeship | commercial)
    path('extended-ilr/<str:kind>/<int:learner_id>/', extended_ilr.extended_ilr, name='extended-ilr'),
    # Generated compliance documents (Azure-backed)
    path('document-types/', documents.document_types, name='document-types'),
    path('documents/<str:kind>/<int:learner_id>/', documents.documents, name='enrolment-documents'),
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/download/', documents.download_document, name='enrolment-document-download'),
]
