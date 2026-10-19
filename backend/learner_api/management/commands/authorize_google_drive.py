"""One-time sign-in that lets the media proxy read private course videos.

Sign in as the Google account that owns (or can see) the course videos and
allow read-only Drive access. The refresh token Google returns is written to
``backend/.env`` as KBC_LMS_GOOGLE_DRIVE_REFRESH_TOKEN and never printed;
copy that line into the server's .env and restart the services.

    python manage.py authorize_google_drive
    python manage.py authorize_google_drive --redirect-uri http://localhost:8765/

Needs KBC_LMS_GOOGLE_CLIENT_ID and KBC_LMS_GOOGLE_CLIENT_SECRET in .env, the
Google Drive API enabled in that client's Cloud project, and the redirect URI
allowed for the client (a Desktop client allows localhost already; a Web
client needs it added under Authorised redirect URIs).
"""
import http.server
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from learner_api.google_drive_api import CLIENT_ID_ENV, CLIENT_SECRET_ENV, REFRESH_TOKEN_ENV, SCOPE, TOKEN_URL

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)"


class Command(BaseCommand):
    help = "Sign in once so the media proxy can stream private course videos from Google Drive."

    def add_arguments(self, parser):
        parser.add_argument("--redirect-uri", default="http://localhost:8765/",
                            help="Loopback address Google returns to (default http://localhost:8765/).")
        parser.add_argument("--timeout", type=int, default=600, help="Seconds to wait for the sign-in.")

    def handle(self, *args, **options):
        client_id = os.environ.get(CLIENT_ID_ENV, "").strip()
        client_secret = os.environ.get(CLIENT_SECRET_ENV, "").strip()
        if not client_id or not client_secret:
            raise CommandError(f"Set {CLIENT_ID_ENV} and {CLIENT_SECRET_ENV} in backend/.env first.")
        redirect_uri = options["redirect_uri"]
        parsed = urllib.parse.urlsplit(redirect_uri)
        if parsed.hostname not in {"localhost", "127.0.0.1"} or not parsed.port:
            raise CommandError("--redirect-uri must be a localhost address with a port.")

        state = secrets.token_urlsafe(24)
        url = AUTH_URL + "?" + urllib.parse.urlencode({
            "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
            "scope": SCOPE, "access_type": "offline", "prompt": "consent", "state": state,
        })
        self.stdout.write("Open this link, sign in as the account that owns the course videos, and allow access:\n")
        self.stdout.write(url + "\n")
        self.stdout.flush()

        code = self._wait_for_code(parsed.port, state, options["timeout"])
        tokens = self._post(TOKEN_URL, {
            "code": code, "client_id": client_id, "client_secret": client_secret,
            "redirect_uri": redirect_uri, "grant_type": "authorization_code",
        })
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            raise CommandError("Google returned no refresh token. Remove this app's access from the Google "
                               "account (myaccount.google.com/permissions) and run the command again.")
        about = urllib.request.Request(ABOUT_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"})
        with urllib.request.urlopen(about, timeout=20) as response:
            email = json.loads(response.read().decode("utf-8")).get("user", {}).get("emailAddress", "?")

        env_path = os.path.join(settings.BASE_DIR, ".env")
        self._save(env_path, refresh_token)
        self.stdout.write(self.style.SUCCESS(
            f"Authorised as {email}. Saved {REFRESH_TOKEN_ENV} to {env_path} (value not shown)."))

    def _wait_for_code(self, port, state, timeout):
        result = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))
                if "code" in query or "error" in query:
                    result.update(query)
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"Done. You can close this tab and return to the terminal.")

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", port), Handler)
        deadline = time.monotonic() + timeout
        try:
            # Other requests (a favicon) can arrive first; keep serving until
            # Google's redirect does.
            while not result and time.monotonic() < deadline:
                server.timeout = max(deadline - time.monotonic(), 0.1)
                server.handle_request()
        finally:
            server.server_close()
        if not result:
            raise CommandError("Timed out waiting for the Google sign-in.")
        if result.get("error"):
            raise CommandError(f"Google sign-in failed: {result['error']}")
        if not secrets.compare_digest(result.get("state", ""), state):
            raise CommandError("The sign-in response did not match this request; run the command again.")
        return result["code"]

    def _post(self, url, fields):
        request = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode())
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = json.loads(exc.read().decode("utf-8") or "{}").get("error_description", exc.reason)
            raise CommandError(f"Google refused the sign-in code: {detail}") from exc

    def _save(self, env_path, refresh_token):
        """Replace or append the setting, leaving every other line as it was."""
        with open(env_path, encoding="utf-8", newline="") as handle:
            text = handle.read()
        newline = "\r\n" if "\r\n" in text else "\n"
        line = f"{REFRESH_TOKEN_ENV}={refresh_token}"
        pattern = re.compile(rf"^{REFRESH_TOKEN_ENV}=[^\r\n]*", re.MULTILINE)
        if pattern.search(text):
            text = pattern.sub(lambda _match: line, text, count=1)
        else:
            text = text + ("" if text.endswith(("\n", "\r")) or not text else newline) + line + newline
        with open(env_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
