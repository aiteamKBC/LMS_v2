"""Meeting HTTP delivery and tracking; existing public decorators stay at the facade."""


def with_schedule_change_notice(
    response, live_session_id, before, request=None, notify=False, series_before=None, *, JsonResponse,
    LIVE_SESSIONS_TABLE, authoring_fetch_all, clean_str, held_schedule_snapshot, json,
    load_issue_change_notice, load_lms_email_requested, load_may_send_schedule_email, load_send_change_emails,
    teams_series_invited, uuid,
):
    """Add a signed before/after record to a successful schedule update, and send its emails.

    The update overwrites the occurrence rows, so this is the last moment the
    dates learners were told about still exist. The emails go from the server,
    as the create's do, so closing the browser cannot lose them:

    * ``scheduleEmail`` -- the change email to everyone on the calendar, when
      the author chose to tell them (``notify``).
    * ``addedEmail`` -- the full schedule to the people this save put on the
      calendar and nobody else, read from the stored roster before and after.

    Only for a caller who may send mail; anybody else gets the notice alone and
    the browser's own request meets the schedule-email endpoint's refusal. A
    mail problem rides beside the saved calendar, never in place of it, and the
    browser can retry it through the same ledger without emailing anyone twice.

    The two audiences never overlap. Somebody this save added was never told the
    old dates, so a "was / now" describes nothing they knew: they get the full
    schedule and are left out of the change email.

    The update itself decides whether there was anything to announce. Its body
    carries ``announced`` (False when the dates did not really change -- a retry
    of an update that already landed, or an invitation-only edit) and
    ``changeId``, the stable name of the logical change, which becomes the
    notice's ledger key so a retry of the same change is never emailed twice.

    The added people's full schedule goes under a key of its own per save,
    never the calendar's creation key: somebody removed and later added back is
    a new membership and must be sent the schedule again, while a retry of the
    same add finds them already on the stored roster and adds nobody.
    """
    issue_change_notice, = load_issue_change_notice()
    if getattr(response, 'status_code', 0) != 200:
        return response
    try:
        body = json.loads(response.content)
    except ValueError:
        return response
    if not (isinstance(body, dict) and body.get('updated')):
        return response
    if body.get('announced') is False:
        notify = False
    body['changeNotice'] = issue_change_notice(live_session_id, before, held_schedule_snapshot(live_session_id),
                                               notice_id=clean_str(body.get('changeId')) or None)
    may_send_schedule_email, = load_may_send_schedule_email()
    lms_email_requested, = load_lms_email_requested()
    body['lmsEmailRequested'] = bool(lms_email_requested(request) and may_send_schedule_email(request))
    if body['lmsEmailRequested']:
        send_change_emails, send_creation_emails = load_send_change_emails()
        added = []
        if series_before is not None:
            saved = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
            was = teams_series_invited(series_before)
            added = sorted(teams_series_invited(saved[0]) - was) if saved else []
        if notify and body['changeNotice']:
            body['scheduleEmail'] = send_change_emails(live_session_id, body['changeNotice'], exclude=added)
        if added:
            added_key = uuid.uuid4().hex
            body['addedPeople'] = added
            body['addedEmailKey'] = added_key
            body['addedEmail'] = send_creation_emails(live_session_id, added=added, key=f'{live_session_id}+{added_key}')
    return JsonResponse(body, status=response.status_code)
