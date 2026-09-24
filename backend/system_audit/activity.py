"""Who used the LMS: sessions, the pages they opened, and what they did.

This is the reading half of the audit story, for every workspace. ``Changes``
answers *what changed* by reading the revision logs the write helpers fill,
which means it can only ever see a save. It cannot see somebody open a coach's
caseload, search it and leave -- nothing about that touches a record, so nothing
about it is stored.

So the reading here is recorded rather than derived. The browser reports each
page it opens and the read actions taken on it (a search, a filter, an export, a
download), and those land in ``curriculum.activity_events``.

Why that table name
-------------------
The table was created for Curriculum Studio and now carries the whole LMS. It
keeps its name and its rows: renaming it would either lose the history already
in it or need a migration to move it, and the audit trail is the last place to
trade recorded history for a tidier name. What it gained is a ``workspace``
column -- see ``backend/sql/2026-09-20_activity_events_workspace.sql``. Until
that column exists the workspace is derived from the stored path on read, so the
page works either way and says which of the two it is doing.

Three things are deliberately NOT taken from the browser:

* **Who.** The actor is read from the session on the server. A client that names
  an email is ignored, because otherwise anybody could write anybody's name into
  the audit trail.
* **Which page.** ``path`` is resolved against ``system_audit.pages``, so the
  page name, the workspace and the record id in a detail route come from the
  server's own reading of the URL. The client only supplies the record's
  *title*, which is display text and is treated as such.
* **When, without limit.** A client stamp is accepted only when it is recent and
  not in the future; anything else falls back to the moment the server received
  it. ``recorded_at`` is always the server's own clock, so the two can be
  compared.

Nothing here writes to a business record and nothing here sits on the path of a
save. A failure to record activity must never fail the request that caused it.
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from curriculum_api import quality
from curriculum_api import versioning
from curriculum_api import views as curriculum_views

from . import pages
from . import writes

logger = logging.getLogger(__name__)

ACTIVITY_TABLE = 'activity_events'

#: How long page activity is kept, and so the only window the Audit Trail reads.
#: Rows older than this are deleted by ``purge_expired_activity``.
RETENTION_DAYS = 7
DEFAULT_WINDOW_DAYS = RETENTION_DAYS
MAX_WINDOW_DAYS = RETENTION_DAYS

#: The purge runs at most this often per process, and deletes in batches so the
#: first run -- which clears everything already past the window -- stays bounded.
PURGE_INTERVAL_SECONDS = 3600
PURGE_BATCH = 5000
PURGE_MAX_BATCHES = 40
#: pg_try_advisory_xact_lock key: one of production's processes purges at a time.
PURGE_LOCK_KEY = 7_202_609_240
_PURGE = {}
DEFAULT_PEOPLE_LIMIT = 200

#: One page of the people list. Smaller than the old cap on purpose: the cap was
#: how much could be reached at all, a page size is how much is read at once.
DEFAULT_PEOPLE_PAGE_SIZE = 50
MAX_PEOPLE_PAGE_SIZE = 200

#: ``?role=`` for the people who have no role recorded. A reserved word rather
#: than an empty value, because an empty one is indistinguishable from the
#: filter being absent and would read as "everybody".
NO_ROLE = '__none__'
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

READ_ACTION_KINDS = tuple(kind for kind in EVENT_KINDS if kind != 'page_view')

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


def workspace_column_available():
    """True once ``activity_events.workspace`` exists.

    Same probe shape and the same reason for not caching a miss: the column is
    added by hand against Neon, and a running process must start filling it the
    moment it appears. Until then the workspace is derived from the stored path
    on read, which is correct but cannot be filtered on in SQL.
    """
    if _AVAILABLE.get('workspace'):
        return True
    if not activity_available():
        return False
    try:
        columns = {name.lower() for name in _column_names()}
    except Exception:
        return False
    if 'workspace' not in columns:
        return False
    _AVAILABLE['workspace'] = True
    return True


def _column_names():
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(
                'select column_name from information_schema.columns '
                'where table_schema = %s and table_name = %s',
                ['curriculum', ACTIVITY_TABLE],
            )
            return [row[0] for row in cursor.fetchall()]
        cursor.execute(f'pragma table_info("{ACTIVITY_TABLE}")')
        return [row[1] for row in cursor.fetchall()]


def reset_availability():
    _AVAILABLE.pop('ready', None)
    _AVAILABLE.pop('workspace', None)


def table():
    return versioning.qualified(ACTIVITY_TABLE)


def purge_expired_activity():
    """Delete page activity older than ``RETENTION_DAYS``. Never raises.

    Only ``activity_events``. Change history (``record_revisions``) also feeds
    every record's History panel and sign-ins are the security log, so both are
    kept and only left out of the Audit Trail's window. Curriculum Studio's page
    activity is kept in full: its trail has no window.

    Rows are told apart by their stored workspace, so without that column there
    is no safe way to spare Curriculum Studio's, and nothing is deleted.
    """
    started = time.monotonic()
    last = _PURGE.get('last')
    if last is not None and started - last < PURGE_INTERVAL_SECONDS:
        return 0
    _PURGE['last'] = started
    if not activity_available() or not workspace_column_available():
        return 0
    kept = sorted(quality.UNLIMITED_WORKSPACES)
    cutoff = datetime.utcnow() - timedelta(days=RETENTION_DAYS)
    deleted = 0
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                if connection.vendor == 'postgresql':
                    cursor.execute('select pg_try_advisory_xact_lock(%s)', [PURGE_LOCK_KEY])
                    if not cursor.fetchone()[0]:
                        return 0
                for _batch in range(PURGE_MAX_BATCHES):
                    cursor.execute(
                        f'delete from {table()} where id in ('
                        f'select id from {table()} where occurred_at < %s '
                        f"and coalesce(workspace, '') not in ({', '.join(['%s'] * len(kept))}) "
                        f'limit {PURGE_BATCH})',
                        [cutoff, *kept],
                    )
                    deleted += max(cursor.rowcount, 0)
                    if cursor.rowcount < PURGE_BATCH:
                        break
    except Exception:
        logger.warning('Could not delete expired LMS activity.', exc_info=True)
        return 0
    if deleted:
        logger.info('Deleted %s LMS activity rows older than %s days.', deleted, RETENTION_DAYS)
    return deleted


# ------------------------------------------------------------------ helpers

def clean(value, limit=MAX_TEXT):
    return curriculum_views.clean_str(value)[:limit]


def resolve_page(path):
    """A URL as the page it is, plus whatever record the URL itself names.

    Delegates to ``system_audit.pages`` so the audit trail and the route table
    can never disagree about what a page is called or which workspace it is in.
    """
    return pages.resolve(path)


def actor_role(account):
    """The Role column, read from ``enrolment."Staff_users"`` and nowhere else.

    One source, deliberately. The role this trail files somebody under is the
    access grant the enrolment directory holds for them -- ``Access`` first,
    and ``Type`` when no grant has been recorded, which is the same row saying
    what kind of account it is. Both columns, one table, one read.

    What it specifically does NOT do is fall back to ``account.role``. That is
    the coarse sign-in gate ``login.identity.role_for_staff`` derives, and it
    only ever says ``admin`` or ``staff`` -- it cannot tell a coach from a
    tutor from an enrolment officer, which is the whole question this column
    exists to answer. A fallback to it would fill the column with a second,
    quieter meaning of the word "role" that reads exactly like the first, so a
    row saying ``staff`` would be indistinguishable from a person whose grant
    genuinely is staff-level. Better an empty cell, which the list draws as
    "No role recorded", than a confident wrong one.

    An account with no staff row -- a learner, an employer -- has no grant to
    read, so it files under nothing.
    """
    subject_id = getattr(account, 'subject_id', None)
    if not subject_id:
        return ''
    try:
        from learner_api.models import StaffUser
        from login.models import SUBJECT_STAFF

        if getattr(account, 'subject_type', '') != SUBJECT_STAFF:
            return ''
        row = StaffUser.objects.filter(pk=subject_id).only('access', 'type').first()
    except Exception:  # noqa: BLE001 - recording must never break a page
        # Unreadable is not the same as unset, and neither is a guess: the
        # column stays empty rather than inheriting a role from somewhere else.
        logger.warning('Could not read the staff access grant for the audit trail.', exc_info=True)
        return ''
    if row is None:
        return ''
    return clean(row.access, 60).lower() or clean(row.type, 60).lower()


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


def requested_workspace(request):
    """The ``?workspace=`` filter, or '' for every workspace.

    An unrecognised value is treated as no filter rather than as a workspace
    that matched nothing: an empty page is a claim that nobody did anything, and
    a typo must not be able to make that claim.
    """
    value = curriculum_views.clean_str(request.GET.get('workspace')).lower()
    if not value or value == 'all':
        return ''
    return value


def workspace_clause(workspace, alias=''):
    """SQL fragment + params restricting rows to one workspace.

    Two readings, because the column is added by hand and a process may be
    running before it exists:

    * With the column, an equality test that rides its index.
    * Without it, a path prefix test. Correct for every workspace whose routes
      all sit under one prefix, which is all of them except ``platform`` and the
      handful of aliased roots -- so those are matched by listing their prefixes
      rather than by pretending one prefix covers them.
    """
    if not workspace:
        return '', []
    prefix = f'{alias}.' if alias else ''
    if workspace_column_available():
        return f'{prefix}workspace = %s', [workspace]
    roots = workspace_roots(workspace)
    if not roots:
        return '1 = 0', []
    clauses = []
    params = []
    for root in roots:
        clauses.append(f'({prefix}path = %s or {prefix}path like %s)')
        params.extend([root, f'{root}/%'])
    return '(' + ' or '.join(clauses) + ')', params


def workspace_roots(workspace):
    """Every path prefix that belongs to one workspace, read from the route table.

    One segment is enough for an ordinary route -- ``/coach/caseload`` belongs to
    coach because it starts ``/coach``. The exception is ``/workspace/...``,
    where the first segment says nothing and the second names the workspace: a
    root of ``/workspace`` would hand Audit every other workspace's dashboard.

    Only used while the ``workspace`` column does not exist. Once it does, the
    filter is an equality test on the column and none of this runs.
    """
    roots = set()
    templates = list(pages.PAGES_BY_WORKSPACE.get(workspace, ()))
    templates.append((f'/workspace/{workspace}', '', '', '', ''))
    for template, _key, _label, _target_type, _param in templates:
        segments = [part for part in template.split('/{', 1)[0].split('/') if part]
        if not segments:
            continue
        depth = 2 if segments[0] == 'workspace' and len(segments) > 1 else 1
        roots.add('/' + '/'.join(segments[:depth]))
    # `platform` is the shell around everything and owns no prefix of its own:
    # its routes are a fixed list of roots, which the loop above has collected.
    return sorted(roots)


def derived_workspace(row):
    """The workspace for a stored row: its own column when there is one, else its path."""
    stored = curriculum_views.clean_str(row.get('workspace')) if 'workspace' in row else ''
    if stored:
        return stored
    return pages.workspace_for(curriculum_views.clean_str(row.get('path')))


# --------------------------------------------------------------- recording

@csrf_exempt
@require_POST
@never_cache
def activity_record(request):
    """Record page opens and read actions for the signed-in account.

    Answers 200 in every ordinary case, including when there is nothing to
    record and when the table does not exist: this is called from a navigation
    handler, and a failing beacon must never be something the person notices.
    """
    account = getattr(request, 'login_account', None)
    email = clean(getattr(account, 'email', ''), 160).lower()
    if not email:
        # No session, so no person to attribute anything to. An audit of who
        # used the LMS must not hold rows nobody can be matched to.
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
    role = clean(actor_role(account), 60)
    account_id = getattr(account, 'pk', None)
    ip = client_ip(request)
    agent = clean(request.META.get('HTTP_USER_AGENT'), MAX_USER_AGENT)
    with_workspace = workspace_column_available()

    prepared = []
    for raw in events[:MAX_EVENTS_PER_CALL]:
        if not isinstance(raw, dict):
            continue
        kind = clean(raw.get('kind'), 32)
        if kind not in EVENT_KINDS:
            continue
        path = pages.clean_path(raw.get('path'))
        # Enforced here as well as in the browser. The exclusion list is a
        # decision about what the LMS does not record, and a decision like that
        # cannot live only in code the client could skip.
        if pages.excluded(path):
            continue
        page = resolve_page(path)
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
        row = [
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
        ]
        if with_workspace:
            row.append(page['workspace'])
        prepared.append({
            'visit': clean(raw.get('visitId'), 64) or visit_id,
            'kind': kind,
            'duration': duration,
            'row': tuple(row),
            'path': page['path'],
        })

    if not prepared:
        return JsonResponse({'recorded': 0, 'available': True})

    columns = (
        'occurred_at, recorded_at, actor_email, actor_name, actor_role, account_id, visit_id, '
        'kind, path, page_key, page_label, target_type, target_id, target_label, detail, '
        'duration_ms, ip_address, user_agent'
    )
    count = 18
    if with_workspace:
        columns += ', workspace'
        count += 1
    placeholders = '(' + ', '.join(['%s'] * count) + ')'
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
        logger.warning('Could not record LMS activity.', exc_info=True)
        return JsonResponse({'recorded': recorded, 'available': True, 'reason': 'write-failed'})
    purge_expired_activity()
    return JsonResponse({'recorded': recorded, 'available': True})


# ----------------------------------------------------------------- reading

@require_GET
@never_cache
def activity_people(request):
    """Everyone who used the LMS in the window, one row each.

    Three sources, each reported separately so the page can say which of them it
    is actually looking at, rather than letting the silence of a missing one
    read as a person who did nothing:

    * ``curriculum.activity_events`` -- pages opened and read actions.
    * ``curriculum.record_revisions`` -- what they changed.
    * ``login."Login_audit"`` -- when they signed in.

    ``?workspace=`` narrows the first of those to one workspace. The other two
    are not narrowed and say so: a sign-in is account-wide and a curriculum
    revision is curriculum's, and pretending either belonged to the workspace
    being filtered would be an invention.
    """
    purge_expired_activity()
    days = quality.parse_bounded_int(
        request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, quality.window_limit(requested_workspace(request)),
    )
    search = curriculum_views.clean_str(request.GET.get('search')).lower()
    # Answered here rather than on the client, because the client only holds one
    # page: a role filter applied there would narrow the fifty rows on screen and
    # report that as the whole answer.
    role_filter = curriculum_views.clean_str(request.GET.get('role')).lower()
    page = quality.parse_bounded_int(request.GET.get('page'), 1, 1, 10_000)
    page_size = quality.parse_bounded_int(
        request.GET.get('pageSize'), DEFAULT_PEOPLE_PAGE_SIZE, 1, MAX_PEOPLE_PAGE_SIZE,
    )
    workspace = requested_workspace(request)
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
                'lastWorkspace': '',
                'workspaces': [],
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

    scope_sql, scope_params = workspace_clause(workspace)
    scope_and = f' and {scope_sql}' if scope_sql else ''

    visits_recorded = activity_available()
    if visits_recorded:
        try:
            for row in curriculum_views.fetch_all(
                'select actor_email, max(actor_name) as actor_name, max(actor_role) as actor_role, '
                'sum(case when kind = %s then 1 else 0 end) as page_views, '
                'sum(case when kind <> %s then 1 else 0 end) as read_actions, '
                'count(distinct visit_id) as visits, count(distinct page_key) as pages_opened, '
                'min(occurred_at) as first_seen, max(occurred_at) as last_seen '
                f'from {table()} where occurred_at >= %s and actor_email <> %s{scope_and} '
                'group by actor_email',
                ['page_view', 'page_view', since, ''] + scope_params,
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
            logger.warning('Could not read LMS activity for the people list.', exc_info=True)
            visits_recorded = False

    if visits_recorded:
        # Where each person was last. A correlated max(id) rather than
        # `distinct on`, which Postgres has and the local sqlite suites do not.
        # The workspace filter has to be applied to BOTH halves: narrowing only
        # the outer one would find the last page of all, then fail to match it
        # against the narrowed inner max and report nobody's last page at all.
        outer_sql, outer_params = workspace_clause(workspace, 'a')
        inner_sql, inner_params = workspace_clause(workspace, 'b')
        outer_and = f' and {outer_sql}' if outer_sql else ''
        inner_and = f' and {inner_sql}' if inner_sql else ''
        try:
            for row in curriculum_views.fetch_all(
                'select a.actor_email, a.page_key, a.page_label, a.path '
                f'from {table()} a where a.kind = %s and a.occurred_at >= %s and a.actor_email <> %s'
                f'{outer_and} '
                f'and a.id = (select max(b.id) from {table()} b '
                'where b.actor_email = a.actor_email and b.kind = %s and b.occurred_at >= %s'
                f'{inner_and})',
                ['page_view', since, ''] + outer_params + ['page_view', since] + inner_params,
            ):
                entry = people.get(curriculum_views.clean_str(row.get('actor_email')).lower())
                if entry:
                    entry['lastPageKey'] = curriculum_views.clean_str(row.get('page_key'))
                    entry['lastPageLabel'] = curriculum_views.clean_str(row.get('page_label'))
                    entry['lastWorkspace'] = pages.workspace_for(curriculum_views.clean_str(row.get('path')))
        except Exception:
            logger.warning('Could not read the last page opened per person.', exc_info=True)

    if visits_recorded:
        _attach_workspaces(people, since, workspace)

    changes_recorded = versioning.history_available()
    if changes_recorded:
        # Scoped, so the Changes column counts what this door can show. Left
        # unscoped it counted every workspace's saves against a person on
        # Curriculum Studio's own list.
        for row in quality.revision_actors(since, workspace):
            if not row['email']:
                continue
            entry = person(row['email'], row['name'])
            entry['changes'] = row['changes']

    sign_ins_recorded, sign_in_rows = read_sign_ins(since)
    for row in sign_in_rows:
        # A sign-in is account-wide, not workspace-specific (see read_sign_ins).
        # On the system-wide door that is the point: everyone who touched the
        # LMS belongs on the list. On a workspace's own scoped door it is not --
        # signing in proves nothing about Coach, so it must not be the reason
        # somebody who never opened Coach appears on Coach's People list.
        if workspace and row['email'] not in people:
            continue
        entry = person(row['email'])
        entry['signIns'] = row['count']
        seen(entry, row['firstAt'])
        seen(entry, row['lastAt'])

    matched = sorted(people.values(), key=lambda row: row['lastSeen'], reverse=True)
    if search:
        matched = [row for row in matched if search in row['email'] or search in row['name'].lower()]

    # The roles on offer are read from everyone who matched the window, the
    # workspace and the search -- deliberately before the role filter itself is
    # applied, so choosing one does not empty the list it was chosen from.
    roles = sorted({row['role'] for row in matched if row['role']})
    roles_include_blank = any(not row['role'] for row in matched)

    if role_filter == NO_ROLE:
        matched = [row for row in matched if not row['role']]
    elif role_filter:
        matched = [row for row in matched if row['role'].lower() == role_filter]

    # The totals are counted over everyone who matched, not over the page that
    # is being sent. A busy window is exactly where the headline numbers matter,
    # and exactly where summing one page would quietly report the page size
    # instead of the period.
    total = len(matched)
    # Past the last page is answered with the last page rather than with nothing:
    # a stale page number in a link should not read as "nobody used the LMS".
    pages_total = max(1, -(-total // page_size))
    page = min(page, pages_total)
    start = (page - 1) * page_size
    rows = matched[start:start + page_size]
    truncated = total > page_size

    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'workspace': workspace,
        'workspaces': pages.workspace_options(),
        'workspaceRecorded': workspace_column_available(),
        'visitsRecorded': visits_recorded,
        'changesRecorded': changes_recorded,
        # Which workspaces the Changes half can actually speak for, read from
        # what is registered rather than listed here. Named rather than implied,
        # so the page can say what it cannot yet show -- and so it stops saying
        # it the day a workspace is wired in.
        'changeWorkspaces': writes.change_workspaces(),
        'signInsRecorded': sign_ins_recorded,
        'truncated': truncated,
        'limit': page_size,
        'shown': len(rows),
        'page': page,
        'pageSize': page_size,
        'pages': pages_total,
        'total': total,
        # The roles present in this window, for the Role filter. Sent rather than
        # derived on the client for the same reason the filter is applied here:
        # one page cannot name the roles held by the people on the other pages.
        'roles': roles,
        'rolesIncludeBlank': roles_include_blank,
        'totals': {
            'people': total,
            'visits': sum(row['visits'] for row in matched),
            'pageViews': sum(row['pageViews'] for row in matched),
            'readActions': sum(row['readActions'] for row in matched),
            'changes': sum(row['changes'] for row in matched),
            'signIns': sum(row['signIns'] for row in matched),
        },
        'people': rows,
    })


def _attach_workspaces(people, since, workspace):
    """Which workspaces each person was in, newest activity first.

    Grouped by page_key rather than by path so the row count stays bounded by
    the route table rather than by the number of records anybody opened, then
    folded into workspaces here. With the ``workspace`` column present this is
    one grouped query; without it the page keys are mapped through the route
    table, which gives the same answer from the data already stored.
    """
    scope_sql, scope_params = workspace_clause(workspace)
    scope_and = f' and {scope_sql}' if scope_sql else ''
    column = 'workspace' if workspace_column_available() else 'path'
    try:
        rows = curriculum_views.fetch_all(
            f'select actor_email, {column} as bucket, count(*) as hits, max(occurred_at) as last_at '
            f'from {table()} where occurred_at >= %s and actor_email <> %s{scope_and} '
            f'group by actor_email, {column}',
            [since, ''] + scope_params,
        )
    except Exception:
        logger.warning('Could not read which workspaces each person used.', exc_info=True)
        return
    tally = {}
    for row in rows:
        email = curriculum_views.clean_str(row.get('actor_email')).lower()
        if email not in people:
            continue
        bucket = curriculum_views.clean_str(row.get('bucket'))
        key = bucket if column == 'workspace' else pages.workspace_for(bucket)
        if not key:
            continue
        entry = tally.setdefault(email, {})
        used = entry.setdefault(key, {
            'workspace': key,
            'label': pages.WORKSPACES.get(key, key.title()),
            'hits': 0,
            'lastAt': '',
        })
        used['hits'] += int(row.get('hits') or 0)
        stamp = quality.iso(row.get('last_at'))
        if stamp and stamp > used['lastAt']:
            used['lastAt'] = stamp
    for email, entry in tally.items():
        people[email]['workspaces'] = sorted(
            entry.values(), key=lambda item: (item['lastAt'], item['hits']), reverse=True,
        )


def read_sign_ins(since, email=''):
    """Successful sign-ins from ``login."Login_audit"``, grouped or listed.

    Account-wide, not workspace-specific: the sign-in is what got somebody into
    the LMS at all, and for a sitting that predates the activity table it is the
    only thing either history can still say. The page labels it as a sign-in
    rather than passing it off as a visit to any particular workspace.
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
def activity_person(request, email):
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
    workspace = requested_workspace(request)
    days = quality.parse_bounded_int(
        request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, quality.window_limit(workspace),
    )
    since = datetime.utcnow() - timedelta(days=days)

    person = {'email': email, 'name': email, 'role': '', 'firstSeen': '', 'lastSeen': ''}

    scope_sql, scope_params = workspace_clause(workspace)
    scope_and = f' and {scope_sql}' if scope_sql else ''

    visits_recorded = activity_available()
    events = []
    if visits_recorded:
        try:
            events = curriculum_views.fetch_all(
                'select id, occurred_at, actor_name, actor_role, visit_id, kind, path, page_key, '
                'page_label, target_type, target_id, target_label, detail, duration_ms, '
                'ip_address, user_agent '
                f'from {table()} where actor_email = %s and occurred_at >= %s{scope_and} '
                f'order by occurred_at asc, id asc limit {MAX_PERSON_EVENTS}',
                [email, since] + scope_params,
            )
        except Exception:
            logger.warning("Could not read one person's LMS activity.", exc_info=True)
            visits_recorded = False
            events = []

    for row in events:
        person['name'] = curriculum_views.clean_str(row.get('actor_name')) or person['name']
        person['role'] = curriculum_views.clean_str(row.get('actor_role')) or person['role']

    changes_recorded = versioning.history_available()
    changes = read_person_changes(email, since, workspace) if changes_recorded else []
    for change in changes:
        if change.get('actorName') and person['name'] == email:
            person['name'] = change['actorName']

    visits = build_visits(events, changes)
    sign_ins_recorded, sign_ins = read_sign_ins(since, email=email)
    account_events_recorded, account_events, account_events_truncated = read_account_events(since, email)

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
        'workspace': workspace,
        'workspaces': pages.workspace_options(),
        'visitsRecorded': visits_recorded,
        'changesRecorded': changes_recorded,
        'changeWorkspaces': writes.change_workspaces(),
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
        'accountEventsRecorded': account_events_recorded,
        'accountEvents': account_events,
        'accountEventsTruncated': account_events_truncated,
        'changes': changes,
    })


def read_account_events(since, email):
    """Account-wide login/logout, including failed attempts; never credentials."""
    try:
        from login.models import EVENT_LOGIN, EVENT_LOGOUT, LoginAudit

        rows = list(LoginAudit.objects.filter(
            created_at__gte=since, email__iexact=email,
            event__in=(EVENT_LOGIN, EVENT_LOGOUT),
        ).order_by('-created_at', '-pk')[:201])
        return True, [{
            'id': row.pk,
            'at': quality.iso(row.created_at),
            'event': row.event,
            'succeeded': row.succeeded,
        } for row in rows[:200]], len(rows) > 200
    except Exception:
        logger.warning('Could not read account access history.', exc_info=True)
        return False, [], False


def read_person_changes(email, since, workspace=''):
    """This person's recorded writes in this workspace, newest first.

    Scoped the same way the Changes feed is, and for the same reason: one
    revision log now holds curriculum, learner, staff, employer and coaching
    saves, so a person's page opened from Curriculum Studio's own door would
    otherwise list their coaching saves under a Curriculum heading. The
    workspace narrows the record types rather than the page filtering
    afterwards and reporting a count of what it hid.

    Each change carries the workspace it actually belongs to, rather than every
    row being stamped ``curriculum`` -- on the system-wide door they are not all
    from one workspace, and saying they are is the kind of quiet untruth an
    audit page cannot afford.
    """
    revisions = versioning.qualified(versioning.REVISIONS_TABLE)
    columns = (
        'id, entity_type, entity_id, revision_no, action, module_catalogue_id, parent_id, '
        'title, version_label, content_status, changed_fields, snapshot, actor_name, actor_email, '
        'reason, created_at'
    )
    if versioning.metadata_columns_available():
        columns += ', actor_type, triggered_by_email, triggered_by_name, source, metadata'
    where = ['lower(actor_email) = %s', 'created_at >= %s']
    params = [email, since]
    clause, scope_params = writes.revision_workspace_clause(workspace)
    where.append(clause)
    params.extend(scope_params)
    try:
        rows = curriculum_views.fetch_all(
            f'select {columns} from {revisions} '
            f'where {" and ".join(where)} '
            f'order by created_at desc, id desc limit {MAX_PERSON_CHANGES}',
            params,
        )
    except Exception:
        logger.warning("Could not read one person's recorded changes.", exc_info=True)
        return []
    changes = []
    for row in rows:
        event = quality.revision_event(row)
        event['placed'] = False
        event['workspace'] = event.get('metadata', {}).get('page_workspace') or writes.workspace_for_entity(event.get('entity', ''))
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
                'workspaces': [],
            }
            index[visit_id] = visit
            by_visit.append(visit)
        stamp = quality.iso(row.get('occurred_at'))
        if not visit['startedAt']:
            visit['startedAt'] = stamp
        visit['endedAt'] = stamp
        path = curriculum_views.clean_str(row.get('path'))
        workspace = pages.workspace_for(path)
        kind = curriculum_views.clean_str(row.get('kind'))
        if kind == 'page_view':
            visit['pages'].append({
                'id': f'ev:{row.get("id")}',
                'at': stamp,
                'endedAt': stamp,
                'path': path,
                'workspace': workspace,
                'workspaceLabel': pages.WORKSPACES.get(workspace, workspace.title()),
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
            if workspace not in visit['workspaces']:
                visit['workspaces'].append(workspace)
            continue
        page = visit['pages'][-1] if visit['pages'] else None
        if page is None:
            page = {
                'id': f'gap:{visit_id}',
                'at': stamp,
                'endedAt': stamp,
                'path': path,
                'workspace': workspace,
                'workspaceLabel': pages.WORKSPACES.get(workspace, workspace.title()),
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
            if workspace not in visit['workspaces']:
                visit['workspaces'].append(workspace)
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
        recorded_path = (change.get('metadata') or {}).get('page_path')
        if not stamp or not recorded_path:
            continue
        for visit in by_visit:
            if not visit['startedAt'] <= stamp <= visit['endedAt']:
                continue
            target = None
            for page in visit['pages']:
                if page['path'] == recorded_path and page['at'] <= stamp <= page['endedAt']:
                    target = page
            if target is None and visit['pages']:
                # Inside the visit but after the last recorded page view: that
                # page was still open, nothing new was navigated to.
                last = visit['pages'][-1]
                if last['path'] == recorded_path and stamp >= last['at']:
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
