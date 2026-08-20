# Sign in with Microsoft — setup

The "Sign in with Microsoft" button on the login page. A person authenticates
with their work account, and the platform then looks that address up in
`auth."Login_accounts"`. **If the address is in the login table and active, they
are let in. If it is not, they are refused.**

Signing in with Microsoft never *creates* an account. The login table stays the
single register of who may in — so removing somebody from it removes them from
the platform, whatever their Microsoft tenant still says about them.

The button does not render until the settings below are present:
`/login_api/health/` reports `microsoftSso.configured`, and the sign-in page
hides the button when it is false. A button that cannot work is worse than no
button, which is why the previous placeholder one was removed.

---

## What you need to create

A **delegated** Entra ID app registration — one that signs a *user* in, as
opposed to the mail sender in [AZURE_SETUP.md](AZURE_SETUP.md), which uses
client credentials and has no redirect URI at all. The two are unrelated and
the mail registration cannot be used here.

This deployment already has a delegated registration: the one the learner
calendar connections use (`MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` in
`.env`). You can either reuse it or create a dedicated one — see
[Which registration](#which-registration) below.

### 1. Add the redirect URI

In the app registration → **Authentication** → **Add a platform** → **Web**,
add the callback exactly as the backend will send it, including the trailing
slash:

```
https://lms.kentbusinesscollege.net/login_api/microsoft/callback/
```

Add a second entry for local development if you sign in locally. Use the Vite
dev server's port, **not** Django's: `vite.config.ts` proxies `/login_api` to
Django precisely so the `kbc_session` cookie is set same-origin with the SPA.

```
http://localhost:3000/login_api/microsoft/callback/
```

A mismatch of even one character — a missing trailing slash, `http` for
`https` — fails at the authorize step with `AADSTS50011`.

Leave **Implicit grant** unticked. This is the authorization-code flow; it needs
neither the access-token nor the ID-token implicit checkbox.

### 2. Confirm the delegated permissions

**API permissions** → Microsoft Graph → **Delegated permissions**. You need:

| Permission  | Why |
| ----------- | --- |
| `openid`, `profile`, `email` | Standard sign-in scopes. |
| `User.Read` | Reads `/me` to get the signed-in person's address, which is the value looked up in the login table. |

`User.Read` normally has consent by default. If your tenant requires admin
consent for all apps, grant it here — otherwise every user hits a consent
prompt they cannot approve.

Note what is **not** requested: `offline_access`. This flow wants an identity
once, not a refresh token to store. There is nothing to keep and nothing to
leak.

### 3. Client secret

Reuse the existing secret if you are reusing the calendar registration.
For a dedicated one: **Certificates & secrets** → **New client secret**, copy
the **Value** column (not the *Secret ID* — it is shown once).

---

## What to add to `backend/.env`

```dotenv
# --- Sign in with Microsoft ---
# Required. Must match a redirect URI on the app registration exactly.
MICROSOFT_SSO_CALLBACK_URI=https://lms.kentbusinesscollege.net/login_api/microsoft/callback/

# Optional. Omit to reuse the delegated app registration the learner calendar
# connections already use (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET), and
# the directory in MICROSOFT_TENANT_ID.
MICROSOFT_SSO_CLIENT_ID=<Application (client) ID>
MICROSOFT_SSO_CLIENT_SECRET=<the secret VALUE, not the secret ID>
MICROSOFT_SSO_TENANT_ID=<Directory (tenant) ID>
```

Restart the Django process after editing `.env` — it is read at startup.

`FRONTEND_URL` must also be correct, because the callback redirects the browser
back to it once the session cookie is set. It is already required by the
invitation and reset emails.

### Which registration

`MICROSOFT_SSO_*` is read first and falls back to the bare `MICROSOFT_*` pair,
the same dedicated-name-with-fallback habit as `MICROSOFT_GRAPH_*`. So the
minimum change is one line — the callback — and sign-in rides on the existing
delegated registration.

A dedicated registration is the better long-term answer: it lets sign-in be
revoked, rotated or audited without disturbing anybody's calendar connection.
Reusing is fine to get running.

Two fallbacks are deliberately absent, and both would be silent failures:

- **`MICROSOFT_CALLBACK_URI` is not a fallback.** It points at the *calendar's*
  callback. Borrowing it would hand every sign-in to the calendar-connection
  handler, which knows nothing about sessions.
- **`MICROSOFT_TENANT` is not a fallback.** This deployment sets it to `common`
  on purpose, so learners can attach a personal Outlook calendar. That is the
  right audience for a calendar and the wrong one for a sign-in: it would offer
  the authorize page to personal Microsoft accounts that can never hold a
  platform account. The tenant falls back to `MICROSOFT_TENANT_ID` — the real
  directory — and to `organizations` if even that is unset.

---

## Verifying it works

```bash
curl http://localhost:8000/login_api/health/
```

Before configuration:

```json
{"microsoftSso": {"configured": false, "missing": ["MICROSOFT_SSO_CALLBACK_URI"]}}
```

After, `configured` is `true`, `missing` is empty, and the button appears on the
login page. As with the email block, only the **names** of missing settings are
reported, never their values, so this is safe to call from a monitoring check.

Then sign in with an address that has an active login account, and one that does
not. The second must be refused with "That Microsoft account is not registered
on this platform."

Both outcomes are written to `login."Login_audit"`:

```sql
SELECT "Event", "Email", "Succeeded", "Reason", "Created_at"
FROM login."Login_audit"
WHERE "Reason" LIKE '%sso%' OR "Reason" = 'microsoft_sso'
ORDER BY "Created_at" DESC LIMIT 20;
```

| `Reason` | Meaning |
| --- | --- |
| `microsoft_sso` | Signed in successfully this way. Distinguishes it from a password sign-in, which has no reason. |
| `sso_unknown_account` | Authenticated with Microsoft, but the address is not an active account here. |
| `sso_locked` | The account is locked out; honoured so a lockout closes this door too. |
| `sso_bad_state` | The `state` was forged, replayed or older than ten minutes. |
| `sso_state_not_bound` | The state was valid, but this browser did not start the sign-in. Usually a second tab overwriting the nonce cookie, or a very stale attempt; only rarely a callback URL lifted from another browser. |
| `sso_exchange_failed` | The token exchange or Graph call failed — a configuration fault. The full reason is logged under the `login.sso` logger; the browser is told only that it did not work. |
| `sso_no_email` | The Microsoft account has neither a mailbox nor a UPN. |

---

## Notes on the design

**What is checked, and what is not.** The lookup is
`identity.account_for_email`, exactly what the password form uses: active
accounts only, and it refuses an address that exists under two subject types
(say, both an employer and a staff member), because there is no way to tell
which was meant. Lockout is honoured — otherwise the password lockout would be
bypassable by anyone whose tenant account still works.

**`has_password` is deliberately not checked.** Somebody who was invited but
never set a password *can* sign in this way, and never needs one; their tenant
account is the credential. The password form still refuses them, having nothing
to verify against. If you would rather require onboarding first, that is the one
line to change in `login/microsoft_sso.py`.

**Sessions are ordinary sessions.** The same `issue_session` /
`set_session_cookie` path as a password sign-in, so an SSO session is HttpOnly,
revocable, expires on the same schedule and appears in the admin console like
any other. Note there is no "remember me": the flow takes the standard 12-hour
lifetime, not the 30-day one.

**Why the address comes from Graph and not the ID token.** The token is
exchanged over TLS with the token endpoint, for a code minted moments earlier,
so reading `/me` with it avoids JWKS fetching, signature validation and
clock-skew handling — three things that are easy to get subtly and silently
wrong. It is the same approach `learner_api.calendar_connections` already takes.

**CSRF on the callback.** The callback is a top-level browser redirect, so it
cannot carry the `X-Requested-With` header the rest of the login API requires.
The defence is instead a signed, salted, ten-minute `state`, minted by
`/login_api/microsoft/start/`. Its salt differs from the calendar flow's, so
neither flow's state can be replayed against the other.

A signed state proves *this server* minted it, which is not the same as proving
*this browser* asked for it. So `start` also sets a random nonce in an HttpOnly
cookie and puts only its hash in the state; the callback requires the two to
agree. Without that pairing, somebody who already has a platform account could
start a sign-in, stop the redirect on their own machine and hand the finished
callback URL to another person — whose browser would complete it and be signed
in as the attacker, so everything they then wrote landed in the attacker's
account. The nonce is retired once used, so one cookie completes exactly one
sign-in.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| The button never appears | `MICROSOFT_SSO_CALLBACK_URI` is unset. Check `/login_api/health/`. |
| `AADSTS50011: redirect URI does not match` | The URI in `.env` is not character-identical to one on the app registration. Check the trailing slash and the scheme. |
| `AADSTS7000215: Invalid client secret` | The *Secret ID* was pasted instead of the *Value*, or the secret expired. |
| `AADSTS650057 / invalid resource` | The registration has no `User.Read` delegated permission. |
| "That Microsoft account is not registered on this platform" | Working as intended — that address has no active row in `Login_accounts`. Invite the person first. |
| "That sign-in link has expired" | More than ten minutes between clicking the button and finishing at Microsoft. Just retry. |
| "That sign-in could not be verified. Please try again from this browser." | Almost always two sign-in tabs open at once — the second overwrites the first's nonce cookie. Retry from a single tab. It also appears if cookies are blocked for the site, or if a callback URL was opened in a browser other than the one that began the sign-in. |
| Signs in, then bounces straight back to the login page | `FRONTEND_URL` points somewhere other than the origin the browser is on, so the cookie is set for a different host. |
