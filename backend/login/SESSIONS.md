# Sessions: how somebody stays signed in

A reference for the authentication session model. It exists so the next person
changing `sessions.py` knows what the rules are and, more importantly, *why*
each one is there — most of them are load-bearing in a way the code alone does
not make obvious.

Read this before changing a lifetime, the cookie, or anything on the renewal
path.

---

## 1. The shape of it

A session is a row in `login."Login_sessions"` and a random token in a cookie.
The database holds `sha256(token)`; the plaintext exists only in the cookie and
in the response that set it. Nothing about the session — not the account, not
the role, not the expiry — is carried in the cookie, so the server is the only
authority on any of it.

This is deliberately **not** a JWT. The property being bought is *immediate
revocation*: a sign-out, a password change or a deactivation kills a session on
the next request, with nothing to wait out. A stateless token cannot do that
without a revocation list, which is the state a stateless token was supposed to
avoid.

| | |
|---|---|
| Cookie name | `kbc_session` (distinct from Django's own `sessionid`, which the admin site and chat still use) |
| Token | 256 bits from `secrets.token_urlsafe` |
| Stored | `sha256` only. SHA-256 rather than a slow KDF is correct: the token already has full entropy, so there is no dictionary to grind |
| Table | `login."Login_sessions"`, **unmanaged** — Django emits no DDL for it |
| Indexes | `Token_hash` (unique), `Account_id`, `Expires_at` |

Because the table is unmanaged, **schema changes go out as raw SQL**, not
migrations. See §7.

---

## 2. Two clocks

The single most important thing in this document. A session is governed by two
independent limits, and conflating them is the mistake the split exists to
prevent.

**Rolling window** — how long a session survives *without activity*. Every touch
pushes it forward, so somebody who is working is never signed out mid-task. On
its own it would let a session — or a stolen cookie — live for ever on one
request a day.

**Absolute maximum** — how long a session may live *from `Created_at`*, however
active. Never moved. This is the ceiling that makes the rolling window safe:
re-authentication eventually becomes mandatory.

```
new expiry = min(now + rolling, Created_at + absolute)
```

| | Rolling | Absolute |
|---|---|---|
| Ordinary | 12 hours | 7 days |
| Remember me | 14 days | 90 days |

Defined in `security.py`; `session_policy(remember)` returns the pair, so
issuance, renewal and the tests cannot drift apart.

Two things worth knowing about those numbers:

- Remember me was **tightened** when it became rolling. It was a 30-day hard
  cap; reusing 30 days as a *rolling* window would let a stolen cookie live
  indefinitely on one request a month.
- The ordinary rolling window is 12 hours — the old absolute TTL — so nobody is
  signed out *earlier* than they were before rolling expiry existed.

`Created_at` is read, never written. Moving it would dissolve the ceiling.

---

## 3. Renewal

`touch_session` runs on every authenticated request, throttled: it does nothing
if `Last_seen_at` is under 5 minutes old (`_LAST_SEEN_REFRESH_SECONDS`). A
dashboard opening twelve panels writes once, not twelve times.

The write is **one conditional `UPDATE`**, not a read-then-save, which is what
makes concurrent tabs safe without a lock. Its `WHERE` clause carries every
rule:

| Clause | Rule |
|---|---|
| `revoked_at IS NULL` | A revoked session is never renewed — a logout in another tab may have landed since it resolved |
| `expires_at > now` | An expired session is never revived |
| `expires_at < target` | Expiry only moves **forward**; two near-simultaneous requests cannot shorten each other |

The ceiling cannot be jumped because `target` is already clamped before the
statement runs: there is no value it could write that exceeds it.

It is also why this was safe for sessions predating the `Remember` column. Those
backfilled as ordinary, so a legacy 30-day remembered session computes a target
*earlier* than the expiry it already holds, `expires_at < target` fails, nothing
is written, and it retires on its original schedule instead of being cut short.

### Getting the renewal back to the browser

A renewed row is worthless if the browser drops the cookie tonight, so the two
halves have to agree. The signal is one request attribute:

```
LoginSessionMiddleware.__call__
  → authenticate_request       resolves + touches, sets RENEWED_UNTIL_ATTR
  → view
  → refresh_session_cookie     re-sends the cookie, iff this request renewed
```

`refresh_session_cookie` has four guards, each closing a way the browser could
end up holding a cookie that contradicts the database:

1. **A renewal actually happened** — no attribute, no `Set-Cookie`. The touch
   throttle therefore governs cookie writes too.
2. **The response has not already spoken for the cookie.** Both `set_cookie` and
   `delete_cookie` leave a morsel in `response.cookies`, so this one check
   covers sign-in, sign-out and the SSO callback without any of them knowing
   this function exists. **It is what stops logout being followed by a
   middleware that helpfully puts `kbc_session` back.**
3. **The session was not revoked during the request** — belt to (2)'s braces.
4. **There is a token to re-send** — renewal extends a session, it never rotates
   or reissues one.

---

## 4. The cookie

Set from one place, `_cookie_kwargs`, so a change to SameSite or the name cannot
drift between login, logout and renewal.

| Flag | Value | Why |
|---|---|---|
| `HttpOnly` | always | No frontend code has any reason to read this. It is the single control that keeps an XSS bug from becoming account theft |
| `Secure` | `SESSION_COOKIE_SECURE` (tied to `DEBUG`) | A Secure cookie is not stored over plain http, so hard-coding it would break local development |
| `SameSite` | `Lax` | Lets the SPA's same-origin XHR through; refuses the cross-site POSTs CSRF depends on |
| `Path` | `/` | |
| `Max-Age` | **only when remembered** | See below |

### Persistence

- **Remember me ticked** → persistent cookie, `Max-Age` = time left until the
  renewed expiry (not a fresh full window, so a cookie clamped by the ceiling
  dies with its session rather than outliving it).
- **Not ticked** → a true **browser-session cookie**: no `Max-Age`, no
  `Expires`. It normally goes when the browser closes.
- **Microsoft SSO** → not remembered. There is no checkbox on that route, and
  signing in again costs a redirect through a tenant that has usually already
  authenticated the person.

Persistence is re-read from `session.remember` on **every** cookie write,
issuance and renewal alike. This matters more than it looks: a renewal fires
within five minutes of ordinary use, so anything that inferred persistence from
"a renewal happened" would promote every unremembered session to a persistent
one almost immediately — the choice undone by the very activity it was meant to
survive. `test_repeated_renewal_never_makes_a_normal_cookie_persistent` exists
for exactly this.

> **A browser-session cookie is a UX boundary, not a security control.**
> Chrome's "continue where you left off", crash recovery, and mobile browsers
> that never truly exit all preserve session cookies across a restart. What
> actually ends a session is `Expires_at` and `Revoked_at`, checked server-side
> on every request. Do not relax the lifetimes on the grounds that "the cookie
> dies on close" — for a good share of users it does not.

---

## 5. Ending a session

| Path | Effect |
|---|---|
| Sign out | `revoke_session` — sets `Revoked_at`, deletes the cookie. Idempotent, always 200 |
| Password change | `revoke_all_for_account(except_session_id=current)` — every *other* browser is signed out; the one that made the change stays in |
| Deactivation | `revoke_all_for_account` — and `resolve_session` refuses an inactive account anyway |
| Idle expiry | `Expires_at` passes with no activity |
| Ceiling expiry | `Expires_at` reaches `Created_at + absolute` |

A cookie kept from before a sign-out does not work afterwards: `resolve_session`
filters on `revoked_at IS NULL` before anything else.

### Why the last two are worth telling apart

An **idle** expiry is the system working as intended. A **ceiling** expiry signs
somebody out *while they are working*, and no amount of activity prevents it —
it is the one expiry that interrupts a person mid-task.

`expiry_reason(session)` distinguishes them by where `Expires_at` landed:
renewal clamps at `Created_at + absolute` exactly, so a session that reached its
ceiling carries an expiry equal to it. `session_stats` reports the split, and it
is the evidence that would justify changing `SESSION_MAX_LIFETIME`.

---

## 6. Observability

Structured events on the **`login.sessions`** logger, formatted by
`config/observability.py` and restricted to its `SAFE_LOG_FIELDS` allowlist —
there is no path from here to a token, a hash, an email or an IP reaching the
log stream.

| Event | When |
|---|---|
| `session.issued` | Sign-in. Carries `remember`, `ttl_seconds` |
| `session.renewed` | A renewal that actually moved the expiry |
| `session.at_ceiling` | A renewal that **could not** move — the only advance warning that this person will be signed out mid-task |
| `session.rejected` | A dead cookie was presented. `reason`: `expired_idle`, `expired_ceiling`, `account_inactive`, or `unknown` (DEBUG only — see below) |
| `session.revoked` | Sign-out |
| `session.revoked_bulk` | Password change or deactivation. Carries `row_count` — a spike is worth noticing |

Volume is low by construction: renewal is throttled to once per 5 minutes per
session, so a busy console emits a handful an hour, not one per request.

`reason="unknown"` is logged at **DEBUG**, not INFO, and deliberately: it is the
one rejection whose volume a stranger controls. A revoked cookie and a
fabricated one look identical at that point, and anybody can send the latter as
fast as they like.

Tune with `SESSION_LOG_LEVEL`.

### Commands

```sh
python manage.py session_stats              # live/dead, ceiling split, sign-in rate
python manage.py session_stats --days 30
python manage.py prune_login_sessions --dry-run
python manage.py prune_login_sessions       # 30-day retention, batched
```

`prune_login_sessions` deletes a row only when it expired before the cutoff
**and**, if it was ever revoked, the revocation was before the cutoff too. A
session revoked yesterday whose `Expires_at` passed six weeks ago is kept —
that is the row somebody asking "why was I signed out?" needs, and a naive
"expired long ago" filter deletes it.

---

## 7. Deploying a change to this

The table is unmanaged. **Django will not create or alter it**, and
`makemigrations` will not notice a field you add.

1. Write the SQL to `backend/sql/YYYY-MM-DD_<what>.sql` — additive, idempotent,
   safe to re-run, with the inspect/apply/verify shape the existing file uses.
2. Add the same statement to `apply_login_tables`, which is idempotent and is
   what the test-database runner uses.
3. **Apply it to every environment before the code that reads the column
   ships.** Neon branches are separate databases; staging and production do not
   inherit each other's schema.

Getting (3) wrong is not a graceful degradation. A missing column that
`issue_session` writes and `renewal_target` reads means every login 500s *and*
every authenticated request fails — a total outage, not a partial one.

---

## 8. Things deliberately not done

Each of these was considered and rejected; if you are about to add one, know
what it was weighed against.

- **JWT access/refresh tokens.** Would cost immediate revocation. See §1.
- **A second auth architecture.** The API gate admits *either* a `kbc_session`
  cookie or a Django `contrib.auth` session, because the admin site and chat
  already existed. That is two identities into one gate, not two session
  systems.
- **Frontend presence/activity tracking.** Renewal treats any authenticated
  request as activity, polling included. This is a known limitation: a page left
  open on a timer keeps its session alive without a person present. The absolute
  ceiling is what bounds the consequence.
- **Session rotation on renewal.** Renewal extends the same token. Rotating
  would mean a window where two tabs hold different tokens for one session.

---

## 9. Where the code is

| | |
|---|---|
| Lifetimes, policy | `login/security.py` |
| Issue, resolve, touch, revoke, cookies | `login/sessions.py` |
| Inbound/outbound wiring | `login/middleware.py` |
| Sign-in, sign-out, `/me` | `login/views.py` |
| SSO sign-in | `login/microsoft_sso.py` |
| API prefix gate | `login/api_gate.py` |
| Schema | `login/management/commands/apply_login_tables.py`, `backend/sql/` |
| Operations | `login/management/commands/{session_stats,prune_login_sessions}.py` |
| Tests | `login/tests.py` (HTTP), `login/tests_unit.py` (logic), `login/tests_api_gate.py` |
| Frontend | `hooks/useAuth.tsx`, `lib/sessionExpiry.ts`, `components/feature/RequireAuth.tsx` |

The frontend never treats anything local as proof of a session: `useAuth` starts
signed-out and resolves identity only from `/login_api/me/`, because the cookie
is HttpOnly and the server is the only authority. `lib/sessionExpiry.ts` wraps
`window.fetch` so a 401 from a gated API surfaces once as "your session has
ended" rather than as forty broken panels.
