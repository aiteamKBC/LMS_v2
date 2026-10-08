# Teams live participant identity — hosting and security setup

Status: **setup guide only. No feature code exists yet.** Nothing in this
document is active in any environment, and none of the environment variables
below is read by the LMS today. It is the list of what has to exist before:

1. the **live feasibility proof** can run on an isolated endpoint (§3), and
2. the eventual **production implementation** can be switched on.

The feature is identity *monitoring* only. It never changes who can join a
meeting, the lobby, presenter or co-organiser roles, meeting options, links,
dates, invitations, or attendance/hours calculations. Every Microsoft write it
performs is to `/subscriptions` (an observation registration), never to a
meeting or calendar event.

---

## 1. What has already been verified (read-only, 8 Oct 2026)

| Check | Result |
| --- | --- |
| App registration's application permissions include `OnlineMeetings.ReadWrite.All` (covers the `OnlineMeetings.Read.All` the subscription needs) | Yes — read from the app's own token claims |
| `User.Read.All` (to turn a participant's Entra object ID into an email) | Yes |
| Service principal `appRoleAssignmentRequired` | `false` — the setting Microsoft recommends; without it notifications arrive with `validationTokens: null` |
| Application access policy for meeting organisers | Present for the existing organiser (meeting-option PATCHes succeed). Whether subscriptions also need it is **not yet proven** |
| `cryptography` package available to the backend | Yes (`cryptography==49.0.0` in `requirements.txt`) — enough to verify Microsoft's JWTs and decrypt payloads without a new dependency |
| Existing public HTTPS backend | `api.kentbusinesscollege.net` → Hostinger VPS `srv1915049` (`72.62.133.105`) → OpenLiteSpeed → Gunicorn → Django. See §1a |

### 1a. The infrastructure that actually exists (checked 8 Oct 2026, read-only)

| Fact | Evidence |
| --- | --- |
| **No Cloudflare in front.** DNS is Hostinger's (`ns1/ns2.dns-parking.com`) and responses carry `server: LiteSpeed` with no `cf-ray` header | DNS NS lookup; response headers of `api.` and `lms.` |
| **One VPS serves every subdomain**: `api`, `lms`, `admin`, `fetch-evidence`, `tutordashboard` all resolve to `72.62.133.105` | DNS A lookups |
| **One OpenLiteSpeed virtual host and one Let's Encrypt certificate per subdomain** (each certificate names only its own host) | TLS certificate issuer/SAN of three subdomains |
| **LiteSpeed forwards only the established `*_api` prefixes (and `/api/chat/`, `/api/calendar/`) to Django**; any other path falls through to the SPA's `index.html` | Comments in `config/urls.py`, `curriculum_api/urls.py`, `frontend/src/lib/apiGetBatching.ts` |
| **No staging web environment exists.** No staging/dev/test/uat/preprod/beta/sandbox subdomain resolves, and there is no wildcard record | DNS lookups |
| Neon has many **database branches** (feature/validation branches off `production`), but a branch is only a database — none is served by a web host | Neon branch list |
| No deployment configuration (service units, vhost files, Dockerfiles, CI) is kept in this repository | Repository search |

Microsoft facts this design depends on (from Microsoft Learn, retrieved 8 Oct 2026):

- Resource: `communications/onlineMeetings(joinWebUrl='{url-encoded join URL}')/meetingCallEvents`.
  Events: `callStarted`, `callEnded`, `rosterUpdated` (joins and leaves of the call **and the lobby**).
- Application permission only (`OnlineMeetings.Read.All` or `.ReadWrite.All`). No delegated support.
- **Rich (encrypted) notifications are required in practice**: basic notifications carry only an ID and
  Microsoft provides no API to read the event back.
- **Version conflict to settle in the proof:** the meeting-events page lists `beta, v1.0`; the
  rich-notifications table marks this resource *beta only*. Plan for `beta`, try `v1.0` first.
- One subscription per app per meeting join URL. Tenant-wide quota: 10,000 Teams subscriptions.
- Maximum lifetime 4,230 minutes (just under 3 days); must be renewed.
- Latency: average < 10 s, maximum 1 minute.
- Participant identity in an event: `user {id, displayName, tenantId}` for signed-in accounts,
  `guest {id, displayName, email}` for unauthenticated joiners, plus `phone`, `applicationInstance`,
  `encrypted`, etc. **No email or UPN for signed-in users** — the LMS must resolve the object ID.

---

## 2. Can the existing HTTPS backend host the webhook in production?

**Yes, and it is the recommended option.** ngrok or any tunnel must never be a
production dependency. The existing `api.kentbusinesscollege.net` →
OpenLiteSpeed → Gunicorn → Django chain can serve the webhook, provided each of
these conditions holds:

| Condition | Why | Where |
| --- | --- | --- |
| The path sits **below an already-forwarded prefix**: `/curriculum_api/integrations/msgraph/teams-meeting-events/` and `…/teams-meeting-lifecycle/` | LiteSpeed forwards only the established `*_api` prefixes; a brand-new prefix would land on the SPA's `index.html` and Microsoft's validation would fail. Staying under `/curriculum_api/` makes it a code change, not a server change (the same reason given for the activity routes in `curriculum_api/urls.py`) | `curriculum_api/urls.py` |
| An explicit **public carve-out** for exactly that sub-path in the session gate | `/curriculum_api/` is staff-gated by `ApiSessionGateMiddleware`; Microsoft sends no session cookie. The gate already resolves longest-prefix-first, so one more-specific rule can open just these two paths without touching the rest of the prefix | `login/api_gate.py` (needs a "public" rule kind next to the existing role sets, documented with its reason like `/login_api/` and `/api/calendar/`) |
| The view alone is `@csrf_exempt` | Microsoft cannot send a CSRF token. Authentication is the four checks in §6 instead | the view |
| No proxy challenge layer to bypass | There is no Cloudflare/WAF in front today (§1a). If one is ever added, it must not challenge POSTs to these paths | — |
| Responses within 3 seconds | Microsoft marks an endpoint "slow" when > 10 % of responses exceed 3 s (10-minute delay), and "drop" when > 15 % exceed 10 s (notifications discarded, unrecoverable) | The view only stores the raw body and answers `202`; verification, decryption and resolution happen in the existing in-process scheduler loop |
| Served by whichever backend service handles `/curriculum_api/` | Production is nine 2-worker services behind one host | Nothing to add — the existing forwarding already does this |
| A small request-size cap | Defence against a flood of large bodies | Django's `DATA_UPLOAD_MAX_MEMORY_SIZE` plus a size check in the view (Microsoft batches are far below 1 MB) |
| `X-Forwarded-Proto` stripped and re-set by the proxy | Already a stated requirement of `SECURE_PROXY_SSL_HEADER` in `config/settings.py` | OpenLiteSpeed |
| Request bodies never logged | They carry encrypted personal data and validation tokens | `config/observability.py` request logging must exclude the path's body |

What it does **not** need: Redis, a message broker, a separate worker
service, a websocket server, or a second domain. Idempotency is a unique key
in the database; the existing per-process scheduler thread does the
follow-up work; the browser learns of new rows through the existing cache-epoch
polling channel.

---

## 3. Where the live proof runs

No staging web environment exists (§1a), and the proof needs **no LMS code, no
LMS database and no LMS `.env`** — only a reachable HTTPS endpoint running a
small standalone receiver.

### 3.1 Store-only receiver (keeps every secret off the server)

The receiver deployed for the proof does exactly two things:

1. answers Microsoft's validation handshake (`?validationToken=` → `200 text/plain`, the token);
2. appends every notification body, as received, to a file and answers `202`.

It holds **no private key, no `clientState`, no Graph credentials**. The
payloads it stores are encrypted by Microsoft with the test certificate's
public key, so the file is unreadable on the server. After the meeting, the
file is copied to the operator machine, where the validation tokens are
verified and the payloads decrypted with the test private key that never left
that machine. (The receiver and the offline decrypt/verify script were written
and exercised locally during Phase 1 and are handed over as two small Python
files.)

### 3.2 Route A (recommended): temporary isolated subdomain on the existing VPS

No new server. It follows the pattern the VPS already uses for every app — one
subdomain, one OpenLiteSpeed virtual host, one Let's Encrypt certificate.

| Item | Setting |
| --- | --- |
| DNS (Hostinger) | `A  teams-probe.kentbusinesscollege.net → 72.62.133.105` |
| OpenLiteSpeed | A **new** virtual host for that name only, created the same way the existing subdomains were. One proxy context `/` → `http://127.0.0.1:8765` (the receiver). No change to the `api.`/`lms.` virtual hosts, their contexts, or their certificates |
| TLS | Let's Encrypt certificate for `teams-probe.kentbusinesscollege.net` only |
| Process | `python3 receiver.py 8765`, bound to `127.0.0.1`, run under a **dedicated unprivileged Linux user** (e.g. `teamsprobe`), in its own directory, in `tmux`/`screen` or a temporary systemd unit. Not under Gunicorn, not in the LMS virtualenv, no read access to the LMS directory or `.env` |
| Runtime | Python 3 standard library only (store-only mode needs no packages) |
| Production effect | Adding a virtual host needs an OpenLiteSpeed **graceful** restart (in-flight requests finish). Do it out of class hours. Nothing else on the VPS changes |
| Lifetime | Removed after the proof (§9 step 8) |

Why A: it exercises the same ingress the production feature will use
(OpenLiteSpeed on this VPS, Let's Encrypt, Microsoft reaching `72.62.133.105`),
so a pass here is evidence for production, not only for the API.

### 3.3 Route B: no change to the VPS at all

A serverless HTTPS function (for example an Azure Function in the college's
Azure subscription, or a Cloudflare Worker on a `*.workers.dev` address)
running the same store-only logic. Fully isolated from production, but it needs
a new cloud resource/account and it does **not** test the VPS ingress path.

### 3.4 Not acceptable

- Tunnelling into a developer machine (refused by policy, and not representative).
- Deploying anything into the LMS's own Django services or `.env` for the proof.

Data note: once decrypted on the operator machine, events contain staff and
participant display names and object IDs. Keep that output local, readable
only by the operator, and delete it after the report is written.

---

## 4. Encryption certificate — generation and storage

Microsoft encrypts each notification's payload with the **public key** you send
when subscribing; only the holder of the **private key** can read it.
Self-signed is acceptable (Microsoft never validates the issuer, only uses the
key). Requirements: RSA, 2,048–4,096 bits, X.509, public part sent as Base64.

Generate one certificate **per environment** (staging proof, production). Never
reuse the staging one in production.

```bash
# On the machine that will DECRYPT: the operator's machine for the proof (the
# store-only receiver never holds the key), the production VPS later, as the user
# that runs the app. Nothing here is sent anywhere.
umask 077
mkdir -p /etc/kbc-lms/graph-notify && cd /etc/kbc-lms/graph-notify

openssl req -x509 -newkey rsa:3072 -sha256 -days 365 -nodes \
  -keyout notify_key.pem -out notify_cert.pem \
  -subj "/CN=KBC LMS Graph notifications (ENVIRONMENT-NAME)"

# Public certificate in the form the subscription request needs (single-line Base64 DER):
openssl x509 -in notify_cert.pem -outform der | base64 -w0 > notify_cert.b64

chmod 600 notify_key.pem
chmod 644 notify_cert.pem notify_cert.b64
chown <app-user>:<app-user> notify_key.pem notify_cert.pem notify_cert.b64
```

Storage rules:

- The private key lives **outside the repository and outside any web root**,
  mode `600`, owned by the app's system user. It is referenced by path, never
  pasted into `.env` as text, never committed, never logged.
- Back it up the way other production secrets are backed up. Losing it only
  means notifications already in flight cannot be read; recovery is to create a
  new certificate and re-subscribe.
- `encryptionCertificateId` is your own label (≤ 128 chars), e.g.
  `kbc-lms-prod-2026-10`. Notifications echo it, which is how the receiver picks
  the right key during rotation.

Rotation (yearly, or at once if the key may be exposed):

1. Generate the new pair alongside the old one (new file names, new certificate ID).
2. Deploy so the app can decrypt with **both**.
3. Switch new subscriptions and renewals to the new certificate (renewal `PATCH /subscriptions/{id}` may carry `encryptionCertificate` + `encryptionCertificateId`).
4. Remove the old key only when no notification has referenced its ID for longer than the longest subscription lifetime (3 days).

---

## 5. Environment variables (proposed names — nothing reads them yet)

Set in the environment's owner-managed `.env` when the feature is implemented.
Defaults keep it **off**.

| Variable | Example | Purpose |
| --- | --- | --- |
| `TEAMS_LIVE_IDENTITY_ENABLED` | `false` | Master switch. `false` = no subscriptions created, webhook answers 404 |
| `TEAMS_LIVE_IDENTITY_PUBLIC_BASE_URL` | `https://api.kentbusinesscollege.net/curriculum_api/integrations/msgraph` | Builds `notificationUrl` and `lifecycleNotificationUrl`. Must be the public HTTPS name Microsoft reaches |
| `TEAMS_LIVE_IDENTITY_CLIENT_STATE` | 43+ random characters | Shared secret echoed in every notification. Generate with `python -c "import secrets;print(secrets.token_urlsafe(32))"`. Per environment |
| `TEAMS_LIVE_IDENTITY_CERT_PATH` | `/etc/kbc-lms/graph-notify/notify_cert.pem` | Public certificate |
| `TEAMS_LIVE_IDENTITY_KEY_PATH` | `/etc/kbc-lms/graph-notify/notify_key.pem` | Private key (mode 600) |
| `TEAMS_LIVE_IDENTITY_CERT_ID` | `kbc-lms-prod-2026-10` | `encryptionCertificateId` |
| `TEAMS_LIVE_IDENTITY_PREVIOUS_KEY_PATH` / `_PREVIOUS_CERT_ID` | empty | Only during rotation |
| `TEAMS_LIVE_IDENTITY_GRAPH_VERSION` | `beta` | `beta` or `v1.0`, set from the proof's result |
| `TEAMS_LIVE_IDENTITY_LEAD_MINUTES` | `30` | How long before an occurrence's start its meeting is subscribed |

The existing `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID` and
`MICROSOFT_GRAPH_CLIENT_SECRET` are reused unchanged; the client ID is also the
`aud` that every validation token must carry.

---

## 6. Webhook endpoints — contract and security

### 6.1 Endpoints

| Path | Receives |
| --- | --- |
| `POST {base}/teams-meeting-events/` | Validation handshake, then encrypted meeting call events |
| `POST {base}/teams-meeting-lifecycle/` | Validation handshake, then `reauthorizationRequired`, `subscriptionRemoved`, `missed` |

### 6.2 Validation handshake (subscription creation and renewal)

Microsoft POSTs `?validationToken=<opaque>`. Answer **within 10 seconds** with
`200`, `Content-Type: text/plain`, body = the URL-decoded token, unchanged and
unescaped. Nothing else. If this fails, Microsoft refuses the subscription.

### 6.3 Notifications

1. Read the body (size-capped), store it, return **`202` within 3 seconds** — before validating, as Microsoft recommends, so validation results are not revealed to a caller.
2. Afterwards (in the scheduler loop), for each item:
   - `clientState` equals `TEAMS_LIVE_IDENTITY_CLIENT_STATE` (constant-time comparison);
   - **every** JWT in `validationTokens` is valid: RS256 signature against keys from `https://login.microsoftonline.com/common/discovery/v2.0/keys` (cached, refreshed on unknown `kid`), not expired, `aud` = our client ID, `tid` = our tenant, and caller = `0bf30f3b-4a52-48df-9a82-234910c4a086` (`azp` for v2.0 tokens, `appid` for v1.0);
   - `encryptedContent.dataKey` decrypted with the private key (RSA-OAEP, SHA-1);
   - HMAC-SHA256 of `data` with that key equals `dataSignature` — otherwise discard without decrypting;
   - `data` decrypted with AES-CBC, PKCS7, IV = first 16 bytes of the key.
3. Any failed check → the item is discarded and counted; nothing is inferred from it.
4. Idempotency: unique key on (subscription ID, notification ID, participant ID). Retries for up to 4 hours mean duplicates are normal.

### 6.4 What the webhook must never do

Call any meeting, event, calendar, mail or attendance-writing function; follow
URLs from the payload; echo payload content in responses or logs.

### 6.5 Optional network restriction

Microsoft publishes the Graph change-notification source ranges in the
*Microsoft 365 URLs and IP address ranges* list. There is no proxy in front of
the VPS (§1a), so OpenLiteSpeed sees Microsoft's real source addresses and an
allow-list could be applied in an OpenLiteSpeed context for the webhook path
only. Microsoft changes these ranges over time, so it is defence in depth
only; the four checks above are the real authentication.

---

## 7. Microsoft Graph permissions and tenant configuration

| Item | Status | Action |
| --- | --- | --- |
| `OnlineMeetings.Read.All` (application) | Covered by the granted `OnlineMeetings.ReadWrite.All` | None. Optional least privilege: a separate app registration holding only `OnlineMeetings.Read.All` + `User.Read.All` for subscriptions, with its own secret |
| `User.Read.All` (application) | Granted | None |
| Admin consent | Granted for both | None |
| `appRoleAssignmentRequired = false` on the service principal | Verified | Keep. If it is ever set to `true`, assign the *Microsoft Graph Change Tracking* service principal (`0bf30f3b-…`) an app role, or tokens arrive `null` |
| Teams application access policy covering each meeting organiser | Exists for the current organiser | Confirm in the proof whether subscriptions need it; if they do, the policy must cover every organiser the LMS uses (`Grant-CsApplicationAccessPolicy`, Teams admin) |
| Teams meeting policies, lobby, anonymous join | **Not changed** | Out of scope by design |

---

## 8. Subscription lifecycle (production design)

| Step | Rule |
| --- | --- |
| Create | ~`LEAD_MINUTES` before an occurrence starts, one subscription per distinct join URL (a recurring series shares one; per-weekday calendars, additional week meetings and sessions moved onto their own event each have their own). `expirationDateTime` = min(start + 4,230 min, last occurrence in the window + buffer) |
| Duplicate | `409 Conflict` means one already exists for that meeting: adopt it by listing `GET /subscriptions`, do not retry-create |
| Renew | `PATCH /subscriptions/{id}` when < 24 h remain and the meeting still has an occurrence in the window |
| Delete | After `callEnded` + 2 h with no further occurrence in the window, or when the feature is switched off |
| `reauthorizationRequired` | `POST /subscriptions/{id}/reauthorize` |
| `subscriptionRemoved` | Recreate if still needed; record a gap |
| `missed` | Record a gap for that meeting; the post-meeting attendance report fills it |
| Concurrency | Row lock per join URL so nine services never create duplicates |
| Failure visibility | Each meeting shows "Live identity: active / unavailable (reason)" — never a silent gap |

Creating, renewing or deleting a subscription does not touch the meeting and
sends no email.

---

## 9. Live proof — exact procedure (Route A)

Prerequisites: everything in the checklist (§11). Steps marked **[owner]** are
done by you or the VPS administrator; **[agent]** steps are run by the coding
agent from the operator machine, only after your explicit go-ahead.

1. **[owner] DNS:** in Hostinger DNS, add `A teams-probe.kentbusinesscollege.net → 72.62.133.105`. Confirm with `nslookup teams-probe.kentbusinesscollege.net`.
2. **[owner] Receiver:** on the VPS, as root: `adduser --disabled-password teamsprobe`; copy `receiver_store_only.py` into `/home/teamsprobe/`; as `teamsprobe`, start `python3 receiver_store_only.py 8765` in `tmux` (it binds `127.0.0.1:8765` only). Check `curl -s -X POST "http://127.0.0.1:8765/events?validationToken=ok"` prints `ok`.
3. **[owner] Virtual host:** create a **new** OpenLiteSpeed virtual host for `teams-probe.kentbusinesscollege.net` exactly as the existing subdomains were created; one proxy context `/` → external app `http://127.0.0.1:8765`; issue its Let's Encrypt certificate; graceful restart, out of class hours. Leave every existing virtual host untouched.
4. **[owner] Smoke test from outside the VPS:**
   ```bash
   curl -s -X POST "https://teams-probe.kentbusinesscollege.net/events?validationToken=probe123" -H "Content-Type: text/plain" -w "
%{http_code} %{content_type} %{time_total}s
"
   # expect: probe123 / 200 / text/plain / well under 10 s
   curl -s -X POST "https://teams-probe.kentbusinesscollege.net/lifecycle?validationToken=probe456" -w "
%{http_code}
"
   # expect: probe456 / 200
   curl -sI https://lms.kentbusinesscollege.net/ | head -1   # production still answers as before
   ```
5. **[agent] Test certificate:** generated on the operator machine (§4); only the public part is used in step 7.
6. **[agent] Test meeting:** `POST /users/{test-organiser-id}/onlineMeetings`, subject *"LMS identity feasibility TEST — not a class"*. Standalone online meeting: no calendar event, no participants, no email. No module meeting is used or read.
7. **[agent] Subscribe:** `includeResourceData: true`, the test certificate, `notificationUrl = https://teams-probe…/events`, `lifecycleNotificationUrl = …/lifecycle`, `expirationDateTime` = now + 3 h, a fresh `clientState`. Try `v1.0`; if Microsoft rejects it, `beta`. Record which succeeded.
8. **[owner + two helpers] Join** the test meeting three times, each in a separate browser profile:
   - signed in with a KBC account;
   - anonymous (private window, "Continue on this browser", typed name, not signed in);
   - signed in with an account from another Microsoft 365 tenant.
   Each: stay 30 s, leave, rejoin once, leave. Note the clock time of every join/leave.
9. **[owner] Hand over** `/home/teamsprobe/notifications.jsonl` to the operator machine (it holds only Microsoft-encrypted payloads).
10. **[agent] Verify and decrypt offline:** check every validation token (signature, `aud`, `tid`, caller `0bf30f3b-…`), the `clientState`, each `dataSignature`, then decrypt. Record per join: arrival delay, identity type (`user`/`guest`/other), presence of `id`/`tenantId`/`email`, whether `GET /users/{id}` resolves it, lobby vs. call events.
11. **[agent] Attendance report:** after the meeting ends, read the test meeting's attendance report (GET only) and compare identities with the live events.
12. **Clean up:** **[agent]** `DELETE /subscriptions/{id}`, `DELETE` the test meeting, delete the local test key, `clientState` and decrypted output. **[owner]** stop the receiver, remove the `teams-probe` virtual host and its certificate (graceful restart), delete the DNS record, `deluser --remove-home teamsprobe`.

Success criteria for the proof:

- the subscription is accepted (and on which API version);
- the handshake, token validation, signature check and decryption all pass;
- a KBC sign-in arrives as `user` with our tenant ID within ~10–60 s;
- the anonymous joiner arrives (or is shown not to arrive) and in which shape;
- the other-tenant account arrives with its own tenant ID;
- leave/rejoin produce `removedState` and a new entry.

---

## 10. Rollback

Nothing in this feature changes a meeting, so there is never a meeting to restore. Rollback is:

| Situation | Steps |
| --- | --- |
| Proof finished or aborted | §9 step 12. If the receiver is stopped before the subscription is deleted, Microsoft retries for up to 4 hours and then gives up; the subscription itself expires within 3 hours |
| Probe virtual host misbehaves | Remove that one virtual host and graceful-restart OpenLiteSpeed; the other virtual hosts were never edited |
| Production feature misbehaving | `TEAMS_LIVE_IDENTITY_ENABLED=false` and restart → no new subscriptions, webhook returns 404. Then list and delete the app's subscriptions: `GET /subscriptions` → `DELETE /subscriptions/{id}` for each meeting-events subscription. (Left alone, they expire within 3 days anyway.) |
| Production endpoint must close immediately | Revert the session-gate carve-out (or switch the flag off); the paths then answer 401/404 and Microsoft stops after its 4-hour retry window; nothing else is affected |
| Key or `clientState` exposure | Delete all subscriptions, generate a new certificate and `clientState` (§4, §5), re-enable. Old notifications cannot be decrypted with the new key, which is the intent |
| Database | The feature's tables are additive and only read by its own UI; disabling the feature leaves them unused. Dropping them is a separate, confirmed operation |

---

## 11. Owner checklist before the live proof can run (Route A)

- [ ] **Approval** to add a temporary `teams-probe.kentbusinesscollege.net` virtual host on VPS `srv1915049` (graceful OpenLiteSpeed restart, out of class hours).
- [ ] **Hostinger DNS** record `A teams-probe → 72.62.133.105`.
- [ ] **VPS access** for whoever creates the virtual host and Let's Encrypt certificate (the panel or method used for the existing subdomains).
- [ ] **Dedicated `teamsprobe` Linux user** running the store-only receiver on `127.0.0.1:8765`; Python 3 present (no packages needed).
- [ ] **Smoke test** in §9 step 4 passes from outside the VPS, and production still answers normally.
- [ ] **Test organiser account** chosen (a KBC account covered by the application access policy) for the standalone test meeting — no module meeting.
- [ ] **Three join identities ready**: a KBC sign-in, an anonymous browser, an account from another Microsoft 365 tenant (and the people to use them, at an agreed time).
- [ ] **Go-ahead** for the agent's steps 5–7 and 10–12 (one test meeting and one subscription, both deleted afterwards).

Not required for the proof: changes to the LMS code, its `.env`, its Django
services, its database, Microsoft 365 tenant settings, or Graph permissions.
