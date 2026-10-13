"""Scoped snapshots of the current Aptem review PDFs for Advanced Admin."""

import hashlib
import json
import os
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings

from .aptem_review_signatures import progress_review_pdf_signatures


APTEM_ORIGIN = 'https://kentbusinesscollege.aptem.co.uk'
MAX_PDF_BYTES = 25 * 1024 * 1024


class AptemUnavailable(Exception):
    """Aptem did not return a usable, scoped review document."""


class _LoginInputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        if tag == 'input':
            item = dict(attrs)
            if item.get('name'):
                self.values[item['name']] = item.get('value', '')


def _numeric_id(value):
    value = str(value or '').strip()
    return value if value.isdecimal() and int(value) > 0 else None


def _snapshot_dir(aptem_learner_id):
    learner_id = _numeric_id(aptem_learner_id)
    if learner_id is None:
        return None
    return Path(settings.BASE_DIR) / 'private_media' / 'advanced_admin_aptem_reviews' / learner_id


def read_synced_review_pdf(review):
    """Read only a hash-verified snapshot for the exact Aptem learner and review."""
    directory = _snapshot_dir(review.get('aptemLearnerId'))
    review_id = _numeric_id(review.get('aptemReviewId'))
    if directory is None or review_id is None:
        return None
    try:
        manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
        entry = manifest['reviews'][review_id]
        document_id = _numeric_id(entry['documentId'])
        expected_hash = entry['sha256']
        if document_id is None or not isinstance(expected_hash, str) or len(expected_hash) != 64:
            return None
        path = directory / review_id / f'{document_id}.pdf'
        if path.stat().st_size > MAX_PDF_BYTES:
            return None
        content = path.read_bytes()
        if content.startswith(b'%PDF-') and hashlib.sha256(content).hexdigest() == expected_hash:
            return content
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


class AptemReviewClient:
    """Use Aptem's document history read endpoints; never create or sign PDFs."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json, application/pdf, text/html, */*',
            'X-Requested-With': 'XMLHttpRequest',
        })
        cookies = SimpleCookie()
        try:
            cookies.load(os.environ.get('APTEM_COOKIE_HEADER', ''))
        except Exception:
            cookies = SimpleCookie()
        for name, morsel in cookies.items():
            self.session.cookies.set(name, morsel.value, domain='kentbusinesscollege.aptem.co.uk')
        self.timeout = min(max(int(os.environ.get('APTEM_REQUEST_TIMEOUT_SECONDS', '25')), 5), 60)
        self._refreshed = False

    def close(self):
        self.session.close()

    def _login(self):
        email = os.environ.get('APTEM_LOGIN_EMAIL')
        password = os.environ.get('APTEM_LOGIN_PASSWORD')
        if not email or not password or os.environ.get('APTEM_AUTO_REFRESH_COOKIE', '').lower() != 'true':
            raise AptemUnavailable('Aptem session expired and automatic refresh is unavailable.')
        try:
            response = self.session.get(APTEM_ORIGIN + '/Users/Account/LogOn',
                                        timeout=self.timeout, allow_redirects=False)
            if response.status_code != 200:
                raise AptemUnavailable('Aptem sign-in page is unavailable.')
            inputs = _LoginInputs()
            inputs.feed(response.text)
            if not inputs.values.get('__RequestVerificationToken'):
                raise AptemUnavailable('Aptem sign-in token is unavailable.')
            inputs.values.update({'userNameOrEmail': email, 'password': password})
            response = self.session.post(APTEM_ORIGIN + '/Users/Account/LogOn',
                                         data=inputs.values, timeout=self.timeout,
                                         allow_redirects=False)
            if response.status_code != 302 or 'AUTHTOKEN' not in self.session.cookies:
                raise AptemUnavailable('Aptem sign-in failed.')
            self._refreshed = True
        except requests.RequestException as exc:
            raise AptemUnavailable('Aptem sign-in is unavailable.') from exc

    def _read_list(self, path, fields):
        form = {'filter': '', 'group': '', 'sort': '', 'skip': '0', 'take': '100'}
        form.update(fields)
        for attempt in range(2):
            try:
                response = self.session.post(
                    APTEM_ORIGIN + path,
                    files={key: (None, str(value)) for key, value in form.items()},
                    timeout=self.timeout, allow_redirects=False,
                )
            except requests.RequestException as exc:
                raise AptemUnavailable('Aptem document list is unavailable.') from exc
            if response.status_code in (302, 401, 403) and attempt == 0 and not self._refreshed:
                self._login()
                continue
            if response.status_code != 200:
                raise AptemUnavailable('Aptem document list is unavailable.')
            try:
                payload = response.json()
                rows = payload['Data']
                if not isinstance(rows, list) or payload.get('Errors'):
                    raise ValueError('Unexpected document list.')
                if payload.get('Total', 0) > len(rows):
                    raise AptemUnavailable('Aptem document list is incomplete.')
                return rows
            except (ValueError, KeyError, TypeError) as exc:
                raise AptemUnavailable('Aptem document list is invalid.') from exc
        raise AptemUnavailable('Aptem document list is unavailable.')

    def review_groups(self, learner_id, programme_id):
        return self._read_list('/MWS.eDocuments/DynamicDocuments/ReadReviewDocumentsGroups',
                               {'userId': learner_id, 'programId': programme_id})

    def review_documents(self, learner_id, review_id):
        return self._read_list('/MWS.eDocuments/DynamicDocuments/ReadComplianceDocuments',
                               {'userId': learner_id, 'itemId': review_id, 'itemType': 9})

    def download_pdf(self, document_id):
        document_id = _numeric_id(document_id)
        if document_id is None:
            raise AptemUnavailable('Invalid Aptem document ID.')
        try:
            response = self.session.get(
                APTEM_ORIGIN + '/MWS.eDocuments/DynamicDocuments/GetFile',
                params={'documentId': document_id}, timeout=self.timeout,
                allow_redirects=False,
            )
            location = urljoin(APTEM_ORIGIN, response.headers.get('Location', ''))
            parsed = urlparse(location)
            if (response.status_code != 302 or parsed.scheme != 'https'
                    or parsed.hostname != 'kentbusinesscollege.aptem.co.uk'
                    or not parsed.path.startswith(f'/DownloadFile/Static/{document_id}/')):
                raise AptemUnavailable('Aptem document link is invalid.')
            response = self.session.get(location, timeout=self.timeout,
                                        allow_redirects=False)
            content = response.content
            if (response.status_code != 200 or not content.startswith(b'%PDF-')
                    or len(content) > MAX_PDF_BYTES):
                raise AptemUnavailable('Aptem did not return a valid PDF.')
            return content
        except requests.RequestException as exc:
            raise AptemUnavailable('Aptem PDF download failed.') from exc


def sync_review_snapshots(aptem_learner_id, review_rows):
    """Save each completed review's latest Aptem version without rewriting history."""
    learner_id = _numeric_id(aptem_learner_id)
    directory = _snapshot_dir(learner_id)
    if directory is None:
        raise AptemUnavailable('Invalid Aptem learner ID.')
    valid = []
    for row in review_rows:
        review_id = _numeric_id(row.get('aptem_review_id'))
        data = row.get('review_data') or {}
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except ValueError:
                continue
        if not isinstance(data, dict):
            continue
        live = data.get('live_odata') or {}
        if not isinstance(live, dict):
            continue
        programme_id = _numeric_id(live.get('ProgramId'))
        if (review_id and programme_id and str(data.get('aptem_learner_id')) == learner_id
                and _numeric_id(live.get('LearnerId')) == learner_id
                and _numeric_id(live.get('Id')) == review_id):
            valid.append((review_id, programme_id, row['review_type']))
    existing = {}
    try:
        existing = json.loads((directory / 'manifest.json').read_text(encoding='utf-8')).get('reviews', {})
    except (OSError, ValueError, TypeError):
        pass
    entries = dict(existing)
    client = AptemReviewClient()
    saved = 0
    failures = []
    try:
        groups = {}
        for programme_id in {programme_id for _, programme_id, _ in valid}:
            for item in client.review_groups(learner_id, programme_id):
                if (_numeric_id(item.get('ProgramId')) == programme_id
                        and item.get('ItemType') == 9):
                    review_id = _numeric_id(item.get('ItemId'))
                    if review_id:
                        # Aptem can move a historical review to the learner's
                        # current programme while its old OData row retains the
                        # original programme ID.
                        groups.setdefault(review_id, {})[programme_id] = item
        for review_id, programme_id, review_type in valid:
            matching_groups = groups.get(review_id, {})
            if len(matching_groups) != 1:
                failures.append(review_id)
                continue
            current_programme_id = next(iter(matching_groups))
            try:
                documents = [item for item in client.review_documents(learner_id, review_id)
                             if (item.get('ProgramId') is None
                                 or _numeric_id(item.get('ProgramId')) == current_programme_id)
                             and _numeric_id(item.get('Id'))]
                documents.sort(key=lambda item: (
                    item.get('VersionCreatedDateTime') or '',
                    item.get('CreateDateTime') or '', int(item['Id'])), reverse=True)
                if not documents:
                    raise AptemUnavailable('No Aptem PDF version exists.')
                newest = documents[0]
                content = client.download_pdf(newest['Id'])
                signatures = (progress_review_pdf_signatures(content)
                              if review_type not in ('Monthly Coaching Meeting', 'Monthly Coaching', 'MCM')
                              else None)
                document_id = _numeric_id(newest['Id'])
                target = directory / review_id / f'{document_id}.pdf'
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    temporary = target.with_suffix('.pdf.tmp')
                    temporary.write_bytes(content)
                    temporary.replace(target)
                elif hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(content).digest():
                    raise AptemUnavailable('Existing Aptem document version differs.')
                entries[review_id] = {
                    'documentId': document_id,
                    'sha256': hashlib.sha256(content).hexdigest(),
                    'signatures': signatures,
                    'fetchedAt': datetime.now(timezone.utc).isoformat(),
                }
                saved += 1
            except (AptemUnavailable, OSError, KeyError, TypeError, ValueError):
                failures.append(review_id)
        if saved:
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / 'manifest.json'
            temporary = directory / 'manifest.json.tmp'
            temporary.write_text(json.dumps({'reviews': entries}, sort_keys=True, indent=2),
                                 encoding='utf-8')
            temporary.replace(target)
    finally:
        client.close()
    return {'eligible': len(valid), 'saved': saved, 'failed': len(failures)}
