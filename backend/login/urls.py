"""URLs for the login app, mounted at /login_api/ (see config/urls.py)."""
from django.urls import path

from . import access_requests, microsoft_sso, platform_admin, views

urlpatterns = [
    path("health/", views.health, name="login-health"),

    # --- session ---
    path("login/", views.login, name="login"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="login-me"),

    # --- sign in with Microsoft (see microsoft_sso.py) ---
    path("microsoft/start/", microsoft_sso.start, name="login-microsoft-start"),
    path("microsoft/callback/", microsoft_sso.callback, name="login-microsoft-callback"),

    # --- password management ---
    path("change-password/", views.change_password, name="login-change-password"),
    path("forgot-password/", views.forgot_password, name="login-forgot-password"),
    path("reset/", views.reset_info, name="login-reset-info"),
    path("reset-password/", views.reset_password, name="login-reset-password"),

    # --- invitations ---
    path("invitation/", views.invitation_info, name="login-invitation-info"),
    path("accept-invitation/", views.accept_invitation_view, name="login-accept-invitation"),
    path("accounts/invite/", views.invite_account, name="login-invite-account"),

    # --- a signed-in account with no access grant asking for one ---
    path("request-access/", access_requests.request_access, name="login-request-access"),

    # --- super admin console (admin role only, see platform_admin.py) ---
    path("admin/overview/", platform_admin.overview, name="admin-overview"),
    path("admin/accounts/", platform_admin.accounts, name="admin-accounts"),
    path("admin/accounts/<int:pk>/", platform_admin.account_action, name="admin-account-action"),
    path("admin/audit/", platform_admin.audit, name="admin-audit"),
    path("admin/roles/", platform_admin.roles, name="admin-roles"),
    path("admin/email-log/", platform_admin.email_log, name="admin-email-log"),
    path("admin/system/", platform_admin.system, name="admin-system"),
    path("admin/documents/", platform_admin.documents, name="admin-documents"),
    path("admin/curriculum/", platform_admin.curriculum, name="admin-curriculum"),
]
