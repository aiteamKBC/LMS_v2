# Teams meeting permissions: 403 runbook

For: Microsoft 365 / Teams administrators and LMS staff handling a Teams save
that reports `HTTP 403 Forbidden` from Microsoft Graph.

## 1. What the LMS calls

| Operation | Graph call | Permission (application) |
| --- | --- | --- |
| Save invitations (who is invited) | `PATCH users/{organiser}/events/{id}` (attendees, under `Prefer: outlook.send-invitations="none"`), and `POST .../events/{id}/forward` only for **Save and invite added people** | `Calendars.ReadWrite` |
| Change dates | `PATCH users/{organiser}/events/{id}` (recurrence / instances) | `Calendars.ReadWrite` |
| Meeting options (lobby, recording, transcription, language, presenter and co-organiser roles) | `PATCH users/{organiserObjectId}/onlineMeetings/{meetingId}` | `OnlineMeetings.ReadWrite.All` **plus a Teams application access policy granted to the organiser** |
| Cancel | Only the explicit Cancel action (unchanged) | `Calendars.ReadWrite` |

The organiser object ID comes from the meeting's join link (`Oid`), or from
`MICROSOFT_TEAMS_ORGANIZER_ID` when the organiser is the configured default.

## 2. What changed in the LMS

- A save that only adds or removes invitees **no longer sends** the
  onlineMeeting PATCH. Before this change every save re-sent all meeting
  options, so a missing organiser permission blocked unrelated invitation
  saves (the incident with organiser `737679b4-8eac-4fe9-a491-76d8cdf65f6d`).
- Options are sent only for the group that changed: **settings** (lobby,
  recording/auto-record/transcription, language) or **roles** (presenters,
  co-organisers, sent with the full attendee list as Microsoft requires).
- If Microsoft refuses an options write on an **existing** meeting, the
  invitations and dates still save; the response is marked `partial`, the
  refused group is recorded as pending on the series, and a later settings or
  date save retries it. A refused settings change is not saved in the LMS as if
  it had been applied.
- A meeting **created by the same save** (new calendar, new weekday series, a
  session recreated on its own event) still publishes no invitations while its
  options are refused, so nobody is invited to a meeting at tenant defaults.
- New read-only diagnostic: **Check Microsoft permissions** in the meeting
  dialog, `GET /curriculum_api/curriculum/teams-meetings/<id>/permission-check/`
  (staff/admin), and `python manage.py check_teams_permissions <id>`.
- A settings change Microsoft refuses keeps **what the author asked for** on
  the pending marker (`requested`), so a retry sends that change, not the old
  values. Markers saved before this change have no `requested`; a retry of
  one re-sends the settings saved in the LMS and says the earlier change was
  not kept.
- Every refused Graph write on these paths is **recorded durably** (section 4).
- The meeting dialog shows **Meeting settings: Saved / Pending Microsoft
  update / Failed**, with **Retry Microsoft update** (section 5).

## 3. Root cause status for the incident

**Still not confirmed: the 403 is intermittent and its cause is unknown.**
Evidence: the refused call was
`PATCH users/737679b4-8eac-4fe9-a491-76d8cdf65f6d/onlineMeetings/...`, HTTP 403,
`code=Forbidden`, `message=insufficient permissions`,
request-id `2b7979e0-6f5a-411b-b0fa-6a087e438bc5`.

Confirmed since (by the administrators, not by the LMS):

- The app's permissions are correct, including `OnlineMeetings.ReadWrite.All`
  (Application) with admin consent.
- The application access policy works for the organiser (Khaled Ashraf).
- All 46 of the organiser's meetings are readable by the app.
- Microsoft accepts settings updates on **other** meetings owned by the same
  organiser.

What that rules out: a missing permission, a missing or unassigned access
policy, and a wrong organiser ID are not the cause, because each would refuse
every meeting of this organiser, reads included. Still open, none proven:
something on the refused meeting itself (a meeting option locked by a
template, sensitivity label or the organiser's Teams meeting policy for that
setting; a meeting Microsoft has re-issued), a transient refusal on
Microsoft's side, or a particular setting group in the request. Microsoft
support can trace the request IDs the LMS now keeps (section 4).

The LMS-side mitigation does not depend on the cause: a save that only
changes who is invited sends no onlineMeeting PATCH at all, so this 403 can
no longer block an invitation save; settings are sent only when they change;
and a refusal is recorded, shown and retryable instead of failing the save.

The diagnostic (section 6) still helps per meeting: **if the read is refused
too, the policy is missing for this organiser**; if the read succeeds and the
write is refused, see 6c.

## 4. The durable failure log

Every refused Graph write on the Teams save paths is recorded by
`backend/curriculum_api/teams_graph_failure_log.py`:

- always as a structured warning in the process log (logger
  `curriculum_api.teams_graph_failure_log`, message `Teams Graph write
  refused: ...`);
- and, once `backend/sql/2026-10-08_teams_graph_failures.sql` is applied, as a
  row in `curriculum.teams_graph_failures`.

Each record has: meeting series (`live_session_id`), onlineMeeting ID,
organiser email and object ID, operation (`online_meeting_options_patch`,
`online_meeting_resolve`, `online_meeting_options_confirm`,
`calendar_event_save`), option groups, UTC time, HTTP status, Graph error
code and message, **Microsoft request ID**, Graph method and path, and the
LMS's own request ID. It never holds the token, client secret, request body
or learner data; anything shaped like a credential is redacted.

Queries for the investigation are at the bottom of the SQL file (refusals per
organiser and operation; request IDs for one series to give Microsoft
support). A failure to write the log is itself only logged: it never fails
a save.

## 5. What staff see: Saved / Pending Microsoft update / Failed / Retry

The meeting dialog shows **Meeting settings** with one state:

| State | Meaning |
| --- | --- |
| Saved | Nothing is waiting on Microsoft. |
| Pending Microsoft update | Settings or roles are waiting, with no refusal on record (for example an accepted write Microsoft did not confirm on read-back). |
| Failed | Microsoft refused the last attempt; the HTTP status, code, request ID and time are shown. |

**Retry Microsoft update** (shown for Pending and Failed) calls
`POST /curriculum_api/curriculum/teams-meetings/<id>/retry-options/`
(staff/admin, CSRF-protected). It re-sends **only** the pending groups to
every Teams meeting the series owns (the series meeting, each weekday's, each
session on its own event), then **reads each meeting back**. A group is
reported saved only when Microsoft's read-back shows the requested values;
an accepted write whose read-back fails or disagrees stays pending/failed.
Retry writes no calendar event, moves no date, sends no Microsoft or LMS
email, and never cancels or deletes anything. If someone saves the meeting
while Microsoft is answering, Retry does not overwrite that newer save.

A "could not be confirmed" save (`teams_calendar_unverified`) shows Failed
without Retry: that is finished by updating the Teams calendar itself.

## 6. Administrator steps (read-only first)

Run the LMS diagnostic first (it only reads). Then, in Teams PowerShell:

```powershell
Connect-MicrosoftTeams
# a) Which policy does the organiser have?
Get-CsOnlineUser -Identity "737679b4-8eac-4fe9-a491-76d8cdf65f6d" |
  Select-Object UserPrincipalName, ApplicationAccessPolicy, TeamsMeetingPolicy
# b) Which policies exist, and which app IDs do they contain?
Get-CsApplicationAccessPolicy | Select-Object Identity, AppIds
```

a/b) Confirmed in place for the incident organiser (section 3). For another
organiser: if it has no policy containing the LMS app's client ID (shown
by the diagnostic), and the organisation agrees, grant it **for that user**:

```powershell
Grant-CsApplicationAccessPolicy -PolicyName "<policy containing the LMS client ID>" -Identity "737679b4-8eac-4fe9-a491-76d8cdf65f6d"
```

Allow up to 30 minutes, run the diagnostic again, then save the meeting's
settings again to apply the pending options. The LMS never grants this itself.
A tenant-wide grant (`-Global`) is an organisational decision, not a fix the
LMS requires.

c) If the diagnostic shows the meeting **is** readable but writes are refused:
check (read-only) the organiser's Teams meeting policy
(`Get-CsTeamsMeetingPolicy -Identity <policy>` for cloud recording,
transcription and presenter settings), any meeting template or sensitivity
label that locks meeting options, and give Microsoft support the request ID.
Changing one setting group at a time in the LMS shows which group is refused.

d) In Entra ID > App registrations > (LMS client ID) > API permissions, confirm
`OnlineMeetings.ReadWrite.All` (Application) has admin consent. The diagnostic
reads the granted roles from the app token; it never shows the token.

## 7. Deployment checklist

1. No Django migration. Recommended: the owner applies
   `backend/sql/2026-10-08_teams_graph_failures.sql` (one new table, nothing
   altered). Without it the failure log stays in the process log only.
   Pending option groups stay in the existing
   `curriculum.live_sessions.warnings` JSON column.
2. Deploy backend and frontend together (the dialog reads `optionsApplied`,
   `optionsPending`, `partial`, the summary's `microsoftUpdate` and the
   retry endpoint).
3. Restart every backend service that serves `/curriculum_api/`.
4. With the affected organiser's meeting: run the diagnostic (read-only),
   record the result, then follow section 6.
5. Live verification (needs explicit approval, it writes to Microsoft): add one
   synthetic invitee with **Save invitations** and confirm no onlineMeeting
   PATCH and no failure record are logged, nobody is emailed, and the invitee
   appears on the event. Then press Retry on a meeting showing Failed and
   confirm the state, the read-back and the log record.

## 8. Rollback

Revert the files listed in the change summary and restart. No data migration
to reverse. Pending markers left in `live_sessions.warnings` are ordinary
warning entries the previous code overwrites on its next successful save; the
extra `requested`, `attempts` and `lastAttemptAt` keys are ignored by it.
`curriculum.teams_graph_failures` can stay (nothing reads it after rollback)
or be dropped by the owner. After rollback every save re-sends all options
again, so an intermittent 403 can again fail an invitation save.

## 9. Limits

- Verified with automated tests and Microsoft's documentation only; no live
  Graph call was made while building this.
- The cause of the intermittent 403 is unknown (section 3). The LMS change
  contains its effect; it does not stop Microsoft refusing a real settings
  change.
- Retry's read-back compares lobby, recording, auto-record, transcription and
  roles; the spoken language is compared only when Microsoft returns it.
- An additional week meeting saves its warning as a sentence, so its pending
  marker keeps no `requested` settings; Retry then re-sends the settings saved
  in the LMS and says so.
- Coach bookings (`coach_api`) still re-apply options on every sync; they are
  a separate workflow and were not changed.
- An attendee-only save no longer updates `onlineMeeting.participants`. The
  person is on the calendar invitation; whether the "People invited" lobby
  scope admits them straight away, without a later roles save, is not
  documented and needs a live check.
- Microsoft does not document email behaviour for the onlineMeeting PATCH; the
  LMS still sends no invitations through it.
- The attendance sync still re-applies options once when it first resolves a
  meeting's ID (unchanged behaviour).
