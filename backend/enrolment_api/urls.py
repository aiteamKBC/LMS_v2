from django.urls import path

from . import cv_job_documents, documents, extended_ilr, ilr_eligibility_evidence, ilr_employer_details, ilr_learner_record, plr_evidence, policy_documents, views, wizard_bootstrap

urlpatterns = [
    path('health/', views.health, name='enrolment-health'),
    path('commercial-users/<int:pk>/board/', views.commercial_board, name='commercial-board'),
    # Extended ILR questionnaire (kind: apprenticeship | commercial)
    path('extended-ilr/<str:kind>/<int:learner_id>/', extended_ilr.extended_ilr, name='extended-ilr'),
    # Eligibility proof of identification/residency (Azure-backed, path on the ILR row)
    path('extended-ilr/<str:kind>/<int:learner_id>/eligibility-evidence/', ilr_eligibility_evidence.eligibility_evidence, name='extended-ilr-eligibility-evidence'),
    path('extended-ilr/<str:kind>/<int:learner_id>/eligibility-evidence/<uuid:file_id>/', ilr_eligibility_evidence.delete_eligibility_evidence, name='extended-ilr-eligibility-evidence-delete'),
    path('extended-ilr/<str:kind>/<int:learner_id>/eligibility-evidence/<uuid:file_id>/download/', ilr_eligibility_evidence.download_eligibility_evidence, name='extended-ilr-eligibility-evidence-download'),
    # CV/Job Description step: CV, transcript and GCSE evidence (Azure-backed, path on the Wizard_Cv_Job row)
    path('wizard/<str:kind>/<int:learner_id>/cv-documents/', cv_job_documents.cv_documents, name='wizard-cv-documents'),
    path('wizard/<str:kind>/<int:learner_id>/cv-documents/<uuid:file_id>/', cv_job_documents.delete_cv_document, name='wizard-cv-document-delete'),
    path('wizard/<str:kind>/<int:learner_id>/cv-documents/<uuid:file_id>/download/', cv_job_documents.download_cv_document, name='wizard-cv-document-download'),
    # PLR entries' certificate/evidence files (Azure-backed, path on the Wizard_Plr_Records row)
    path('wizard/<str:kind>/<int:learner_id>/plr-evidence/', plr_evidence.plr_evidence, name='wizard-plr-evidence'),
    path('wizard/<str:kind>/<int:learner_id>/plr-evidence/<uuid:file_id>/', plr_evidence.delete_plr_evidence, name='wizard-plr-evidence-delete'),
    path('wizard/<str:kind>/<int:learner_id>/plr-evidence/<uuid:file_id>/download/', plr_evidence.download_plr_evidence, name='wizard-plr-evidence-download'),
    # Employer Details prefill from the learner's employer and organisation (read-only)
    path('extended-ilr/<str:kind>/<int:learner_id>/employer-details/', ilr_employer_details.ilr_employer_details, name='extended-ilr-employer-details'),
    path('ilr-learner-record/<str:kind>/<int:learner_id>/', ilr_learner_record.ilr_learner_record, name='ilr-learner-record'),
    # Board + ILR together — one round-trip to open the wizard.
    path('wizard-bootstrap/<str:kind>/<int:learner_id>/', wizard_bootstrap.wizard_bootstrap, name='wizard-bootstrap'),
    # Generated compliance documents (Azure-backed)
    path('document-types/', documents.document_types, name='document-types'),
    path('policy-documents/<slug:doc_id>/', policy_documents.open_policy_document, name='policy-document-open'),
    path('documents/<str:kind>/<int:learner_id>/', documents.documents, name='enrolment-documents'),
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/download/', documents.download_document, name='enrolment-document-download'),
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/sign/', documents.sign_document, name='enrolment-document-sign'),
    # Replaces the stored PDF in place, so a document rebuilt with a new
    # signature keeps its id and the signatures already recorded on it.
    path('documents/<str:kind>/<int:learner_id>/<uuid:doc_id>/file/', documents.replace_document_file, name='enrolment-document-file'),
]
