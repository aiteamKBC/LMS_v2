# Organization calendar connection

Imported Microsoft 365 group calendars use an administrator-managed delegated
connection. Authorised LMS staff reuse that connection without signing into
Microsoft for each edit. User-calendar/app-only flows and learner personal
calendar credentials are separate and retain their existing behavior.

The initial connection requests `openid profile offline_access User.Read
Group.ReadWrite.All` through the existing Microsoft SSO registration/callback.
`profile` supplies the immutable object identity required by verification.
Microsoft credentials are entered only in Microsoft's sign-in window. The LMS
stores the renewable credential encrypted with the existing
`CREDENTIAL_ENCRYPTION_KEY`; it never returns tokens to the browser.

## Release

Use the repository's reviewed-main deployment procedure in `AGENTS.md`. Do not
edit deployed source directly.

1. Verify the production checkout, remote, branch, deployed revision and clean
   working tree. Preserve unrelated server changes.
2. Pull the intended merged `main` revision with `--ff-only`; build the frontend.
3. Before the database change, identify the actual backend database target
   without printing credentials. Confirm its backup/restore point and retain the
   previous commit/build and rollback procedure.
4. Inspect `python manage.py migrate curriculum_api 0075 --plan` and the current
   migration history. Review any older pending migrations before proceeding.
5. Apply `python manage.py migrate curriculum_api 0075`. The new operation only
   adds `curriculum.teams_organization_calendar_connections`; it does not change
   meeting, occurrence, learner, attendance or invitation rows.
6. After successful build and reviewed migration steps, restart the backend
   services and verify health and the affected staff/learner workflows.

The connection UI reports a missing migration explicitly and cannot begin
institutional consent until the table is available. No runtime schema repair or
automatic tenant permission/membership change is performed.

## Initial connection and checks

An LMS administrator opens an imported group calendar's existing Teams editor,
then selects **Connect organization calendar**. Choose a Microsoft account
authorised to manage the original group calendars and approve the requested
scopes if Microsoft asks. The flow verifies the account and the selected original
calendar before saving the organisation credential. It keeps the meeting's
original organiser, calendar, IDs and join link; connecting sends no invitations.

The connection applies to imported group calendars in the configured tenant/app.
Every operation still verifies the selected original calendar and saved meeting
identity, and Microsoft still enforces the connected account's group permissions.
An account with access to one group is not proof of access to every other group.

Check each affected calendar's roster/settings and its original-calendar status.
An authorised staff session should see **Connected · renews automatically**
without individual connection controls. Check the saved occurrence/link/history
associations before any deliberately scoped live update. Connecting alone does
not prove Microsoft accepted a subsequent save or delivered notices.

## Renewal, failures and disconnect

Access refreshes on demand. A database transaction/advisory lock serializes
refresh, reconnect and disconnect; concurrent requests reuse the refreshed token.
The refresh response must keep the required scopes and the verified Microsoft
object identity. Rotation replaces the encrypted refresh token atomically.

Confirmed revocation or a required Microsoft interaction marks the connection as
needing an administrator reconnect. Expired shared access is never silently
replaced with app-only access. Temporary provider/network or client-configuration
errors retain the encrypted credential for recovery and report an error.
An unreadable encryption configuration also preserves the ciphertext.

Only an LMS administrator can reconnect or disconnect institutional access.
Disconnect clears its stored credential; it does not cancel meetings, remove
invitees or revoke independent personal connections. Stale admin actions cannot
overwrite or disconnect a newer configuration.

For a source rollback, disconnect first if institutional access must stop, then
restore the previous reviewed commit/build through the normal release procedure.
The additive table can remain; migration reversal deliberately does not delete
stored connection data. Do not drop it as a rollback shortcut.

References: [Microsoft group-calendar permissions](https://learn.microsoft.com/en-us/graph/api/group-update-event?view=graph-rest-1.0),
[ID token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference),
[OIDC scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc).
