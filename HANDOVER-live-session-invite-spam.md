# Live session booking — two invitation defects

Branch `lotfy`, uncommitted. Both defects are in the module live-session
booking flow and were found together; they are independent fixes.

- **A — duplicate invitations.** Every invitee got one email per session.
- **B — attendee list disclosure.** Each invitation listed all 24 invitees'
  email addresses to every recipient.

---

# A — Duplicate Teams invitations

## Symptom

Creating a module with a recurring live session sent every invitee one email
**per session**, not one for the series. Observed on a 12-session module with 24
invitees: each person received 12 emails.

## Cause

`apply_teams_occurrence_shifts` (`backend/curriculum_api/views.py:1855`)
reconciles holiday-shifted sessions after the series exists. Graph recurrences
can only be unbroken weekly patterns, so any session the wizard moved off a
holiday has to be corrected instance by instance:

```python
for instance, target in reversed(paired_instances):
    ...
    microsoft_graph_request('PATCH', f'users/{owner_key}/events/{instance_key}', ...)
```

Graph emails every attendee on each write to a meeting. Twelve instances, 24
invitees, 288 messages — for changes the original series invitation already
reflects.

The existing guard does not help:

```python
if current_key and current_key == target_key:
    continue
```

The recurrence is built from the anchor date (`views.py:1698-1700`), so a single
holiday shift displaces every later instance. None match, so all get patched.

### What the Graph data does and does not show

```
events with subject 'Martech - Thur' in organizer mailbox : 1  (seriesMaster)
occurrences in DB                                         : 12
distinct meetings / distinct events                       : 1 / 1
distinct joinUrl across all 12                            : 1
instances modified after creation                         : 11 / 12
```

Confirmed: the series was created correctly — one event, one meeting, one join
URL shared by all twelve. Per-instance `event.id` values differ, which is normal.
A three-week gap between the first instance (`2026-09-16`) and the second
(`2026-10-07`) shows the wizard did shift sessions.

Not confirmed: that those 11 modifications are what produced the 12 emails.
`lastModifiedDateTime` changes for reasons other than an explicit patch, no email
count was measured against a mailbox, and 11 of the 12 are type `occurrence`
rather than `exception`. The causal link below is reasoned from the code path and
Graph's documented behaviour, not measured.

## Fix

`microsoft_graph_request` (`backend/coach_api/views.py:851`) now accepts
`extra_headers`; Authorization cannot be overridden.

`backend/curriculum_api/views.py:1473`:

```python
GRAPH_SILENT_INVITE_HEADERS = {'Prefer': 'outlook.send-invitations="none"'}
```

Applied at two sites inside the reconciliation loop:

- `:1959` — the per-instance `PATCH`.
- `:1976` — the surplus-instance `DELETE`, which was sending a cancellation on
  the same loop. Easy to miss; it belongs to the same problem.

Changes still reach every calendar. No mail is sent.

Single-occurrence reschedules at `:2022` and `:2068` were deliberately left
alone — a user asked for that specific change and should be notified.

## Not verified

The header was not confirmed to suppress mail in practice. Create a module whose
sessions cross a holiday and check that no update mail arrives. Everything above
that point is confirmed from Graph; this last step is not.

## Scope

This affects any series with a holiday shift, and scales with series length ×
invitee count. A 30-session series with 50 invitees would have sent 1,500 emails.

Existing meetings are unaffected — the fix applies to new writes only.

## Two things ruled out

**Per-person meeting ids.** Exchange stores a copy of an event in each mailbox,
each with its own `id`; only `iCalUId` is stable across mailboxes. Expected, not
a second bug.

**Per-person links.** `joinUrl` is shared by everyone. `webLink` embeds the
per-mailbox `itemid` and therefore differs — also expected. Organizer and
co-organizers differ from attendees in Teams *permissions*, not in link.

## Ruled out: the 23-hour time discrepancy

A separate review flagged Teams as 23 hours behind the stored time from session 5
(29 Oct 2026) onward. It is not a bug. The database holds the same shift:

```
sessions 1-4   23:00 UTC   (16 Oct - 21 Oct)
sessions 5-12  00:00 UTC   (29 Oct - 17 Dec)
```

The boundary is 25 October 2026 — the end of British Summer Time. The session is
pinned to midnight Europe/London: UTC+1 before that date puts it at 23:00 the
previous day, UTC+0 after puts it at 00:00 the same day. The offset moves by one
hour; the date rolls, which makes it read as 23. Graph and the database agree.

Worth a separate look, though: the series starts at **midnight** London time and
the first session falls on a **Tuesday**, on a module named `Martech - Thur`.
That points at the wizard's timezone handling or the entered start time, not at
the recurrence.

---

# B — Invitations disclosed every attendee's address

## Symptom

The invitation Graph sends carries the full attendee list, so each of the 24
invitees received the email addresses of the other 23. The cohort mixes learners
with staff from unrelated employers (`@tradeapps.co.uk`, `@oralieve.co.uk`,
`@greenacresgroup.co.uk`, and others), so this disclosed addresses across
parties with no relationship to each other.

## Cause

`hideAttendees` already existed end to end — column, API payload, and Graph
field. `curriculum_api/views.py:1698` passes it straight through:

```python
'hideAttendees': bool(payload.get('hideAttendees', False)),
```

The frontend hard-coded `false` at every call site, with no control exposed, so
the flag was never once set. Confirmed across the whole table:

```
DB hide_attendees   : False
Graph hideAttendees : False
all 55 series       : False
```

Database and Graph agreeing on every row is what shows the channel itself works:
it faithfully carried the `false` the UI kept sending.

## Fix

Default changed to `true` at the three sites:

- `frontend/src/pages/curriculum/teams-meetings/createCalendarForm.tsx:355`
- `frontend/src/pages/curriculum/teams-meetings/page.tsx:1221`
- `frontend/src/pages/curriculum/module-builder/componentAuthoringModel.ts:123`

Made a default rather than a toggle: disclosing addresses between unrelated
employers is not a per-module preference. The backend still honours an explicit
`false` if a control is added later.

Organizer and co-organizers continue to see the full list. The invitation, the
join URL and everything else are unchanged — only the list is withheld.

## Not verified

The value was confirmed to reach Graph by code path and by the DB/Graph match
across 55 series. A new invitation email was not inspected. Create a module and
check that the received invitation shows no attendee list.

## Scope

New series only. The existing 55 were created with `false` and keep it. Updating
them would mean writing to each meeting, which sends notifications — use the
`Prefer` header from part A if that is ever done.

---

## Unrelated, but noticed

Two things surfaced while investigating that are worth separate tickets:

- The 8 staff in `attendees` are also listed in `co_organizers` on that series —
  duplicated across both fields. Whether that causes a second invitation to them
  was not checked.
