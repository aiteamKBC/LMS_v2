from django.urls import path

from . import views

urlpatterns = [
    path('learners/active/', views.active_learners, name='progress-review-active-learners'),
    path('bulk-generate/', views.bulk_generate, name='progress-review-bulk-generate'),
    path('<int:learner_id>/periods/', views.periods, name='progress-review-periods'),
    path('<int:learner_id>/pack/', views.pack, name='progress-review-pack'),
    path('<int:learner_id>/runs/latest/', views.latest_run, name='progress-review-latest-run'),
    path('<int:learner_id>/generate/', views.generate, name='progress-review-generate'),
    path('<str:review_id>/download/', views.download, name='progress-review-download'),
]
