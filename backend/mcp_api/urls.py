from django.urls import path

from . import views

urlpatterns = [
    path('', views.mcp_endpoint, name='mcp-endpoint'),
]
