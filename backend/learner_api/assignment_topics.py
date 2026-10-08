"""Topic identity and sequential submissions within one curriculum component."""
import json


def topic_id(value):
    if value in (None, ''):
        return ''
    if not isinstance(value, str) or value not in {'1', '2', '3'}:
        raise ValueError('Choose Topic 1, 2 or 3.')
    return value


def definitions(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    if not isinstance(value, list) or not value:
        return []
    result = []
    for identity in ('1', '2', '3'):
        row = next((item for item in value if isinstance(item, dict) and str(item.get('id')) == identity), {})
        resources = row.get('resources') if isinstance(row.get('resources'), list) else []
        result.append({'id': identity, 'name': str(row.get('name') or ''),
                       'question': str(row.get('question') or ''),
                       'instructions': str(row.get('instructions') or ''),
                       'resources': [file for file in resources if isinstance(file, dict)
                                     and str(file.get('url') or '').startswith(('https://', 'http://', '/curriculum_api/curriculum/uploads/'))]})
    return result


def topics_from_settings(settings):
    topics = definitions((settings or {}).get("assignmentTopics"))
    if topics:
        return topics
    settings = settings or {}
    url = settings.get("assignmentFileUrl") or settings.get("uploadedFileUrl")
    resources = [{"fileName": settings.get("assignmentFileName") or settings.get("uploadedFileName") or "Assignment file",
                  "url": url, "size": settings.get("uploadedFileSize") or 0,
                  "contentType": settings.get("uploadedFileContentType") or ""}] if url else []
    return definitions([{"id": "1", "question": settings.get("assignmentContent") or settings.get("assignmentBrief") or "",
                         "instructions": settings.get("submissionInstructions") or "", "resources": resources}])


def configured_topics(cur, component_id):
    cur.execute('SELECT settings_json FROM curriculum.components WHERE id = %s AND type = %s', [component_id, 'assignment'])
    row = cur.fetchone()
    settings = row[0] if row else {}
    if isinstance(settings, str):
        settings = json.loads(settings)
    return topics_from_settings(settings)


def prepare_topic_save(cur, payload):
    """Serialize topic selection; a delayed save cannot unlock submitted work."""
    identity = topic_id(payload.get('assignmentTopicId'))
    if not identity:
        return ''
    if payload.get('activityType') != 'assignment':
        raise ValueError('Topics are only available for assignments.')
    topic = next((item for item in configured_topics(cur, payload['activityId']) if item['id'] == identity), None)
    if not topic or not (topic['question'].strip() or topic['resources']):
        raise ValueError('This topic is not available. Reload the assignment instructions.')
    cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',
                [json.dumps([payload['learnerKind'], str(payload['learnerId']), payload['activityId']])])
    cur.execute('''SELECT assignment_topic_id, status, full_submission FROM "Learner".learning_reflection_submissions
        WHERE learner_kind=%s AND learner_id=%s AND activity_type='assignment' AND activity_id=%s ORDER BY assignment_topic_id''',
        [payload['learnerKind'], str(payload['learnerId']), payload['activityId']])
    existing = cur.fetchall()
    for other, status, _content in existing:
        if other == "":
            raise ValueError("This assignment has an existing legacy submission. Open its saved form.")
        if other != identity and status in ('draft', 'rejected', 'needs_revision'):
            raise ValueError('Resume and submit your current topic before starting another.')
    inherit_coaching_booking(payload, existing)
    payload['assignmentTopicId'] = identity
    payload['assignmentTopicName'] = topic['name']
    payload['assignmentQuestion'] = topic['question']
    # These fields describe a topic; the existing marking rules remain authoritative.
    return identity


def inherit_coaching_booking(payload, rows):
    """Reuse this component's owned MCM without modifying submitted topics."""
    from .calendar import _learner_calendar_record
    from .monthly_assignment import month_bounds
    monthly = payload.get('monthlyAssignment')
    if not isinstance(monthly, dict) or not month_bounds(monthly.get('month'))[0]:
        return
    for identity, _status, content in rows:
        if not identity or identity == payload.get('assignmentTopicId'):
            continue
        content = json.loads(content) if isinstance(content, str) else content or {}
        saved = content.get('monthlyAssignment') or {}
        key = saved.get('meetingKey')
        if not key or saved.get('month') != monthly.get('month'):
            continue
        record = _learner_calendar_record(payload['learnerKind'], int(payload['learnerId']), key)
        if (record and record.event_type == 'mcr' and record.scheduled_date
                and record.status in ('scheduled', 'in-progress', 'completed', 'awaiting-signature')):
            payload['monthlyAssignment'] = {**monthly, 'meetingKey': key}
            return


STATUS_PRIORITY = {'accepted': 5, 'partial': 4, 'submitted_for_tutor_review': 3, 'rejected': 2, 'needs_revision': 2, 'draft': 1}


def aggregate_statuses(rows):
    """A later optional draft must not make a submitted component incomplete."""
    result = {}
    for row in rows:
        kind, activity, status = row[:3]
        history = row[3] if len(row) > 3 else None
        key = (kind, activity)
        previous = result.get(key)
        history = json.loads(history) if isinstance(history, str) else history
        count = len(history or []) + int(bool(status) and status != 'draft')
        if previous is None:
            result[key] = {'activityType': kind, 'activityId': activity, 'status': status,
                           **({'submissionCount': count} if kind == 'assignment' else {})}
        else:
            if kind == 'assignment':
                previous['submissionCount'] += count
            if STATUS_PRIORITY.get(status, 0) > STATUS_PRIORITY.get(previous['status'], 0):
                previous['status'] = status
    return list(result.values())
