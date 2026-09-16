"""Repair the inspected Al Fanar module; dry-run unless --apply is supplied.

Keeps every content/learner ID and creates no Teams meetings. The backup contains
the exact pre-change module and component settings in ignored private_media.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ['CURRICULUM_WARM'] = 'false'
import django
django.setup()
from django.conf import settings
from curriculum_api import views

MODULE_ID = 'MOD-2026091423231353355366EC83E5D5C3'
HOLIDAY = {'id': 'alfanar-saudi-national-day-2026', 'label': 'Saudi National Day',
           'startDate': '2026-09-23', 'endDate': '2026-09-23', 'type': 'Module closure'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    cfg = settings.DATABASES['default']
    with psycopg.connect(host=cfg['HOST'], port=cfg['PORT'], dbname=cfg['NAME'], user=cfg['USER'],
                         password=cfg['PASSWORD'], sslmode='require', connect_timeout=12, row_factory=dict_row) as connection:
        if not args.apply:
            connection.execute('SET TRANSACTION READ ONLY')
        connection.execute("SET LOCAL statement_timeout = '20s'")
        connection.execute("SET LOCAL lock_timeout = '5s'")
        lock = ' FOR UPDATE' if args.apply else ''
        module = connection.execute('SELECT * FROM curriculum.modules WHERE module_catalogue_id=%s AND deleted_at IS NULL' + lock, (MODULE_ID,)).fetchone()
        assert module and module['title'] == 'Advanced Project and Logistics Management'
        assert module['sessions_number'] in (3, 16), 'Module changed since diagnosis; inspect again.'
        assert module['weeks_number'] == 17
        weeks = connection.execute('SELECT id,title,display_order,week_number FROM curriculum.weeks WHERE module_catalogue_id=%s AND deleted_at IS NULL ORDER BY display_order,week_number,id' + lock, (MODULE_ID,)).fetchall()
        components = connection.execute('SELECT id,week_id,type,settings_json,updated_at FROM curriculum.components WHERE module_catalogue_id=%s AND deleted_at IS NULL ORDER BY display_order,id' + lock, (MODULE_ID,)).fetchall()
        assert len(weeks) == 17 and sum(week['title'] == 'Saudi National Day' for week in weeks) == 1
        live = [component for week in weeks for component in components if component['week_id'] == week['id'] and component['type'] == 'live_session']
        assert len(live) == 16
        assert not connection.execute('SELECT 1 FROM curriculum.live_sessions WHERE module_catalogue_id=%s LIMIT 1', (MODULE_ID,)).fetchone(), 'Calendar already exists; do not rewrite tracked dates.'
        cohort = connection.execute('SELECT start_date,excluded_holiday_ids FROM curriculum.cohorts WHERE cohort_id=%s', (module['cohort_id'],)).fetchone()
        holidays = connection.execute('SELECT id,label,start_date,end_date,type,notes FROM curriculum.holidays WHERE NOT COALESCE(is_archived,false)').fetchall()
        england = connection.execute("SELECT id,title AS label,holiday_date AS start_date,holiday_date AS end_date,notes FROM curriculum.england_holidays WHERE division='england-and-wales'").fetchall()
        holidays = views.scheduling_holidays_from([*holidays, *england], cohort['start_date'], views.parse_json_value(cohort['excluded_holiday_ids'], []))
        own = [h for h in views.parse_json_value(module.get('session_holidays'), []) if h.get('id') != HOLIDAY['id']]
        own.append(HOLIDAY)
        proposed = {**module, 'sessions_number': 16, 'session_holidays': own}
        plan = views.module_delivery_session_plan(proposed, 16, module['start_date'], holidays)
        assert len(plan['sessions']) == 16 and plan['finalEndDate'] == '2026-11-18', 'Unexpected holiday plan; inspect again.'
        assert plan['skippedHolidays'] == ['2026-09-23', '2026-09-28', '2026-09-30']
        updates = []
        for component, session in zip(live, plan['sessions']):
            existing = views.parse_json_value(component['settings_json'], {})
            assert not existing.get('teamsLiveSessionId') and not existing.get('teamsOccurrenceId')
            instant = views.calendar_clock_to_utc_iso(session['date'], session['startTime'])
            updates.append((component['id'], {**existing, 'sessionDate': session['date'], 'sessionDay': session['day'],
                'sessionTime': session['startTime'], 'durationMinutes': session['durationMinutes'],
                'teamsDurationMinutes': session['durationMinutes'], 'sessionDateTimeUtc': instant, 'teamsStartDateTimeUtc': instant}))
        summary = {'moduleId': MODULE_ID, 'previousCount': module['sessions_number'], 'sessionCount': 16,
                   'firstDate': plan['sessions'][0]['date'], 'lastDate': plan['finalEndDate'],
                   'skippedDates': plan['skippedHolidays'], 'preservedContentRows': len(weeks),
                   'dates': [{'date': s['date'], 'start': s['startTime'], 'end': s['endTime']} for s in plan['sessions']]}
        if args.apply:
            assert 'session_holidays' in module, 'Apply curriculum migration 0064 first.'
            backup_dir = Path(__file__).resolve().parents[1] / 'private_media' / 'schedule-repair-backups'
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup = backup_dir / f'{MODULE_ID}-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.json'
            backup.write_text(json.dumps({'module': module, 'weeks': weeks, 'components': components}, default=str, indent=2), encoding='utf-8')
            result = connection.execute('UPDATE curriculum.modules SET sessions_number=16,end_date=%s,session_holidays=%s,updated_at=CURRENT_TIMESTAMP WHERE module_catalogue_id=%s', (plan['finalEndDate'], Jsonb(own), MODULE_ID))
            assert result.rowcount == 1
            for component_id, updated in updates:
                result = connection.execute('UPDATE curriculum.components SET settings_json=%s,updated_at=CURRENT_TIMESTAMP WHERE id=%s AND module_catalogue_id=%s', (Jsonb(updated), component_id, MODULE_ID))
                assert result.rowcount == 1
            connection.commit()
            summary.update(applied=True, backup=str(backup))
        else:
            summary['applied'] = False
        print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
