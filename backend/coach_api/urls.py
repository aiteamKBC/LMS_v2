from django.urls import path

from .views import coach_caseload


urlpatterns = [
    path('coach/caseload', coach_caseload, name='coach-caseload'),
]
