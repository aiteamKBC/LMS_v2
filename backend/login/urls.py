"""URLs for the login app, mounted at /login_api/ (see config/urls.py)."""
from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="login-health"),

    # --- session ---
    path("login/", views.login, name="login"),
    path("logout/", views.logout, name="logout"),
    path("me/", views.me, name="login-me"),

    # --- password management ---
    path("change-password/", views.change_password, name="login-change-password"),
    path("forgot-password/", views.forgot_password, name="login-forgot-password"),
    path("reset/", views.reset_info, name="login-reset-info"),
    path("reset-password/", views.reset_password, name="login-reset-password"),

    # --- invitations ---
    path("invitation/", views.invitation_info, name="login-invitation-info"),
    path("accept-invitation/", views.accept_invitation_view, name="login-accept-invitation"),
    path("accounts/invite/", views.invite_account, name="login-invite-account"),
]
