from django.urls import path

from . import admin_views, views

# No trailing slashes: these are the exact URLs advertised in the metadata, and
# APPEND_SLASH would turn a POST to the slashless form into a redirect.
urlpatterns = [
    path('register', views.oauth_register, name='mcp-oauth-register'),
    path('authorize', views.oauth_authorize, name='mcp-oauth-authorize'),
    path('token', views.oauth_token, name='mcp-oauth-token'),
    path('revoke', views.oauth_revoke, name='mcp-oauth-revoke'),
    # Super-admin connection controls (Step 11.2). Session cookie + CSRF, not bearer tokens.
    path('admin/tokens', admin_views.admin_tokens, name='mcp-admin-tokens'),
    path('admin/revoke', admin_views.admin_revoke, name='mcp-admin-revoke'),
    path('admin/clients/<str:client_id>/disable', admin_views.admin_disable_client, name='mcp-admin-disable-client'),
]
