"""Transactional email via Microsoft Graph (Azure AD application permissions).

Used for the two mails this feature sends: the platform invitation and the
password reset. Both are security-sensitive, so the transport is explicit about
failure — a mail that did not send is recorded on the token row
(``Send_error``) rather than being swallowed.

Why Graph and not SMTP
----------------------
The tenant is already Microsoft 365 and the project already talks to Graph
(``learner_api/calendar_connections.py``). Graph with an app-only token needs no
mailbox password and can be scoped to a single sender via an application access
policy, which SMTP AUTH cannot.

Configuration
-------------
Set in ``backend/.env``. See ``AZURE_SETUP.md`` for how to obtain them.

    AZURE_MAIL_TENANT_ID       # directory (tenant) id of the app registration
    AZURE_MAIL_CLIENT_ID       # application (client) id
    AZURE_MAIL_CLIENT_SECRET   # client secret VALUE (not the secret id)
    AZURE_MAIL_SENDER          # the mailbox to send as, e.g. noreply@…
    AZURE_MAIL_ENABLED         # "false" to force console fallback

This deployment registered its mail app under different names, so each setting
also accepts the ``AZURE_LOGIN_APP_*`` / ``AZURE_EMAIL`` spelling actually
present in ``.env`` (app ``LMS_Email_login_and_Invitations``):

    AZURE_LOGIN_APP_TENANT_ID      -> AZURE_MAIL_TENANT_ID
    AZURE_LOGIN_APP_CLIENT_ID      -> AZURE_MAIL_CLIENT_ID
    AZURE_LOGIN_APP_CLIENT_SECRET  -> AZURE_MAIL_CLIENT_SECRET
    AZURE_EMAIL                    -> AZURE_MAIL_SENDER

The app registration needs the **application** permission ``Mail.Send``
(not delegated), with admin consent granted. Confirm with a client-credentials
token: its ``roles`` claim must contain ``Mail.Send``. An app registered only for
interactive sign-in (one with a redirect URI) will not have it by default, and
the failure surfaces as a Graph 403 at send time rather than at startup.

There is deliberately **no** fallback to the tenant-wide ``MICROSOFT_*``
credentials. Those belong to the calendar app, which has no ``Mail.Send``; with a
sender configured, falling back to them would flip ``is_configured()`` to True
and turn an honest "not configured" into an opaque 403 on every send.

Falls back to logging when it is not configured, so the whole invitation and
reset flow is exercisable end-to-end before Azure exists. The full link — which
contains a live single-use token — is printed only when ``DEBUG`` is on; with
DEBUG off the fallback logs that a send was skipped and no token. Either way
``send_mail`` reports ``configured=False`` so callers can tell the difference
between "sent" and "printed to a console".
"""
from __future__ import annotations

import logging
import os
import threading
import time

import httpx

logger = logging.getLogger("login.email")

GRAPH_BASE = os.environ.get("MICROSOFT_GRAPH_BASE_URL", "https://graph.microsoft.com/v1.0")
_TOKEN_ENDPOINT = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
_SCOPE = "https://graph.microsoft.com/.default"

_HTTP_TIMEOUT = 15.0

# Cached app-only token. Tokens last ~1 hour; re-fetching per email would add a
# round-trip and risk throttling. Guarded by a lock because Daphne serves
# requests from several threads.
_token_lock = threading.Lock()
_token_cache = {"value": None, "expires_at": 0.0}
#: Refresh this many seconds before actual expiry.
_TOKEN_SKEW = 120


class EmailNotConfigured(RuntimeError):
    """Raised internally when Graph credentials are absent."""


class EmailSendError(RuntimeError):
    """Raised when Graph rejected the send."""


def _setting(name, default=""):
    return (os.environ.get(name) or default).strip()


#: Each mail setting and the env names it accepts, most-preferred first. The
#: ``AZURE_LOGIN_APP_*`` / ``AZURE_EMAIL`` spellings are what this deployment's
#: .env actually uses; the ``AZURE_MAIL_*`` names stay primary because they are
#: what AZURE_SETUP.md documents and what a fresh deployment would copy.
#:
#: Note what is absent: ``MICROSOFT_*``. See the module docstring — reusing the
#: calendar app's credentials here produces a confident 403, not a working send.
_SETTING_SOURCES = {
    "tenant_id": ("AZURE_MAIL_TENANT_ID", "AZURE_LOGIN_APP_TENANT_ID"),
    "client_id": ("AZURE_MAIL_CLIENT_ID", "AZURE_LOGIN_APP_CLIENT_ID"),
    "client_secret": ("AZURE_MAIL_CLIENT_SECRET", "AZURE_LOGIN_APP_CLIENT_SECRET"),
    "sender": ("AZURE_MAIL_SENDER", "AZURE_EMAIL"),
}


def _first_set(names):
    """First non-empty value among ``names``, else ""."""
    for name in names:
        value = _setting(name)
        if value:
            return value
    return ""


def mail_config():
    """Current mail settings, resolved across the accepted env spellings."""
    config = {key: _first_set(names) for key, names in _SETTING_SOURCES.items()}
    config["enabled"] = (
        _setting("AZURE_MAIL_ENABLED", "true").lower() not in {"0", "false", "no", "off"}
    )
    return config


def is_configured():
    """Whether a real send can be attempted right now."""
    cfg = mail_config()
    return bool(
        cfg["enabled"]
        and cfg["tenant_id"]
        and cfg["client_id"]
        and cfg["client_secret"]
        and cfg["sender"]
    )


def missing_settings():
    """Which required settings are absent — surfaced by the health endpoint.

    Names both accepted spellings, so an operator reading the system-status page
    can set either without having to consult the source to learn the other
    exists. Values are never included: this list is published by an endpoint.
    """
    cfg = mail_config()
    return [
        " or ".join(names)
        for key, names in _SETTING_SOURCES.items()
        if not cfg[key]
    ]


def _access_token(force_refresh=False):
    """Client-credentials token for Graph, cached until shortly before expiry."""
    cfg = mail_config()
    if not is_configured():
        raise EmailNotConfigured("Azure mail is not configured.")

    with _token_lock:
        now = time.time()
        if not force_refresh and _token_cache["value"] and _token_cache["expires_at"] > now:
            return _token_cache["value"]

        response = httpx.post(
            _TOKEN_ENDPOINT.format(tenant=cfg["tenant_id"]),
            data={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "scope": _SCOPE,
                "grant_type": "client_credentials",
            },
            timeout=_HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            # The body carries AADSTS codes that make misconfiguration
            # diagnosable (wrong secret, wrong tenant, consent not granted).
            raise EmailSendError(
                f"Azure token request failed ({response.status_code}): {response.text[:400]}"
            )

        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise EmailSendError("Azure token response contained no access_token.")

        _token_cache["value"] = token
        _token_cache["expires_at"] = now + max(
            int(payload.get("expires_in", 3600)) - _TOKEN_SKEW, 60
        )
        return token


def send_mail(*, to, subject, html_body, text_body=None):
    """Send one message. Returns ``(sent, detail)``.

    ``sent`` is True only when Graph accepted it. When Azure is not configured
    this returns ``(False, "not-configured: …")`` after logging the message —
    the caller records that on the token row and, importantly, still reports
    success to the end user, because whether our mail transport is set up is not
    something an anonymous caller should be able to probe.
    """
    if not is_configured():
        missing = ", ".join(missing_settings()) or "AZURE_MAIL_ENABLED=false"

        # The body carries a live single-use invitation/reset token. Print it
        # only when DEBUG is on, where the developer needs the link to walk
        # through the flow and the log is their own console. With DEBUG off,
        # log that a send was skipped and nothing more: aggregated production
        # logs are read by more people than should be able to seize an account.
        from django.conf import settings

        if settings.DEBUG:
            logger.warning(
                "Azure mail not configured (%s). Message NOT sent.\n"
                "  To:      %s\n  Subject: %s\n  Body:\n%s",
                missing, to, subject, text_body or html_body,
            )
        else:
            logger.error(
                "Azure mail not configured (%s). Message to %s NOT sent "
                "(subject: %s). See backend/AZURE_SETUP.md.",
                missing, to, subject,
            )
        return False, f"not-configured: {missing}"

    cfg = mail_config()
    try:
        token = _access_token()
        response = httpx.post(
            f"{GRAPH_BASE}/users/{cfg['sender']}/sendMail",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "message": {
                    "subject": subject,
                    "body": {"contentType": "HTML", "content": html_body},
                    "toRecipients": [{"emailAddress": {"address": to}}],
                },
                # These are security notifications; keeping them out of Sent
                # Items avoids a shared mailbox filling with reset mail.
                "saveToSentItems": False,
            },
            timeout=_HTTP_TIMEOUT,
        )
    except EmailNotConfigured as exc:
        return False, str(exc)
    except (EmailSendError, httpx.HTTPError) as exc:
        logger.error("Azure mail send failed for %s: %s", to, exc)
        return False, str(exc)[:500]

    # 202 Accepted is the documented success for sendMail.
    if response.status_code in (200, 202):
        logger.info("Invitation/reset mail sent to %s", to)
        return True, None

    detail = f"graph {response.status_code}: {response.text[:400]}"
    logger.error("Azure mail send failed for %s: %s", to, detail)
    return False, detail


# ---------------------------------------------------------------------------
# Message templates
# ---------------------------------------------------------------------------
# Plain inline-styled HTML on purpose: mail clients strip <style> blocks and do
# not load external CSS, so a stylesheet would render as unstyled text.

_BRAND = "Kent Business College"


def _shell(heading, intro, button_label, link, footer):
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2933;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e4e7eb;">
      <tr>
        <td style="background:#0b3d6b;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:600;">{_BRAND}</td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0b3d6b;">{heading}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">{intro}</p>
          <p style="margin:0 0 24px;">
            <a href="{link}" style="display:inline-block;background:#0b3d6b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;font-weight:600;">{button_label}</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#616e7c;">If the button does not work, copy this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:#0b3d6b;">{link}</p>
          <p style="margin:0;font-size:13px;color:#616e7c;line-height:1.5;">{footer}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px;background:#f9fafb;font-size:12px;color:#9aa5b1;border-top:1px solid #e4e7eb;">
          This is an automated message from the {_BRAND} learning platform. Please do not reply.
        </td>
      </tr>
    </table>
  </body>
</html>"""


def invitation_message(*, display_name, link, expires_days):
    greeting = f"Hello {display_name}," if display_name else "Hello,"
    subject = f"Your {_BRAND} account — set your password"
    html = _shell(
        heading="Welcome to the platform",
        intro=(
            f"{greeting}<br><br>An account has been created for you on the "
            f"{_BRAND} learning platform. Choose a password to activate it and sign in."
        ),
        button_label="Set your password",
        link=link,
        footer=(
            f"This link can be used once and expires in {expires_days} days. "
            "If you were not expecting this email, you can ignore it — no account "
            "is active until a password is set."
        ),
    )
    text = (
        f"{greeting}\n\nAn account has been created for you on the {_BRAND} "
        f"learning platform.\n\nSet your password:\n{link}\n\n"
        f"This link can be used once and expires in {expires_days} days.\n"
    )
    return subject, html, text


def reset_message(*, display_name, link, expires_hours):
    greeting = f"Hello {display_name}," if display_name else "Hello,"
    subject = f"Reset your {_BRAND} password"
    html = _shell(
        heading="Reset your password",
        intro=(
            f"{greeting}<br><br>We received a request to reset the password for "
            "this account. Use the button below to choose a new one."
        ),
        button_label="Reset password",
        link=link,
        footer=(
            f"This link can be used once and expires in {expires_hours} hour(s). "
            "If you did not request a reset, you can ignore this email — your "
            "current password remains unchanged."
        ),
    )
    text = (
        f"{greeting}\n\nWe received a request to reset your password.\n\n"
        f"Reset it here:\n{link}\n\n"
        f"This link can be used once and expires in {expires_hours} hour(s).\n"
        "If you did not request this, ignore this email.\n"
    )
    return subject, html, text


def access_request_message(*, requester_name, requester_email, console_url):
    """Mail an administrator that somebody is waiting for an access grant.

    Sent by the person themselves from the /access-required page, so the body
    carries only what the administrator needs to act: who is asking, and a link
    to the Accounts screen where the grant is made. No token, nothing secret —
    unlike the invitation and reset mails, this one is safe in a shared inbox.
    """
    who = requester_name or requester_email
    subject = f"Access request — {who}"
    html = _shell(
        heading="Someone is waiting for access",
        intro=(
            f"<strong>{who}</strong> ({requester_email}) has signed in to the "
            f"{_BRAND} platform but has no access level yet, so there is nothing "
            "they can open. Grant them one from the Accounts screen."
        ),
        button_label="Open Accounts",
        link=console_url,
        footer=(
            "Click their name on that screen to choose an access level. They will "
            "be able to use the platform on their next request — they do not need "
            "to sign in again."
        ),
    )
    text = (
        f"{who} ({requester_email}) has signed in but has no access level yet.\n\n"
        f"Grant one here:\n{console_url}\n"
    )
    return subject, html, text
