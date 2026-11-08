from django.urls import path
from .qr_attendance import attendance

urlpatterns = [path('', attendance, name='qr-attendance')]
