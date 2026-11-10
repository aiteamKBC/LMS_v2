from django.urls import path

from . import views

# No trailing slashes: these are the exact URLs advertised in the metadata, and
# APPEND_SLASH would turn a POST to the slashless form into a redirect.
urlpatterns = [
    path('register', views.oauth_register, name='mcp-oauth-register'),
    path('authorize', views.oauth_authorize, name='mcp-oauth-authorize'),
    path('token', views.oauth_token, name='mcp-oauth-token'),
    path('revoke', views.oauth_revoke, name='mcp-oauth-revoke'),
]
