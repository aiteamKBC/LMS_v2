"""Plan or apply existing tutor room permissions without calendar/email writes.

Defaults to a read-only plan. Applying requires an explicit database target and
a new private backup file. Only active LMS-owned calendars and verified internal
staff already invited to every meeting qualify. Uncertain series are skipped.
"""
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from urllib.parse import quote, urlencode

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from curriculum_api.teams_presenter_rooms import (
    UnsafeRoomPromotion, apply_room_promotion, fingerprint, prepare_room_promotion,
)


EVENT_FIELDS = 'id,subject,start,end,type,recurrence,isCancelled,hideAttendees,organizer,attendees,onlineMeeting'


class Command(BaseCommand):
    help = 'Plan presenter co-organizer permissions; --apply changes roles only, never invitations or mail.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--apply', action='store_true')
        mode.add_argument('--dry-run', action='store_true')
        parser.add_argument('--live-session-id', default='')
        parser.add_argument('--expected-host', default='')
        parser.add_argument('--expected-database', default='')
        parser.add_argument('--backup-file', type=Path)

    def handle(self, *args, **options):
        if connection.vendor != 'postgresql':
            raise CommandError('This repair requires the verified PostgreSQL curriculum database.')
        if not options['apply']:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute('SET TRANSACTION READ ONLY')
                return self.run_plan(**options)
        return self.run_plan(**options)

    def run_plan(self, **options):
        from coach_api.views import has_graph_credentials, microsoft_graph_request
        from curriculum_api import views as v

        applying = options['apply']
        cfg = connection.settings_dict
        if applying and (not options['backup_file'] or not options['expected_host'] or not options['expected_database']):
            raise CommandError('--apply requires --expected-host, --expected-database and a new --backup-file.')
        if applying and (cfg.get('HOST') != options['expected_host'] or cfg.get('NAME') != options['expected_database']):
            raise CommandError('The configured database does not match the explicitly requested target.')
        with connection.cursor() as cursor:
            cursor.execute('SELECT current_database()')
            actual_database = cursor.fetchone()[0]
        if actual_database != cfg.get('NAME'):
            raise CommandError('The connected database does not match the configured target.')
        if not has_graph_credentials():
            raise CommandError('The existing Microsoft Graph application is not configured.')
        if not v.table_exists(v.LIVE_SESSIONS_TABLE) or not v.has_column(v.LIVE_SESSIONS_TABLE, 'co_organizers'):
            raise CommandError('The existing live-session role schema is required; this command never creates tables.')

        backup = None
        if applying:
            path = options['backup_file'].resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                backup = path.open('x', encoding='utf-8')
            except FileExistsError:
                raise CommandError('The backup file already exists; supply a new private file.') from None

        def graph(method, path, payload=None):
            if method not in {'GET', 'PATCH'} or (method == 'PATCH' and '/onlineMeetings/' not in path):
                raise UnsafeRoomPromotion('non_role_write_forbidden')
            if method == 'PATCH' and (set(payload or {}) != {'participants'}
                                      or set(payload['participants']) != {'attendees'}):
                raise UnsafeRoomPromotion('non_role_write_forbidden')
            return microsoft_graph_request(method, path, payload=payload,
                                           extra_headers={'Prefer': 'include-unknown-enum-members'})

        account_cache = {}
        def account(email, *, staff=False):
            key = email.strip().casefold()
            if key not in account_cache:
                fields = 'id,mail,userPrincipalName,userType,accountEnabled'
                try:
                    person = graph('GET', f'users/{quote(key, safe="")}?{urlencode({"$select": fields})}')
                except RuntimeError:
                    literal = key.replace("'", "''")
                    data = graph('GET', 'users?' + urlencode({'$select': fields, '$top': 2,
                                                              '$filter': f"mail eq '{literal}'"}))
                    people = data.get('value') or []
                    if len(people) != 1:
                        raise UnsafeRoomPromotion('presenter_account_unconfirmed')
                    person = people[0]
                account_cache[key] = {**person, 'email': email}
            person = dict(account_cache[key])
            if staff:
                with connection.cursor() as cursor:
                    cursor.execute('SELECT 1 FROM enrolment."Staff_users" WHERE lower(trim("Email")) = %s LIMIT 1', [key])
                    person['staffVerified'] = bool(cursor.fetchone())
            return person

        filters = "status in ('active', 'week-meeting')"
        params = []
        if options['live_session_id']:
            filters += ' and id = %s'
            params.append(options['live_session_id'])
        counts = Counter()
        try:
            for series in v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, filters, params, 'id asc', ensure_tables=False):
                live_id = series['id']
                apply_started = False
                presenters = v.teams_series_email_list(series.get('presenters'))
                if not presenters:
                    counts['no_presenters'] += 1
                    continue
                try:
                    organizer = v.clean_str(series.get('organizer_email'))
                    owner = account(organizer)
                    if not owner.get('id'):
                        raise UnsafeRoomPromotion('organizer_unconfirmed')
                    people = [account(email, staff=True) for email in presenters]
                    co = v.teams_series_email_list(series.get('co_organizers'))
                    targets, seen = [], set()
                    def add(event_id, meeting_id, link):
                        if not link or link in seen:
                            return
                        if not event_id:
                            raise UnsafeRoomPromotion('calendar_identity_missing')
                        seen.add(link)
                        targets.append({'eventId': event_id, 'meetingId': meeting_id, 'joinUrl': link,
                                        'ownerId': owner['id'], 'organizerEmail': organizer})
                    add(series.get('graph_event_id'), series.get('online_meeting_id'), series.get('join_url'))
                    for entry in v.parse_json_value(series.get('calendar_series'), []) or []:
                        add(entry.get('eventId'), entry.get('onlineMeetingId'), entry.get('joinUrl'))
                    for occurrence in v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE,
                                                             'live_session_id = %s', [live_id], ensure_tables=False):
                        if occurrence.get('status') not in {'cancelled', 'superseded'}:
                            add(occurrence.get('graph_event_id'), occurrence.get('online_meeting_id'), occurrence.get('join_url'))
                    if not targets:
                        raise UnsafeRoomPromotion('meeting_identity_missing')
                    plans = []
                    for target in targets:
                        owner_path = 'users/' + quote(owner['id'], safe='')
                        if not target['meetingId']:
                            query = urlencode({'$filter': "joinWebUrl eq '" + target['joinUrl'].replace("'", "''") + "'"})
                            meetings = graph('GET', owner_path + '/onlineMeetings?' + query).get('value') or []
                            if len(meetings) != 1:
                                raise UnsafeRoomPromotion('meeting_identity_unconfirmed')
                            target['meetingId'] = meetings[0]['id']
                        path = owner_path + '/onlineMeetings/' + quote(target['meetingId'], safe='')
                        event_path = owner_path + '/events/' + quote(target['eventId'], safe='') + '?' + urlencode({'$select': EVENT_FIELDS})
                        meeting, event = graph('GET', path), graph('GET', event_path)
                        plan = prepare_room_promotion(target, meeting, event, people, co)
                        plans.append((path, event_path, plan))
                    if applying:
                        with transaction.atomic():
                            with connection.cursor() as cursor:
                                cursor.execute(f'SELECT id FROM {v.authoring_table_name(v.LIVE_SESSIONS_TABLE)} WHERE id = %s FOR UPDATE NOWAIT', [live_id])
                            fresh = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], ensure_tables=False)[0]
                            if fingerprint(fresh) != fingerprint(series):
                                raise UnsafeRoomPromotion('concurrent_lms_change')
                            backup.write(json.dumps({'liveSessionId': live_id,
                                'previousCoOrganizers': co, 'presenters': presenters,
                                'meetings': [{'path': path, 'changes': plan['changes']} for path, _, plan in plans]}) + '\n')
                            backup.flush()
                            os.fsync(backup.fileno())
                            for path, event_path, plan in plans:
                                apply_started = True
                                apply_room_promotion(plan, path, graph, lambda p=event_path: graph('GET', p))
                            confirmed_co = plans[0][2]['coOrganizers']
                            # Targeted SQL avoids runtime schema bootstrap and full-row
                            # storage logging. Presenter lists and all meeting fields stay intact.
                            with connection.cursor() as cursor:
                                cursor.execute(
                                    f'UPDATE {v.authoring_table_name(v.LIVE_SESSIONS_TABLE)} '
                                    'SET co_organizers = %s::jsonb, updated_at = %s WHERE id = %s',
                                    [json.dumps(confirmed_co), datetime.now(timezone.utc), live_id],
                                )
                                cursor.execute(
                                    f'SELECT co_organizers, presenters FROM {v.authoring_table_name(v.LIVE_SESSIONS_TABLE)} WHERE id = %s',
                                    [live_id],
                                )
                                saved_co, saved_presenters = cursor.fetchone()
                                if (v.teams_series_email_list(saved_co) != confirmed_co
                                        or v.teams_series_email_list(saved_presenters) != presenters):
                                    raise UnsafeRoomPromotion('database_readback_unconfirmed')
                            # Update only role metadata on cards bound to this exact live session.
                            components = v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE,
                                "settings_json ->> 'teamsLiveSessionId' = %s or settings_json ->> 'extraTeamsLiveSessionId' = %s",
                                [live_id, live_id], ensure_tables=False)
                            for component in components:
                                settings = v.parse_json_value(component.get('settings_json'), {}) or {}
                                for binding, role_key in (('teamsLiveSessionId', 'teamsCoOrganizers'),
                                                          ('extraTeamsLiveSessionId', 'extraTeamsCoOrganizers')):
                                    if settings.get(binding) != live_id:
                                        continue
                                    backup.write(json.dumps({'liveSessionId': live_id, 'componentId': component['id'],
                                        'roleKey': role_key, 'wasPresent': role_key in settings,
                                        'previousValue': settings.get(role_key)}) + '\n')
                                    backup.flush()
                                    os.fsync(backup.fileno())
                                    with connection.cursor() as cursor:
                                        # Change one JSON property, preserving concurrent edits to
                                        # unrelated card fields and refusing a rebound card.
                                        cursor.execute(
                                            f'UPDATE {v.authoring_table_name(v.AUTHORING_COMPONENTS_TABLE)} '
                                            f"SET settings_json = jsonb_set(settings_json, '{{{role_key}}}', %s::jsonb, true) "
                                            'WHERE id = %s AND settings_json ->> %s = %s',
                                            [json.dumps(confirmed_co), component['id'], binding, live_id],
                                        )
                                        if cursor.rowcount != 1:
                                            raise UnsafeRoomPromotion('concurrent_component_binding')
                        v.invalidate_curriculum_cache()
                    counts['applied' if applying else 'eligible'] += 1
                    counts['meetings'] += len(plans)
                    counts['role_changes'] += sum(len(plan['changes']) for _, _, plan in plans)
                except UnsafeRoomPromotion as exc:
                    if apply_started:
                        raise CommandError(f'{live_id}: update incomplete ({exc}); reconcile the private backup with Microsoft before retrying.') from None
                    counts[str(exc)] += 1
                    self.stdout.write(f'{live_id}: SKIPPED {exc}')
                except Exception as exc:
                    # A PATCH may already have succeeded. Stop and retain the backup for
                    # reconciliation; never label a partial or uncertain write as success.
                    if applying:
                        raise CommandError(f'{live_id}: update incomplete ({type(exc).__name__}); use the private backup and read Microsoft before retrying.') from None
                    counts['read_unavailable'] += 1
                    self.stdout.write(f'{live_id}: SKIPPED read_unavailable ({type(exc).__name__})')
        finally:
            if backup:
                backup.close()
        self.stdout.write(json.dumps({'mode': 'apply' if applying else 'read_only_plan', 'counts': dict(counts)}, sort_keys=True))
