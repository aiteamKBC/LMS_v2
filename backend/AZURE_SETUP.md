# Azure setup for platform email (invitations + password resets)

Everything in the login system is built and working **except the outbound
email**. Until the app registration below exists, no mail is sent and the API
reports `emailSent: false` with the reason. Nothing else is blocked by this.

With `DJANGO_DEBUG=true`, the unsent invitation/reset link is written to the
Django console so the flow can be walked through end-to-end without Azure. With
DEBUG off it is **not** logged — the link contains a live single-use token, and
production logs are read by more people than should be able to take over an
account. So in a deployed environment, configuring the settings below is the
only way anyone receives a link.

This document is the complete list of what to create in Azure and what to paste
into `backend/.env`.

---

## What you need to create

An **Entra ID (Azure AD) app registration** with the **application** permission
`Mail.Send`, plus a mailbox for it to send as.

### 1. Register the application

1. Go to <https://portal.azure.com> → **Microsoft Entra ID** → **App
   registrations** → **New registration**.
2. Name it something recognisable, e.g. `KBC LMS – Platform Mail`.
3. **Supported account types**: *Accounts in this organizational directory only*
   (single tenant).
4. Leave **Redirect URI** empty. This app never signs a user in — it uses the
   client-credentials flow, so there is no redirect.
5. **Register**.

On the overview page, copy:

| Portal field                  | Goes into `.env` as       |
| ----------------------------- | ------------------------- |
| **Application (client) ID**   | `AZURE_MAIL_CLIENT_ID`    |
| **Directory (tenant) ID**     | `AZURE_MAIL_TENANT_ID`    |

### 2. Grant the Mail.Send application permission

1. In the app registration → **API permissions** → **Add a permission**.
2. **Microsoft Graph** → **Application permissions** (*not* Delegated — there is
   no signed-in user in this flow).
3. Search for and tick **`Mail.Send`**.
4. **Add permissions**.
5. Click **Grant admin consent for &lt;tenant&gt;** and confirm. The permission
   must show a green *Granted* tick — without this step every send fails with
   `AADSTS65001` or a Graph `403`.

### 3. Create a client secret

1. **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Description e.g. `LMS backend`, expiry per your policy (24 months is common).
3. **Add**, then immediately copy the **Value** column — not the *Secret ID*.
   The value is shown once and cannot be retrieved later.

| Portal field       | Goes into `.env` as         |
| ------------------ | --------------------------- |
| Secret **Value**   | `AZURE_MAIL_CLIENT_SECRET`  |

> Set a calendar reminder for the expiry date. When the secret expires, sending
> stops and `/login_api/health/` will report the failure.

### 4. Choose the sending mailbox

`AZURE_MAIL_SENDER` must be a real mailbox in the tenant with an Exchange
Online licence — a shared mailbox is fine and is the usual choice, e.g.
`noreply@kentbusinesscollege.com`.

A distribution list or an unlicensed account will not work: Graph returns
`ErrorInvalidUser` / `MailboxNotEnabledForRESTAPI`.

### 5. (Recommended) Scope the app to just that mailbox

As granted, `Mail.Send` lets the application send as **any** mailbox in the
tenant. To restrict it to the one address, apply an application access policy in
Exchange Online PowerShell:

```powershell
New-ApplicationAccessPolicy `
  -AppId <AZURE_MAIL_CLIENT_ID> `
  -PolicyScopeGroupId noreply@kentbusinesscollege.com `
  -AccessRight RestrictAccess `
  -Description "KBC LMS platform mail — noreply only"
```

Verify it:

```powershell
Test-ApplicationAccessPolicy -Identity noreply@kentbusinesscollege.com -AppId <AZURE_MAIL_CLIENT_ID>
```

Policy changes can take up to ~30 minutes to propagate.

---

## What to add to `backend/.env`

```dotenv
# --- Platform email (invitations and password resets) ---
AZURE_MAIL_TENANT_ID=<Directory (tenant) ID>
AZURE_MAIL_CLIENT_ID=<Application (client) ID>
AZURE_MAIL_CLIENT_SECRET=<the secret VALUE, not the secret ID>
AZURE_MAIL_SENDER=noreply@kentbusinesscollege.com

# Optional. Set to false to force the console fallback (useful in staging).
AZURE_MAIL_ENABLED=true
```

Restart the Django process after editing `.env` — it is read at startup.

### Related settings you may also want

```dotenv
# Where the emailed links point. Must be the URL the recipient can actually
# reach — a link to localhost is useless in a real invitation email.
FRONTEND_URL=https://lms.kentbusinesscollege.net

# Turn on once the app sits behind LiteSpeed/Cloudflare, so login throttling
# sees the real client IP instead of the proxy's.
TRUST_PROXY_IP_HEADER=true
```

---

## Verifying it works

```bash
curl http://localhost:8000/login_api/health/
```

Before configuration:

```json
{"email": {"configured": false, "missing": ["AZURE_MAIL_SENDER"]}}
```

After:

```json
{"email": {"configured": true, "missing": []}}
```

Then send a real invitation and confirm `emailSent` is `true`:

```bash
python manage.py shell -c "
from login.identity import ensure_account
from login.invitations import send_invitation
account, _ = ensure_account('staff', <staff_id>)
print(send_invitation(account, invited_by='setup-check'))
"
```

The health endpoint reports only the **names** of missing settings, never their
values, so it is safe to call from a monitoring check.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `AADSTS7000215: Invalid client secret` | The *Secret ID* was pasted instead of the *Value*, or the secret expired. |
| `AADSTS700016: Application not found` | `AZURE_MAIL_CLIENT_ID` is wrong, or the app is in a different tenant than `AZURE_MAIL_TENANT_ID`. |
| Graph `403 ErrorAccessDenied` | Admin consent was never granted, or an application access policy excludes this mailbox. |
| Graph `404 ErrorInvalidUser` | `AZURE_MAIL_SENDER` is not a real, licensed mailbox in the tenant. |
| Mail is accepted but never arrives | Check the sending mailbox's Exchange message trace; also check SPF/DKIM for the domain. |

Failures are recorded, not swallowed: the reason is written to `Send_error` on
the `login."Invitations"` / `login."Password_resets"` row, logged at ERROR under
the `login.email` logger, and returned to staff-facing callers in the API
response.

---

## Note on the existing `MICROSOFT_*` credentials

`backend/.env` already holds several `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`
pairs for the calendar and live-sessions integrations. The mail sender falls back
to those if the `AZURE_MAIL_*` names are absent — but **they will not work
as-is**, because none of them has been granted `Mail.Send`. Either grant that
permission to one of those registrations, or (preferred) create the dedicated
registration above so mail can be revoked without disturbing calendar access.
