# Microsoft Teams / Graph access request for KBC LMS

## Purpose

KBC LMS creates coach meetings as Microsoft Teams calendar events and needs to retrieve the meeting recording and transcript after the meeting finishes.

Affected meeting types:

- Progress Reviews
- Monthly Coaching Meetings
- Catch-up sessions
- Student Support sessions

The LMS now creates these meetings on the coach/owner mailbox as the organizer, with the learner as an attendee. For Progress Reviews, the employer contact is also invited as an attendee when an employer email is available.

## Current failure

The LMS can create and join the Teams meeting, but it cannot resolve the online meeting for recording/transcript lookup.

Observed Microsoft Graph error:

```text
HTTP 403
No application access policy found for this app on the user
```

This means the app registration has not been granted Teams application access policy for the coach/organizer user.

## Application to configure

Please configure the application used by the backend variable:

```text
MICROSOFT_GRAPH_CLIENT_ID
```

Do not use the SSO/login app or learner calendar OAuth app:

```text
MICROSOFT_SSO_CLIENT_ID
MICROSOFT_CLIENT_ID
```

Those are separate registrations and are not currently suitable for Teams recording/transcript access.

## Required Microsoft Graph application permissions

In Microsoft Entra admin center:

1. Go to App registrations.
2. Open the app whose Application/client ID matches `MICROSOFT_GRAPH_CLIENT_ID`.
3. Go to API permissions.
4. Add Microsoft Graph application permissions.
5. Grant admin consent for the tenant.

Required permissions:

```text
Calendars.ReadWrite
OnlineMeetings.ReadWrite.All
OnlineMeetingTranscript.Read.All
OnlineMeetingRecording.Read.All
```

Notes:

- `Calendars.ReadWrite` is used to create calendar-backed Teams events.
- `OnlineMeetings.ReadWrite.All` is used to resolve/manage the online meeting and apply Teams meeting options.
- `OnlineMeetingTranscript.Read.All` is used to list/read transcripts.
- `OnlineMeetingRecording.Read.All` is used to list/read recordings.

## Required Teams application access policy

The app also needs a Teams application access policy granted to every coach/organizer mailbox whose meetings the LMS must read.

Run in Microsoft Teams PowerShell as a Teams/M365 admin:

```powershell
Connect-MicrosoftTeams

New-CsApplicationAccessPolicy `
  -Identity "KBC-LMS-CoachMeetings" `
  -AppIds "<MICROSOFT_GRAPH_CLIENT_ID>" `
  -Description "Allow KBC LMS to create/read coach Teams meetings, transcripts and recordings"

Grant-CsApplicationAccessPolicy `
  -PolicyName "KBC-LMS-CoachMeetings" `
  -Identity "<coach-user-principal-name-or-object-id>"
```

Repeat the `Grant-CsApplicationAccessPolicy` command for each coach account that can organize LMS meetings.

Example:

```powershell
Grant-CsApplicationAccessPolicy `
  -PolicyName "KBC-LMS-CoachMeetings" `
  -Identity "coach@example.com"
```

Optional tenant-wide grant, if approved by your security policy:

```powershell
Grant-CsApplicationAccessPolicy `
  -PolicyName "KBC-LMS-CoachMeetings" `
  -Global
```

Microsoft notes that application access policy changes can take up to 30 minutes to take effect in Microsoft Graph.

## Coach/organizer account requirements

For every coach organizer:

- The user must exist in the same Microsoft tenant.
- The user must have a valid Exchange/Outlook mailbox.
- The user must be licensed/enabled for Teams meetings.
- Teams meeting policy must allow recording and transcription.

## Validation after configuration

After permissions and policy have been applied, wait up to 30 minutes, then test:

1. In LMS, open a scheduled coach Progress Review or MCM.
2. Confirm the Teams meeting has a join link.
3. After the meeting ends and Teams finishes processing, open the Recording & Transcript panel.
4. Expected result:
   - It should no longer show: `Microsoft Graph could not resolve this Teams meeting`.
   - It should either show the transcript/recording, or a normal "not returned by Teams yet" message while Microsoft is still processing.

## References

- Microsoft Graph: configure application access policy for online meetings  
  https://learn.microsoft.com/en-us/graph/cloud-communication-online-meeting-application-access-policy

- Microsoft Teams PowerShell: `New-CsApplicationAccessPolicy`  
  https://learn.microsoft.com/en-us/powershell/module/microsoftteams/new-csapplicationaccesspolicy

- Microsoft Teams PowerShell: `Grant-CsApplicationAccessPolicy`  
  https://learn.microsoft.com/en-us/powershell/module/microsoftteams/grant-csapplicationaccesspolicy

- Microsoft Graph: create calendar event permissions  
  https://learn.microsoft.com/en-us/graph/api/user-post-events

- Microsoft Graph: create/get online meetings and required application policy  
  https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings

- Microsoft Graph: list transcripts  
  https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts

- Microsoft Graph: list recordings  
  https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-recordings
