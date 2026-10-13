"""FCM HTTP v1 transport. Contains no credentials and performs no work on import."""
import json
from dataclasses import dataclass
from pathlib import Path
import requests
from google.auth.exceptions import GoogleAuthError

SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']

@dataclass(frozen=True)
class SendResult:
    state: str
    provider_id: str = ''
    retry_seconds: int = 60

class FcmSender:
    def __init__(self, credential_path, project_id, *, http=None):
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
        info = json.loads(Path(credential_path).read_text())
        if (info.get('type') != 'service_account' or info.get('project_id') != project_id
                or info.get('token_uri') != 'https://oauth2.googleapis.com/token'):
            raise ValueError('Unexpected notification credential configuration.')
        self.project_id = project_id
        self.credentials = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        self.http = http or requests.Session()
        self.auth_request = Request(session=self.http)

    def send(self, token, notification, *, validate_only=False):
        # Only opaque IDs and generic wording leave the LMS. Message bodies and
        # learner names never appear on a lock screen or in provider diagnostics.
        data = {'notificationId': str(notification.pk), 'accountId': str(notification.account_id),
                'screen': 'notifications'}
        message = {'token': token, 'notification': {'title': 'KBC Learn', 'body': notification.body},
                   'data': data, 'android': {'priority': 'high', 'ttl': '600s',
                       'restricted_package_name': 'com.kentbusinesscollege.learn',
                       'notification': {'channel_id': 'kbc-' + notification.category + '-v1',
                                        'tag': 'kbc-' + str(notification.pk), 'visibility': 'PRIVATE'}}}
        try:
            if not self.credentials.valid:
                self.credentials.refresh(self.auth_request)
            result = self.http.post('https://fcm.googleapis.com/v1/projects/' + self.project_id + '/messages:send',
                headers={'Authorization': 'Bearer ' + self.credentials.token},
                json={'message': message, 'validate_only': validate_only}, timeout=(5, 20), allow_redirects=False)
            payload = result.json()
        except GoogleAuthError:
            return SendResult('configuration-error')
        except (requests.RequestException, ValueError):
            return SendResult('retry')
        if not isinstance(payload, dict):
            return SendResult('retry')
        if result.status_code == 200 and isinstance(payload.get('name'), str):
            return SendResult('sent', payload['name'][:200])
        codes = {detail.get('errorCode') for detail in payload.get('error', {}).get('details', [])
                 if isinstance(detail, dict)}
        if 'UNREGISTERED' in codes:
            return SendResult('invalid-device')
        if result.status_code in {401, 403}:
            return SendResult('configuration-error')
        if result.status_code == 429 or result.status_code >= 500:
            try:
                delay = max(60, min(3600, int(result.headers.get('Retry-After', '60'))))
            except ValueError:
                delay = 60
            return SendResult('retry', retry_seconds=delay)
        return SendResult('rejected')
