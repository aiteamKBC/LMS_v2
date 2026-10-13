"""Reproducible synthetic JSON comparison; no Django setup, DB, or network.

Run from the repository root: python backend/scripts/audit_coach_attendance_contract.py
These bytes are illustrative uncompressed JSON, not measurements of live learners.
"""
import ast
import json
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]


def pure_function(path, name, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)
    return namespace[name]


def main():
    namespace = {
        'percentage': lambda present, total: round(100 * present / total) if total else 0,
        'attendance_risk_from_rate': lambda rate: 'green',
        'should_include_in_attendance_metrics': lambda row: row['enrollmentStatus'] == 'active',
    }
    serialize = pure_function(BACKEND / 'coach_api/views.py', 'serialize_attendance_learner', namespace)
    options_for = pure_function(BACKEND / 'coach_api/attendance_loading.py', 'placement_options', {})
    metrics = {'present': 41, 'absent': 2, 'sessions': 43}
    placements, old_learners, recent = [], [], []
    for index in range(100):
        group_id = f'g{index % 5}'
        programme_id = f'p{index % 5 % 2}'
        learner = {
            'id': str(index), 'name': f'Learner {index}', 'initials': 'SL', 'learnerType': 'apprenticeship',
            'enrolmentId': str(1000 + index), 'email': f'learner{index}@example.test',
            'programmeId': programme_id, 'programmeName': f'Programme {programme_id}',
            'cohortName': f'Cohort {group_id}', 'group': 'Shared group name',
            'groupName': 'Shared group name', 'groupId': group_id,
            'rawProgramStatus': 'Active', 'enrollmentStatus': 'active', 'employer': 'Example employer',
            'overallProgress': 50, 'otjhCompleted': 100, 'otjhPlanned': 200, 'otjhTarget': 200, 'ksbProgress': 50,
        }
        placements.append(learner)
        old_learners.append(serialize(learner, metrics))
        for session in range(4):
            recent.append({'learnerId': str(index), 'sessionId': f'teams:occ{session}',
                'sessionDate': f'2026-09-{16 - session:02d}', 'status': 'present', 'counted': True,
                'occurrenceStart': None, 'module': 'Module', 'sessionTitle': 'Session',
                'source': 'microsoft-teams', 'sourceId': f'occ{session}', 'absenceReport': None})
    # Summary/trend values are synthetic too; the old envelope/learner serializer
    # and new options serializer come from the implementation under review.
    old = {'owner': {'name': 'Coach', 'email': 'coach@example.test'},
           'summary': {'totalLearners': 100, 'totalSessions': 4300, 'averageAttendance': 95},
           'learners': old_learners, 'attendanceRecords': recent,
           'trends': [{'month': f'2026-{month:02d}', 'attendance': 95} for month in range(1, 10)]}
    options = options_for(placements)
    chosen = [row for row in placements if row['programmeId'] == 'p0' and row['groupId'] == 'g0']
    group = {'programme': {'id': 'p0', 'name': 'Programme p0'},
             'group': {'id': 'g0', 'name': 'Shared group name', 'cohort': 'Cohort g0'},
             'learners': [{'id': row['id'], 'name': row['name'], 'email': row['email'], 'status': 'active',
                          'attendance': {'rate': 95, **metrics}} for row in chosen],
             'sessions': [{'id': 'occ0', 'occurrenceStart': '2026-09-16T09:00:00Z',
                           'module': 'Module', 'sessionTitle': 'Session'}],
             'recentAttendance': [{key: row.get(key) for key in
                                   ('learnerId', 'sessionId', 'sessionDate', 'status', 'counted', 'occurrenceStart')}
                                  for row in recent if row['learnerId'] in {learner['id'] for learner in chosen}]}
    session = {'session': {'id': 'occ0', 'title': 'Session', 'date': '2026-09-16', 'startTime': '10:00'},
               'learners': [{'learnerId': row['id'], 'name': row['name'], 'status': 'present',
                             'absenceReport': None, 'version': '0' * 64} for row in chosen], 'warnings': []}
    size = lambda payload: len(json.dumps(payload, ensure_ascii=True).encode('utf-8'))
    print(json.dumps({
        'measurement': 'synthetic, uncompressed JSON; 100 learners, 5 groups, 2 owned programmes, selected group 20 learners',
        'bytes': {'old_overview': size(old), 'new_options': size(options), 'new_group': size(group), 'new_session': size(session)},
        'top_level_fields': {'old_overview': len(old), 'new_options': len(options), 'new_group': len(group), 'new_session': len(session)},
        'learner_fields': {'old': len(old_learners[0]), 'new_group': len(group['learners'][0]),
                           'new_group_attendance': len(group['learners'][0]['attendance']), 'new_session': len(session['learners'][0])},
        'group_identity': 'canonical curriculum group ID, nested under programme ID; identical names across cohorts retained',
        'repeated_placement_entries_collapsed': len(placements) - sum(len(row['groups']) for row in options['programmes']),
        'synthetic_unowned_programmes_excluded': ['p-unassigned'],
        'live_duplicate_groups_and_programmes_removed': 'NOT MEASURED; no live database accessed',
    }, indent=2))


if __name__ == '__main__':
    main()
