from django.urls import path

from . import documents, extended_ilr, views, wizard_bootstrap

urlpatterns = [
    path('health/', views.health, name='enrolment-health'),
    path('commercial-users/<int:pk>/board/', views.commercial_board, name='commercial-board'),
    # Extended ILR questionnaire (kind: apprenticeship | commercial)
    path('extended-ilr/<str:kind>/<int:learner_id>/', extended_ilr.extended_ilr, name='extended-ilr'),
    # Board + ILR together — one round-trip to open the wizard.
    path('wizard-bootstrap/<str:kind>/<int:learner_id>/', wizard_bootstrap.wizard_bootstrap, name='wizard-bootstrap'),
    # Generated compliance documents (Azure-backed)
    path('document-types/', documents.document_types, name='document-types'),
    path('documents/<str:kind>/<int:learner_id>/', documents.documents, name='enrolment-documents'),
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/download/', documents.download_document, name='enrolment-document-download'),
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/sign/', documents.sign_document, name='enrolment-document-sign'),
    # Replaces the stored PDF in place, so a document rebuilt with a new
    # signature keeps its id and the signatures already recorded on it.
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/file/', documents.replace_document_file, name='enrolment-document-file'),
]
