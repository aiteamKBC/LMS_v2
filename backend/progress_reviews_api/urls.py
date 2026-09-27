from django.urls import path

from . import views

urlpatterns = [
    path('learners/active/', views.active_learners, name='progress-review-active-learners'),
    path('bulk-generate/', views.bulk_generate, name='progress-review-bulk-generate'),
    path('<int:learner_id>/periods/', views.periods, name='progress-review-periods'),
    path('<int:learner_id>/pack/', views.pack, name='progress-review-pack'),
    path('<int:learner_id>/runs/latest/', views.latest_run, name='progress-review-latest-run'),
    path('<int:learner_id>/generate/', views.generate, name='progress-review-generate'),
    path('<int:learner_id>/upload/', views.upload_own, name='progress-review-upload-own'),
    path('<int:learner_id>/mcm/pack/', views.mcm_pack, name='mcm-pack'),
    path('<int:learner_id>/mcm/runs/latest/', views.mcm_latest_run, name='mcm-latest-run'),
    path('<int:learner_id>/mcm/generate/', views.mcm_generate, name='mcm-generate'),
    path('<int:learner_id>/mcm/upload/', views.mcm_upload_own, name='mcm-upload-own'),
    path('<str:review_id>/preview/', views.preview, name='progress-review-preview'),
    path('<str:review_id>/edit/', views.edit, name='progress-review-edit'),
    path('<str:review_id>/edit/images/', views.edit_image, name='progress-review-edit-image'),
    path('<str:review_id>/edit/upload/', views.upload_revision, name='progress-review-upload-revision'),
    path('<str:review_id>/download/', views.download, name='progress-review-download'),
]
