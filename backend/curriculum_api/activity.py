"""Who used the Curriculum: sessions, the pages they opened, and what they did.

This is the other half of the audit story. ``quality.py`` answers *what changed*
by reading the revision log the write helpers fill, which means it can only ever
see a save. It cannot see somebody open the module builder, read a cohort and
leave -- nothing about that touches a record, so nothing about it is stored.

So the reading here is recorded rather than derived. The browser reports each
curriculum page it opens and the read actions taken on it (a search, a filter,
an export, a download), and those land in ``curriculum.activity_events``. That
table is created by hand against Neon like the rest of the curriculum's own
history tables -- see ``backend/sql/2026-09-17_curriculum_activity_events.sql``
-- and until it exists every read here answers ``visitsRecorded: false`` and
every write is dropped quietly, so a missing table is a page that says what it
cannot show rather than a 500 on every navigation.

Three things are deliberately NOT taken from the browser:

* **Who.** The actor is read from the session on the server. A client that
  names an email is ignored, because otherwise anybody could write anybody's
  name into the audit trail.
* **Which page.** ``path`` is resolved against the route table below, so the
  page name and the record id in a detail route come from the server's own
  reading of the URL. The client only supplies the record's *title*, which is
  display text and is treated as such.
* **When, without limit.** A client stamp is accepted only when it is recent
  and not in the future; anything else falls back to the moment the server
  received it. ``recorded_at`` is always the server's own clock, so the two can
  be compared.

Nothing here writes to a curriculum record and nothing here sits on the path of
a save. A failure to record activity must never fail the request that caused it.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import quality
from . import versioning
from . import views as curriculum_views

logger = logging.getLogger(__name__)

ACTIVITY_TABLE = 'activity_events'

DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 365
DEFAULT_PEOPLE_LIMIT = 200
MAX_EVENTS_PER_CALL = 60
MAX_PERSON_EVENTS = 2000
MAX_PERSON_CHANGES = 400

# How far back a browser-supplied stamp may sit before it is ignored. A queue
# that survived a sleeping laptop is worth keeping; a stamp from last week is a
# clock that cannot be trusted to order anything.
MAX_CLIENT_BACKDATE = timedelta(hours=12)

# What a browser may report. `page_view` is an arrival; the rest are the read
# actions taken while there. Writes are NOT in this list -- a save is recorded
# by the write helper itself, with a before and an after, and accepting a
# client's word for one would put an unverified edit in the audit trail.
EVENT_KINDS = {
    'page_view': 'Opened the page',
    'search': 'Searched',
    'filter': 'Changed a filter',
    'sort': 'Changed the order',
    'export': 'Exported',
    'download': 'Downloaded a file',
    'record_view': 'Opened a record',
    'tab': 'Switched tab',
    'print': 'Printed',
}

# Free-text detail a browser may attach, and how much of it is kept. Anything
# else in `detail` is dropped: this column is descriptive context, never a place
# for page content, a payload or a token.
DETAIL_FIELDS = {
    'query': 120,
    'filter': 60,
    'value': 120,
    'tab': 60,
    'sort': 60,
    'format': 20,
    'fileName': 160,
    'count': 20,
    'scope': 60,
}

MAX_TEXT = 200
MAX_USER_AGENT = 256

# The curriculum routes, most specific first so `/curriculum/cohorts/{id}/allocate`
# is matched before `/curriculum/cohorts/{id}`. The fourth field names what the
# `{id}` segment is, which is how a record id gets out of a URL without the
# client having to name it.
CURRICULUM_PAGES = (
    ('/curriculum/cohorts/{id}/allocate', 'cohort-allocate', 'Cohort allocation', 'cohort'),
    ('/curriculum/quiz-xml/{id}/edit', 'quiz-edit', 'Quiz editor', 'quiz'),
    ('/curriculum/audit-trail/people/{id}', 'audit-trail-person', 'Audit trail: one person', 'person'),
    ('/curriculum/quiz-xml/manual', 'quiz-xml-manual', 'Quiz XML (manual)', ''),
    ('/curriculum/programmes/{id}', 'programme-workspace', 'Programme workspace', 'programme'),
    ('/curriculum/standards/{id}', 'standard-detail', 'Standard', 'standard'),
    ('/curriculum/cohorts/{id}', 'cohort-workspace', 'Cohort workspace', 'cohort'),
    ('/curriculum/groups/{id}', 'group-workspace', 'Group workspace', 'group'),
    ('/curriculum/modules/{id}', 'module-workspace', 'Module workspace', 'module'),
    ('/curriculum/audit-trail', 'audit-trail', 'Audit trail', ''),
    ('/curriculum/programmes', 'programmes', 'Programmes', ''),
    ('/curriculum/library', 'library', 'Content library', ''),
    ('/curriculum/delivery', 'delivery', 'Delivery', ''),
    ('/curriculum/quality', 'quality', 'Quality', ''),
    ('/curriculum/free-courses', 'free-courses', 'Free courses', ''),
    ('/curriculum/module-builder', 'module-builder', 'Module builder', ''),
    ('/curriculum/week-builder', 'week-builder', 'Week builder', ''),
    ('/curriculum/ksb-mapping', 'ksb-mapping', 'KSB mapping', ''),
    ('/curriculum/ksb-frameworks', 'ksb-frameworks', 'KSB frameworks', ''),
    ('/curriculum/standards', 'standards', 'Standards', ''),
    ('/curriculum/quiz-xml', 'quiz-xml', 'Quiz XML', ''),
    ('/curriculum/question-bank', 'question-bank', 'Question bank', ''),
    ('/curriculum/checkpoints', 'checkpoints', 'Checkpoints', ''),
    ('/curriculum/cohorts', 'cohorts', 'Cohorts', ''),
    ('/curriculum/groups', 'groups', 'Groups', ''),
    ('/curriculum/modules', 'modules', 'Modules', ''),
    ('/curriculum/teams-meetings', 'teams-meetings', 'Teams calendar', ''),
    ('/curriculum/england-holidays', 'england-holidays', 'England holidays', ''),
    ('/curriculum/session-calendar', 'session-calendar', 'Session calendar', ''),
    ('/curriculum/version-control', 'version-control', 'Version control', ''),
    ('/curriculum/reports', 'reports', 'Reports', ''),
    ('/curriculum/published', 'published', 'Published', ''),
    ('/curriculum/qa', 'qa', 'QA', ''),
    ('/curriculum/hubs', 'hubs', 'Curriculum hubs', ''),
    ('/curriculum', 'overview', 'Curriculum overview', ''),
)

_ID_PATTERN = re.compile(r'^[A-Za-z0-9@._:%+-]{1,120}$')

_AVAILABLE = {}


# ------------------------------------------------------------- availability

def activity_available():
    """True when ``curriculum.activity_events`` exists. Cached; a miss is not.

    Deliberately the same shape as ``versioning.history_available``: probed with
    ``to_regclass`` so a missing relation answers NULL rather than raising and
    aborting the surrounding transaction, and a negative answer is not cached,
    because the table is created by hand against Neon and a process that started
    before that SQL ran has to begin recording once it has, without a restart.
    """
    if _AVAILABLE.get('ready'):
        return True
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('select to_regclass(%s) is not null', [f'curriculum.{ACTIVITY_TABLE}'])
            else:
                cursor.execute(
                    "select count(*) = 1 from sqlite_master where type = 'table' and name = %s",
                    [ACTIVITY_TABLE],
                )
            row = cursor.fetchone()
    except Exception:
        return False
    if not (row and row[0]):
        return False
    _AVAILABLE['ready'] = True
    return True


def reset_availability():
    _AVAILABLE.pop('ready', None)


def table():
    return versioning.qualified(ACTIVITY_TABLE)


# ------------------------------------------------------------------ helpers

def clean(value, limit=MAX_TEXT):
    return curriculum_views.clean_str(value)[:limit]


def resolve_page(path):
    """A URL as the page it is, plus whatever record the URL itself names.

    Read from the route table rather than from the client, so a page name in the
    audit trail is the server's own reading of the URL. An unrecognised
    curriculum path is kept verbatim and labelled from its last segment: a new
    page should appear in the trail the day it ships, not the day somebody
    remembers to add it here.
    """
    path = clean(path, 300)
    if path and not path.startswith('/'):
        path = f'/{path}'
    path = path.split('?')[0].split('#')[0].rstrip('/') or '/curriculum'
    for template, key, label, target_type in CURRICULUM_PAGES:
        if '{id}' not in template:
            if path == template:
                return {'pageKey': key, 'pageLabel': label, 'targetType': '', 'targetId': '', 'path': path}
            continue
        prefix, suffix = template.split('/{id}', 1)
        if not path.startswith(f'{prefix}/'):
            continue
        rest = path[len(prefix) + 1:]
        if suffix:
            if not rest.endswith(suffix):
                continue
            rest = rest[: -len(suffix)]
        if not rest or '/' in rest:
            continue
        return {
            'pageKey': key,
            'pageLabel': label,
            'targetType': target_type,
            'targetId': rest[:120],
            'path': path,
        }
    tail = path.rsplit('/', 1)[-1] or 'curriculum'
    return {
        'pageKey': tail[:60],
        'pageLabel': tail.replace('-', ' ').replace('_', ' ').title(),
        'targetType': '',
        'targetId': '',
        'path': path,
    }


def client_ip(request):
    forwarded = clean(request.META.get('HTTP_X_FORWARDED_FOR'), 200)
    if forwarded:
        return forwarded.split(',')[0].strip()[:60]
    return clean(request.META.get('REMOTE_ADDR'), 60)


def parse_client_stamp(value, now):
    """A browser stamp as naive UTC, or nothing.

    Never the future and never last week: a queue that survived a sleeping
    laptop is worth keeping, but a stamp from a badly set clock would reorder
    somebody's whole day, so it is refused and the server's own clock is used.
    """
    text = clean(value, 40)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    if parsed > now + timedelta(minutes=5):
        return None
    if parsed < now - MAX_CLIENT_BACKDATE:
        return None
    return parsed


def clean_detail(value):
    """The allowlisted descriptive fields, and nothing else."""
    if not isinstance(value, dict):
        return {}
    detail = {}
    for key, limit in DETAIL_FIELDS.items():
        if key not in value:
            continue
        raw = value.get(key)
        if raw is None or isinstance(raw, (dict, list)):
            continue
        text = str(raw).strip()[:limit]
        if text:
            detail[key] = text
    return detail


# --------------------------------------------------------------- recording

@csrf_exempt
@require_POST
@never_cache
def curriculum_activity_record(request):
    """Record page opens and read actions for the signed-in account.

    Answers 200 in every ordinary case, including when there is nothing to
    record and when the table does not exist: this is called from a navigation
    handler, and a failing beacon must never be something the person notices.
    """
    account = getattr(request, 'login_account', None)
    email = clean(getattr(account, 'email', ''), 160).lower()
    if not email:
        # No session, so no person to attribute anything to. An audit of who
        # used the curriculum must not hold rows nobody can be matched to.
        return JsonResponse({'recorded': 0, 'available': activity_available(), 'reason': 'no-session'})
    if not activity_available():
        return JsonResponse({'recorded': 0, 'available': False, 'reason': 'table-missing'})

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Body must be JSON'}, status=400)
    if not isinstance(payload, dict):
        return JsonResponse({'error': 'Body must be a JSON object'}, status=400)

    visit_id = clean(payload.get('visitId'), 64)
    events = payload.get('events')
    if not isinstance(events, list):
        return JsonResponse({'error': 'events must be a list'}, status=400)

    now = datetime.utcnow()
    name = clean(getattr(account, 'display_name', ''), 160) or email
    role = clean(getattr(account, 'role', ''), 60)
    account_id = getattr(account, 'pk', None)
    ip = client_ip(request)
    agent = clean(request.META.get('HTTP_USER_AGENT'), MAX_USER_AGENT)

    prepared = []
    for raw in events[:MAX_EVENTS_PER_CALL]:
        if not isinstance(raw, dict):
            continue
        kind = clean(raw.get('kind'), 32)
        if kind not in EVENT_KINDS:
            continue
        page = resolve_page(raw.get('path'))
        # A read action may name the record it acted on; a page view takes the
        # record from its own URL and ignores anything the client adds.
        target_type = page['targetType']
        target_id = page['targetId']
        if kind != 'page_view' and not target_id:
            candidate = clean(raw.get('targetId'), 120)
            if candidate and _ID_PATTERN.match(candidate):
                target_id = candidate
                target_type = clean(raw.get('targetType'), 40)
        duration = raw.get('durationMs')
        try:
            duration = int(duration)
        except (TypeError, ValueError):
            duration = None
        if duration is not None and not 0 <= duration <= 86_400_000:
            duration = None
        prepared.append({
            'visit': clean(raw.get('visitId'), 64) or visit_id,
            'kind': kind,
            'duration': duration,
            'row': (
                parse_client_stamp(raw.get('at'), now) or now,
                now,
                email,
                name,
                role,
                account_id,
                clean(raw.get('visitId'), 64) or visit_id,
                kind,
                page['path'],
                page['pageKey'],
                page['pageLabel'],
                target_type,
                target_id,
                clean(raw.get('targetLabel'), 160),
                json.dumps(clean_detail(raw.get('detail'))),
                duration,
                ip,
                agent,
            ),
            'path': page['path'],
        })

    if not prepared:
        return JsonResponse({'recorded': 0, 'available': True})

    columns = (
        'occurred_at, recorded_at, actor_email, actor_name, actor_role, account_id, visit_id, '
        'kind, path, page_key, page_label, target_type, target_id, target_label, detail, '
        'duration_ms, ip_address, user_agent'
    )
    placeholders = '(' + ', '.join(['%s'] * 18) + ')'
    insert = f'insert into {table()} ({columns}) values {placeholders}'
    recorded = 0
    try:
        with connection.cursor() as cursor:
            # In order, one at a time, because a page view carrying a duration
            # CLOSES the arrival it belongs to rather than adding a second row
            # for the same page -- and when the two travel in the same batch,
            # the arrival has to be in the table before the close looks for it.
            for item in prepared:
                if item['kind'] == 'page_view' and item['duration'] is not None:
                    cursor.execute(
                        f'update {table()} set duration_ms = %s where id = ('
                        f'select max(id) from {table()} where actor_email = %s and visit_id = %s '
                        'and path = %s and kind = %s and duration_ms is null)',
                        [item['duration'], email, item['visit'], item['path'], 'page_view'],
                    )
                    if cursor.rowcount:
                        recorded += 1
                        continue
                    # Nothing to close: the arrival was never recorded (the
                    # table was created mid-session, or the queue outlived it).
                    # The visit still happened, so it is inserted rather than
                    # dropped -- an entry with a duration and no separate
                    # opening, which is exactly what happened.
                cursor.execute(insert, item['row'])
                recorded += 1
    except Exception:
        # Recording is best effort by design. The person navigated successfully;
        # losing the note of it must not turn into an error they can see.
        logger.warning('Could not record curriculum activity.', exc_info=True)
        return JsonResponse({'recorded': recorded, 'available': True, 'reason': 'write-failed'})
    return JsonResponse({'recorded': recorded, 'available': True})


# ----------------------------------------------------------------- reading

@require_GET
@never_cache
def curriculum_activity_people(request):
    """Everyone who used the Curriculum in the window, one row each.

    Three sources, each reported separately so the page can say which of them it
    is actually looking at, rather than letting the silence of a missing one
    read as a person who did nothing:

    * ``curriculum.activity_events`` -- pages opened and read actions.
    * ``curriculum.record_revisions`` -- what they changed.
    * ``login."Login_audit"`` -- when they signed in.
    """
    days = quality.parse_bounded_int(request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS)
    search = curriculum_views.clean_str(request.GET.get('search')).lower()
    since = datetime.utcnow() - timedelta(days=days)

    people = {}

    def person(email, name='', role=''):
        key = (email or '').lower()
        row = people.get(key)
        if not row:
            row = {
                'email': key,
                'name': name or key,
                'role': role,
                'firstSeen': '',
                'lastSeen': '',
                'visits': 0,
                'pageViews': 0,
                'readActions': 0,
                'pagesOpened': 0,
                'changes': 0,
                'signIns': 0,
                'lastPageKey': '',
                'lastPageLabel': '',
            }
            people[key] = row
        if name and (not row['name'] or row['name'] == key):
            row['name'] = name
        if role and not row['role']:
            row['role'] = role
        return row

    def seen(row, stamp):
        stamp = stamp if isinstance(stamp, str) else quality.iso(stamp)
        if not stamp:
            return
        if not row['firstSeen'] or stamp < row['firstSeen']:
            row['firstSeen'] = stamp
        if not row['lastSeen'] or stamp > row['lastSeen']:
            row['lastSeen'] = stamp

    visits_recorded = activity_available()
    if visits_recorded:
        try:
            for row in curriculum_views.fetch_all(
                'select actor_email, max(actor_name) as actor_name, max(actor_role) as actor_role, '
                'sum(case when kind = %s then 1 else 0 end) as page_views, '
                'sum(case when kind <> %s then 1 else 0 end) as read_actions, '
                'count(distinct visit_id) as visits, count(distinct page_key) as pages_opened, '
                'min(occurred_at) as first_seen, max(occurred_at) as last_seen '
                f'from {table()} where occurred_at >= %s and actor_email <> %s '
                'group by actor_email',
                ['page_view', 'page_view', since, ''],
            ):
                entry = person(
                    curriculum_views.clean_str(row.get('actor_email')),
                    curriculum_views.clean_str(row.get('actor_name')),
                    curriculum_views.clean_str(row.get('actor_role')),
                )
                entry['pageViews'] = int(row.get('page_views') or 0)
                entry['readActions'] = int(row.get('read_actions') or 0)
                entry['visits'] = int(row.get('visits') or 0)
                entry['pagesOpened'] = int(row.get('pages_opened') or 0)
                seen(entry, row.get('first_seen'))
                seen(entry, row.get('last_seen'))
        except Exception:
            logger.warning('Could not read curriculum activity for the people list.', exc_info=True)
            visits_recorded = False

    if visits_recorded:
        # Where each person was last. A correlated max(id) rather than
        # `distinct on`, which Postgres has and the local sqlite suites do not.
        try:
            for row in curriculum_views.fetch_all(
                'select a.actor_email, a.page_key, a.page_label '
                f'from {table()} a where a.kind = %s and a.occurred_at >= %s and a.actor_email <> %s '
                f'and a.id = (select max(b.id) from {table()} b '
                'where b.actor_email = a.actor_email and b.kind = %s and b.occurred_at >= %s)',
                ['page_view', since, '', 'page_view', since],
            ):
                entry = people.get(curriculum_views.clean_str(row.get('actor_email')).lower())
                if entry:
                    entry['lastPageKey'] = curriculum_views.clean_str(row.get('page_key'))
                    entry['lastPageLabel'] = curriculum_views.clean_str(row.get('page_label'))
        except Exception:
            logger.warning('Could not read the last page opened per person.', exc_info=True)

    changes_recorded = versioning.history_available()
    if changes_recorded:
        for row in quality.revision_actors(since):
            if not row['email']:
                continue
            entry = person(row['email'], row['name'])
            entry['changes'] = row['changes']

    sign_ins_recorded, sign_in_rows = read_sign_ins(since)
    for row in sign_in_rows:
        entry = person(row['email'])
        entry['signIns'] = row['count']
        seen(entry, row['firstAt'])
        seen(entry, row['lastAt'])

    rows = sorted(people.values(), key=lambda row: row['lastSeen'], reverse=True)
    if search:
        rows = [row for row in rows if search in row['email'] or search in row['name'].lower()]
    truncated = len(rows) > DEFAULT_PEOPLE_LIMIT
    rows = rows[:DEFAULT_PEOPLE_LIMIT]

    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'visitsRecorded': visits_recorded,
        'changesRecorded': changes_recorded,
        'signInsRecorded': sign_ins_recorded,
        'truncated': truncated,
        'totals': {
            'people': len(rows),
            'visits': sum(row['visits'] for row in rows),
            'pageViews': sum(row['pageViews'] for row in rows),
            'readActions': sum(row['readActions'] for row in rows),
            'changes': sum(row['changes'] for row in rows),
            'signIns': sum(row['signIns'] for row in rows),
        },
        'people': rows,
    })


def read_sign_ins(since, email=''):
    """Successful sign-ins from ``login."Login_audit"``, grouped or listed.

    Account-wide, not curriculum-only: the sign-in is what got somebody into the
    LMS at all, and for a sitting that predates the activity table it is the
    only thing either history can still say. The page labels it as a sign-in
    rather than passing it off as a curriculum visit.
    """
    try:
        from login.models import EVENT_LOGIN, LoginAudit

        query = LoginAudit.objects.filter(created_at__gte=since, event=EVENT_LOGIN, succeeded=True)
        if email:
            return True, [
                {
                    'at': quality.iso(row.created_at),
                    'ip': curriculum_views.clean_str(row.ip_address),
                    'userAgent': curriculum_views.clean_str(row.user_agent)[:MAX_USER_AGENT],
                }
                for row in query.filter(email__iexact=email).order_by('-created_at')[:200]
            ]
        grouped = {}
        for row in query.only('email', 'created_at').order_by('-created_at')[:5000]:
            key = curriculum_views.clean_str(row.email).lower()
            if not key:
                continue
            entry = grouped.setdefault(key, {'email': key, 'count': 0, 'firstAt': '', 'lastAt': ''})
            entry['count'] += 1
            stamp = quality.iso(row.created_at)
            if stamp and (not entry['lastAt'] or stamp > entry['lastAt']):
                entry['lastAt'] = stamp
            if stamp and (not entry['firstAt'] or stamp < entry['firstAt']):
                entry['firstAt'] = stamp
        return True, list(grouped.values())
    except Exception:
        logger.warning('Could not read the sign-in history.', exc_info=True)
        return False, []


@require_GET
@never_cache
def curriculum_activity_person(request, email):
    """One person: their visits, the pages in each, and what they did there.

    The visits are assembled here rather than in SQL because the shape wanted is
    a nesting -- visit, then page, then the actions taken on that page -- and
    the ordering that produces it is the same single ordered scan either way.

    Their recorded changes are read from the revision log and attached to the
    page that was open when each was saved, matched on time inside the visit. A
    change that cannot be placed on a page is still listed separately: dropping
    it would hide a real edit because the navigation around it was not recorded.
    """
    email = curriculum_views.clean_str(email).lower()[:160]
    if not email:
        return JsonResponse({'error': 'An email is required'}, status=400)
    days = quality.parse_bounded_int(request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS)
    since = datetime.utcnow() - timedelta(days=days)

    person = {'email': email, 'name': email, 'role': '', 'firstSeen': '', 'lastSeen': ''}

    visits_recorded = activity_available()
    events = []
    if visits_recorded:
        try:
            events = curriculum_views.fetch_all(
                'select id, occurred_at, actor_name, actor_role, visit_id, kind, path, page_key, '
                'page_label, target_type, target_id, target_label, detail, duration_ms, '
                'ip_address, user_agent '
                f'from {table()} where actor_email = %s and occurred_at >= %s '
                f'order by occurred_at asc, id asc limit {MAX_PERSON_EVENTS}',
                [email, since],
            )
        except Exception:
            logger.warning("Could not read one person's curriculum activity.", exc_info=True)
            visits_recorded = False
            events = []

    for row in events:
        person['name'] = curriculum_views.clean_str(row.get('actor_name')) or person['name']
        person['role'] = curriculum_views.clean_str(row.get('actor_role')) or person['role']

    changes_recorded = versioning.history_available()
    changes = read_person_changes(email, since) if changes_recorded else []
    for change in changes:
        if change.get('actorName') and person['name'] == email:
            person['name'] = change['actorName']

    visits = build_visits(events, changes)
    sign_ins_recorded, sign_ins = read_sign_ins(since, email=email)

    stamps = [visit['startedAt'] for visit in visits] + [visit['endedAt'] for visit in visits]
    stamps += [change['at'] for change in changes] + [row['at'] for row in sign_ins]
    stamps = sorted(stamp for stamp in stamps if stamp)
    if stamps:
        person['firstSeen'] = stamps[0]
        person['lastSeen'] = stamps[-1]

    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'visitsRecorded': visits_recorded,
        'changesRecorded': changes_recorded,
        'signInsRecorded': sign_ins_recorded,
        'person': person,
        'counts': {
            'visits': len(visits),
            'pageViews': sum(1 for row in events if curriculum_views.clean_str(row.get('kind')) == 'page_view'),
            'readActions': sum(1 for row in events if curriculum_views.clean_str(row.get('kind')) != 'page_view'),
            'changes': len(changes),
            'changesOnAPage': sum(1 for change in changes if change.get('placed')),
            'signIns': len(sign_ins),
        },
        'visits': visits,
        'signIns': sign_ins,
        'changes': changes,
    })


def read_person_changes(email, since):
    """This person's recorded curriculum writes, newest first."""
    revisions = versioning.qualified(versioning.REVISIONS_TABLE)
    columns = (
        'id, entity_type, entity_id, revision_no, action, module_catalogue_id, parent_id, '
        'title, version_label, content_status, changed_fields, snapshot, actor_name, actor_email, '
        'reason, created_at'
    )
    if versioning.metadata_columns_available():
        columns += ', actor_type, triggered_by_email, triggered_by_name, source, metadata'
    try:
        rows = curriculum_views.fetch_all(
            f'select {columns} from {revisions} '
            'where lower(actor_email) = %s and created_at >= %s '
            f'order by created_at desc, id desc limit {MAX_PERSON_CHANGES}',
            [email, since],
        )
    except Exception:
        logger.warning("Could not read one person's curriculum changes.", exc_info=True)
        return []
    changes = []
    for row in rows:
        event = quality.revision_event(row)
        event['placed'] = False
        changes.append(event)
    return changes


def build_visits(events, changes):
    """Ordered events as visits, each holding its pages and what happened on them.

    A read action arriving before any page view in its visit still has to go
    somewhere, so it opens a page entry that says the page was not recorded
    rather than being dropped: the action happened, and an honest gap beats
    silence.
    """
    by_visit = []
    index = {}
    for row in events:
        visit_id = curriculum_views.clean_str(row.get('visit_id')) or 'unknown'
        visit = index.get(visit_id)
        if not visit:
            visit = {
                'id': visit_id,
                'startedAt': '',
                'endedAt': '',
                'ip': curriculum_views.clean_str(row.get('ip_address')),
                'userAgent': curriculum_views.clean_str(row.get('user_agent'))[:MAX_USER_AGENT],
                'pages': [],
                'pageCount': 0,
                'actionCount': 0,
                'changeCount': 0,
            }
            index[visit_id] = visit
            by_visit.append(visit)
        stamp = quality.iso(row.get('occurred_at'))
        if not visit['startedAt']:
            visit['startedAt'] = stamp
        visit['endedAt'] = stamp
        kind = curriculum_views.clean_str(row.get('kind'))
        if kind == 'page_view':
            visit['pages'].append({
                'id': f'ev:{row.get("id")}',
                'at': stamp,
                'endedAt': stamp,
                'path': curriculum_views.clean_str(row.get('path')),
                'pageKey': curriculum_views.clean_str(row.get('page_key')),
                'pageLabel': curriculum_views.clean_str(row.get('page_label')),
                'targetType': curriculum_views.clean_str(row.get('target_type')),
                'targetId': curriculum_views.clean_str(row.get('target_id')),
                'targetLabel': curriculum_views.clean_str(row.get('target_label')),
                'durationMs': int(row['duration_ms']) if row.get('duration_ms') is not None else None,
                'actions': [],
                'changes': [],
            })
            visit['pageCount'] += 1
            continue
        page = visit['pages'][-1] if visit['pages'] else None
        if page is None:
            page = {
                'id': f'gap:{visit_id}',
                'at': stamp,
                'endedAt': stamp,
                'path': curriculum_views.clean_str(row.get('path')),
                'pageKey': curriculum_views.clean_str(row.get('page_key')),
                'pageLabel': curriculum_views.clean_str(row.get('page_label')) or 'Page not recorded',
                'targetType': '',
                'targetId': '',
                'targetLabel': '',
                'durationMs': None,
                'actions': [],
                'changes': [],
            }
            visit['pages'].append(page)
            visit['pageCount'] += 1
        page['endedAt'] = stamp
        page['actions'].append({
            'id': f'ev:{row.get("id")}',
            'at': stamp,
            'kind': kind,
            'label': EVENT_KINDS.get(kind, kind.replace('_', ' ').title()),
            'targetType': curriculum_views.clean_str(row.get('target_type')),
            'targetId': curriculum_views.clean_str(row.get('target_id')),
            'targetLabel': curriculum_views.clean_str(row.get('target_label')),
            'detail': versioning.as_dict(row.get('detail')),
        })
        visit['actionCount'] += 1

    # Each change goes on the page that was open when it was saved. Matching on
    # the page's own span rather than on the visit alone is what makes "what did
    # they do on this page" answerable; a change outside every span stays in the
    # separate list, still reported.
    for change in changes:
        stamp = change.get('at') or ''
        if not stamp:
            continue
        for visit in by_visit:
            if not visit['startedAt'] <= stamp <= visit['endedAt']:
                continue
            target = None
            for page in visit['pages']:
                if page['at'] <= stamp <= page['endedAt']:
                    target = page
            if target is None and visit['pages']:
                # Inside the visit but after the last recorded page view: that
                # page was still open, nothing new was navigated to.
                last = visit['pages'][-1]
                if stamp >= last['at']:
                    target = last
            if target is not None:
                target['changes'].append(change)
                visit['changeCount'] += 1
                change['placed'] = True
            break

    by_visit.reverse()
    for visit in by_visit:
        visit['pages'].reverse()
    return by_visit
