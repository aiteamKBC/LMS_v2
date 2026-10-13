"""Repeatable synthetic transport measurement; no database/network reads."""
import json
from .case_file_reviews import project_reviews

OLD_FIELDS = set('''id eventKey learnerId enrolmentId type source sequence reviewTemplateId reviewInstanceId
reviewTypeName reviewTypeCode occurrenceNumber title date targetDate scheduledDate scheduledTime year month
 dayOfMonth startHour endHour timeLabel isTimeEstimated durationMinutes status reviewCompletedAt meetingProvider
notes reviewerName ownerName hasReviewForm hasTranscript hasAttendance'''.split())


def measure_payloads():
    events = []
    for index in range(19):
        progress = index < 7
        event = dict.fromkeys(OLD_FIELDS, None)
        event.update({
            'id': f'imported-review:{1000 + index}', 'eventKey': f'imported-review:{1000 + index}',
            'learnerId': '101', 'enrolmentId': '201', 'type': 'review' if progress else 'coaching',
            'source': 'progress-review' if progress else 'mcr', 'sequence': index + 1,
            'reviewTypeName': 'Progress Review' if progress else 'Monthly Coaching Meeting',
            'reviewTypeCode': 'progress_review' if progress else 'mcm', 'occurrenceNumber': index + 1,
            'title': 'Progress Review' if progress else 'Monthly Coaching Meeting',
            'date': '2026-10-12', 'targetDate': '2026-09-12', 'scheduledDate': '2026-10-12',
            'scheduledTime': '09:30', 'year': 2026, 'month': 9, 'dayOfMonth': 12, 'startHour': 9.5,
            'endHour': 10.5, 'timeLabel': '09:30 - 60 min', 'isTimeEstimated': False, 'durationMinutes': 60,
            'status': 'completed' if index < 5 else 'scheduled',
            'reviewCompletedAt': '2026-10-13' if index < 5 else None,
            'meetingProvider': 'Microsoft Teams', 'notes': 'Synthetic schedule note.',
            'reviewerName': 'Synthetic Coach', 'ownerName': 'Synthetic Coach',
            'hasReviewForm': True, 'hasTranscript': False, 'hasAttendance': False,
        })
        events.append(event)
    old = {'events': events, 'reviewGenerationIssues': []}
    new = project_reviews(events)
    size = lambda payload: len(json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    old_size, new_size = size(old), size(new)
    return {'fixture': '19 synthetic rows; compact UTF-8 JSON; uncompressed',
            'oldBytes': old_size, 'newBytes': new_size, 'reductionPercent': round((1 - new_size / old_size) * 100, 2),
            'removedRowFields': sorted(OLD_FIELDS - set(new['reviews'][0])), 'summary': new['summary']}
