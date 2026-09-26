from django.urls import path

from . import views

urlpatterns = [
    path("scopes/", views.scopes, name="knowledge-base-scopes"),
    path("books/", views.books, name="knowledge-base-books"),
    path("books/<uuid:book_id>/", views.book_detail, name="knowledge-base-book-detail"),
    path("builds/<uuid:build_id>/retry/", views.retry_build, name="knowledge-base-build-retry"),
    path("builds/<uuid:build_id>/accept/", views.accept_build, name="knowledge-base-build-accept"),
    path("worker/status/", views.worker_status, name="knowledge-base-worker-status"),
]
