# Login system — test suite and results

Feedback report for the authentication feature (`backend/login/`).

**Status: 195 backend + 63 frontend tests, all passing.** See
[Results](#results) for the raw output.

---

## Contents

- [How to run them](#how-to-run-them)
- [Results](#results)
- [What the tests cover](#what-the-tests-cover)
- [The bug the tests caught](#the-bug-the-tests-caught)
- [What is deliberately not covered](#what-is-deliberately-not-covered)
- [Notes for whoever maintains these](#notes-for-whoever-maintains-these)

---

## How to run them

```bash
cd backend

# The fast subset — no database, ~0.5s. Use this while working on the code.
python manage.py test_login --fast

# Everything, against the Neon test database. ~2 minutes.
python manage.py test_login

# Reuse the test database between runs (skips provisioning)
python manage.py test_login --keepdb
```

The `test_login` command exists because the long form is easy to get wrong:

```bash
python manage.py test login --testrunner=login.test_runner.EnrolmentTestRunner
```

**That `--testrunner` flag is not optional for the full suite.** The login models
are `managed = False` (the tables are created by `apply_login_tables`, not by
migrations, because `EnrolmentRouter` refuses to migrate the Neon database). So
Django's own test runner builds a test database containing *none* of the tables
these tests need, and every single one errors with `relation ... does not exist`.
`login/test_runner.py` fixes that by running the real DDL commands against the
test database before the suite starts.

### Two suites, on purpose

| File | Tests | Needs a database? | Runtime |
| --- | --- | --- | --- |
| `login/tests_unit.py` | 82 | 68 no · 14 yes | 0.5s (fast subset) |
| `login/tests.py` | 50 | yes — full HTTP + DB | ~95s |

The split is about feedback speed. Everything that is pure logic — the lockout
schedule, password policy, token hashing, role mapping, mail configuration —
runs with no connection at all, so you get an answer in under a second. The
endpoint tests drive real HTTP requests through Django's test client against
real tables, which is slower but is the only way to prove the middleware,
cookies and decorators actually line up.

### Frontend

```bash
cd frontend
npx vitest run src/api/__tests__/auth.test.ts \
               src/hooks/__tests__/useAuth.test.tsx \
               src/pages/__tests__/authPages.test.tsx
```

| File | Tests | Covers |
| --- | --- | --- |
| `src/api/__tests__/auth.test.ts` | 28 | The API client's contract with `/login_api/` |
| `src/hooks/__tests__/useAuth.test.tsx` | 16 | Session hydration, login/logout, role mapping |
| `src/pages/__tests__/authPages.test.tsx` | 19 | Login, forgot-password and set-password pages |

---

## Results

Fast subset:

```
Ran 82 tests in 0.656s

OK
```

Full suite (`python manage.py test_login`):

```
Provisioning unmanaged enrolment/login tables into 'test_neondb_enrolment'…
Ran 195 tests in 339.359s

OK
```

Most of that runtime is network latency to Neon (eu-west-2), not the assertions
— which is exactly why the fast subset exists.

Frontend (`npx vitest run`, whole project — the 63 auth tests plus everything
that already existed, to prove none of it regressed):

```
Test Files  30 passed (30)
     Tests  295 passed (295)
  Duration  12.72s
```

> **Known noise, not a failure.** After the results line, teardown sometimes
> prints `database "test_neondb" is being accessed by other users`. Neon keeps
> pooled connections open for a few seconds after the suite finishes, so the
> drop can lose a race with its own connection pool. The tests have already
> reported `OK` by that point and the next run recreates the database anyway.

---

## What the tests cover

### `tests_unit.py` — 96 tests

| Class | n | What it pins down |
| --- | --- | --- |
| `NormalisationTests` | 5 | Email lowercasing/trimming; that `.` and `+tag` are **not** stripped (collapsing them would merge two different corporate mailboxes into one identity) |
| `TokenPrimitiveTests` | 6 | Tokens are unique, URL-safe, ≥40 chars; the stored hash is a SHA-256 digest and never the token itself |
| `PasswordHashingTests` | 5 | Hash never contains the password; the same password hashes differently each time (per-hash salt); a recognised strong algorithm is in use; an empty hash never verifies |
| `PasswordPolicyEdgeTests` | 7 | Length boundaries either side of the minimum, the 128-char ceiling, non-string input, case-insensitive name matching, and that short name fragments don't block a good password |
| `LockoutScheduleTests` | 5 | No lock below the threshold, first lock exactly at it, backoff grows, backoff is **capped**, schedule is monotonic |
| `LifetimeTests` | 3 | Reset TTL < invitation TTL; "remember me" extends but never removes expiry |
| `ClientIpTests` | 6 | `X-Forwarded-For` is ignored unless explicitly trusted; a malformed header falls back rather than becoming the throttle key; UA is truncated |
| `RoleMappingTests` | 7 | Only `Position: Admin` grants admin; an unset position fails **closed** to staff; only admin holds `accounts.manage`; the permission list is a copy |
| `InviteAuthorisationTests` | 6 | The full authorisation matrix — see [below](#the-bug-the-tests-caught) |
| `MailConfigurationTests` | 6 | Each missing setting is named; the `MICROSOFT_*` fallback works; the sender has no fallback; **the reported list leaks no secret values** |
| `MailFallbackTests` | 6 | Graph 202 = sent, 503 = reported not raised, network errors caught; and the DEBUG-gated logging rule |
| `MessageTemplateTests` | 3 | Both emails carry their link; no `None` rendered for a missing name; no `<style>`/`<script>` (mail clients strip them) |
| `LinkBuildingTests` | 3 | Links point at `FRONTEND_URL`; no double slash; the two flows use different paths |
| `SessionLifecycleTests` | 9 | Issue/resolve/revoke; expired and unknown tokens rejected; **deactivating an account kills live sessions immediately**; `revoke_all` can spare the current session; other accounts untouched |
| `ThrottleCounterTests` | 5 | Quiet IP not throttled; throttled after enough failures; old failures fall out of the window; successful logins don't count; a null IP never throttles everyone |
| `MicrosoftSsoConfigTests` | 5 | `MICROSOFT_SSO_*` wins over the shared delegated app; the fallback works; **the tenant never borrows `MICROSOFT_TENANT`** (set to `common` for personal calendars) and the callback never borrows the calendar's; `missing_settings` reports names, never values |
| `MicrosoftSsoStartTests` | 6 | An unconfigured deployment is refused rather than half-built; the authorize URL targets the configured tenant/client; **no `offline_access`** is requested; the state is signed and round-trips the return path; the calendar flow's salt is not interchangeable; **an absolute or protocol-relative `next` is refused** (open redirect) |

### `tests.py` — 70 tests

| Class | n | What it pins down |
| --- | --- | --- |
| `PasswordPolicyTests` | 7 | Short/common/name-containing/repeated-character passwords refused; a real passphrase accepted |
| `LoginEndpointTests` | 11 | Cookie is HttpOnly + SameSite=Lax; the session token is not stored in plaintext; **wrong password and unknown account return byte-identical responses**; the `X-Requested-With` CSRF gate; no-password and inactive accounts refused; lockout after repeated failures; success clears the counter; `/me` never exposes the hash; attempts are audited |
| `RoleTests` | 3 | Admin position → admin role; other positions → staff; **a demotion takes effect without recreating the account** |
| `InvitationTests` | 6 | Token stored only as a hash; acceptance sets the first password; single-use; weak passwords refused at acceptance; re-issuing supersedes the old link; expired links refused |
| `PasswordResetTests` | 5 | `forgot-password` does not disclose whether an account exists; reset changes the password, **revokes every existing session**, clears a lockout, and cannot be reused |
| `ChangePasswordTests` | 3 | Requires the current password (so a hijacked session can't be made permanent); keeps the caller signed in; requires authentication |
| `InvitePrivilegeTests` | 6 | The regression tests for the escalation bug — see below |
| `LearnerApiGateTests` | 7 | Anonymous writes to the four `learner_api` creation endpoints are refused and create nothing; a learner session gets 403; a staff session succeeds; reads stay open; the `LEARNER_API_REQUIRE_AUTH=0` escape hatch works **and still cannot mint an admin** |
| `PermissionTests` | 2 | The invite endpoint rejects anonymous callers and learner sessions |
| `MicrosoftSsoCallbackTests` | 19 | **An address in the login table is signed in; one that is not is refused and no account is created**; matching is case-insensitive; deactivated and locked accounts refused; an account with no password may still sign in; the cookie is HttpOnly; success and refusal are both audited, success as `microsoft_sso`; **a state lifted from another browser is refused** (login CSRF) and the nonce is retired after use; forged and expired states refused; a failed exchange leaks no reason; a cancelled consent is reported, not crashed |

### Frontend — 63 tests

| Class / group | n | What it pins down |
| --- | --- | --- |
| `request plumbing` | 6 | Every call sends `credentials: 'include'` **and** the `X-Requested-With` CSRF header; network and non-JSON failures become readable errors |
| `apiLogin` | 5 | Credentials and the remember flag are posted; the server's `locked` / `throttled` codes and `lockedUntil` survive onto the thrown error |
| `apiMe` | 3 | A 401 resolves to **null** (not signed in is not an error); a 502 still throws |
| token flows | 5 | Tokens are URL-encoded; `invalid_token` and `weak_password` codes preserved |
| `apiInviteAccount` / health | 3 | Subject reference posted; a 403 surfaces as `forbidden`; missing mail settings reported |
| `describePasswordProblem` | 6 | Mirrors the server rules, and is explicitly advisory — a password it accepts can still be refused server-side |
| `useAuth` hydration | 4 | Starts uninitialised; signs in from an existing cookie with no user action; settles (rather than hanging) when `/me/` fails |
| `useAuth` login/logout/roles | 10 | Admin maps to a wildcard RBAC role, a learner does not; logout clears local state **even if the revoke call fails** |
| `previewAs` | 2 | The demo shortcut sets no `account`, so it stays distinguishable from a real session |
| `LoginPage` | 6 | Submits typed credentials and the remember flag; shows the **server's** message; re-enables the button after failure; no demo password advertised |
| `ForgotPasswordPage` | 4 | Known and unknown addresses produce the **same** confirmation; malformed input never reaches the API |
| `SetPasswordPage` | 9 | Token validated on load; dead/absent links fail before asking for a password; mismatch and length blocked client-side; both invitation and reset modes hit their own endpoints |

---

## The bugs the tests caught

### 2. The set-password form dropped every character after the first

Found by the page tests, and it would have made the invitation flow unusable in
a real browser. `SetPasswordPage` defined its `Shell` wrapper *inside* the
component:

```jsx
export default function SetPasswordPage({ mode }) {
  const Shell = ({ children }) => ( … );   // ← new component type every render
```

Because `Shell` was a new function identity on each render, React treated it as
a different component type, unmounted the entire subtree and remounted it — so
the password input lost focus after every keystroke. The test failure showed
`value="F"` for a field that had been sent nineteen characters.

Fixed by hoisting `Shell` to module scope. This is the class of bug that a
typecheck cannot see and a quick manual click-through can easily miss, because
it looks like a slow or unresponsive field rather than a defect.

### 1. Unauthenticated privilege escalation to admin

A security review of this feature found a **high-severity privilege escalation**,
which I reproduced, fixed, and then pinned with the six `InvitePrivilegeTests`.
Recording it here because the shape of it is worth remembering.

**What happened.** The three `learner_api` creation endpoints
(`/learner_api/staff-users/`, `/enrolment-users/`, `/employers/`) are
`@csrf_exempt` and carry **no authentication decorator** — that part predates
this work. Hooking invitations into them changed the impact completely: before,
an unauthenticated POST created a junk database row. After, it minted a **real
admin credential** and emailed a working set-password link to whatever address
the request named:

```bash
curl -X POST https://…/learner_api/staff-users/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"x","email":"attacker@evil.tld","position":"Admin","inviteToPlatform":true}'
```

No session, no CSRF token, no credentials. `position: "Admin"` maps to
`role=admin`, which carries every permission in the system.

**The fix.** Authorisation now lives in `login/services.py::_authorise`, called
from `invite_subject` — at the point the credential is minted, *not* only on the
endpoint. That placement is the actual lesson: a check on the view would have
been correct but fragile, because the next endpoint that learns to invite would
silently skip it. The rules are:

| Caller | May invite learner/employer/staff | May invite **admin** |
| --- | --- | --- |
| Anonymous | no | no |
| Learner / Employer | no | no |
| Inactive account | no | no |
| Staff | **yes** | **no** |
| Admin | yes | yes |

The staff→admin row is the non-obvious one. Without it, any staff member could
promote themselves by creating an "Admin"-position colleague at an address they
control — using a form they are already allowed to submit.

Verified after the fix: an anonymous POST now returns `forbidden: true` and
creates **no** account; the record itself still saves, and the UI reports "Not
permitted to invite" distinctly from a mail failure.

---

## What is deliberately not covered

Being explicit, so nobody assumes coverage that isn't there:

- **No live Azure calls.** Every Graph interaction is mocked. Nothing in the
  suite sends real email or needs network access. The real transport is
  unverified until the app registration in [AZURE_SETUP.md](AZURE_SETUP.md)
  exists — that is the one part of this feature no test can currently prove.
- **No end-to-end browser test.** The frontend tests mock `fetch`, so they prove
  the client sends the right thing and reacts correctly to each response, but
  not that a real browser completes a sign-in against a running Django. The
  backend endpoint tests cover the server half of that seam.
- **Argon2 parameters are not asserted.** The tests check that a strong
  algorithm is in use, not its cost factors. Those come from Django's defaults
  and change with Django versions; pinning them here would just be a second
  place to update.
- **Concurrency.** Two simultaneous redemptions of the same token are not
  tested. The single-use guarantee rests on a unique index and a transaction, so
  the database enforces it, but that is reasoned rather than demonstrated.
- **`learner_api` reads are still open.** Writes are now gated
  (`LearnerApiGateTests`), but GET on the learner, staff, employer and
  organisation endpoints still answers anonymous callers. That is deliberate for
  now — the console has fetches that predate the session and would break — and
  the tests pin the current behaviour rather than the desired end state. Closing
  the read paths means auditing every caller first.

### Test hygiene

- Every test email uses a reserved TLD (`.invalid` / `.test`), so no test can
  ever send mail to a real address even if the transport were configured.
- Each test cleans up the rows it creates in `tearDown`/`finally`.
- The full suite runs against `test_neondb_enrolment`, a **separate database**
  from production. `login/test_runner.py` refuses to run its DDL if the
  connection is not pointing at a `test_`-prefixed database — an early version
  of that runner would have provisioned tables into production, and the guard
  is what stops that recurring.
- Production data was verified untouched after every run: 9 learners, 2
  employers, 2 staff, 1 login account.

---

## Notes for whoever maintains these

**If the whole suite suddenly errors with `relation ... does not exist`,** you
ran it without the custom runner. Use `python manage.py test_login`.

**If you add a column to an unmanaged table,** add its `apply_*` command to
`SETUP_COMMANDS` in `login/test_runner.py`. This has already bitten once:
`Created_users` needed both `apply_created_users_table` *and*
`apply_created_users_employer_id`, because the column arrived in a later
command, and the failure surfaced as an unrelated-looking `UndefinedColumn`.

**If every console write suddenly 401s in local development,** you have no
session. Sign in at `/login`, or set `LEARNER_API_REQUIRE_AUTH=0` in
`backend/.env` — never in a deployment. Note that even with the gate off, the
invite authorisation still applies, so you cannot mint an admin from an
anonymous request either way.

**Two defences guard the escalation path, and both are tested separately.** The
endpoint gate (`staff_only`) refuses the request; the invite check
(`services._authorise`) refuses the credential. `InvitePrivilegeTests` covers
the outer one, and `LearnerApiGateTests.test_disabling_the_gate_still_does_not_allow_minting_an_admin`
covers the inner one with the outer switched off. If you relax either, the other
test should start failing — if it doesn't, the remaining defence isn't real.

**Don't assert against exact user-facing strings.** The tests check status
codes, `code` fields (`locked`, `weak_password`, `invalid_token`, `csrf`,
`forbidden`) and observable state. Message wording is allowed to change.

**A fixture password must not contain the fixture's own name.** The policy
rejects passwords containing the account's display name or email local part —
correctly. An early fixture used `Str0ng-Test-Passphrase!` on an account named
"Test Person" and failed its own policy. The current fixture,
`Vaulted-Harbour-92!`, shares no word with either.
