"""The compact reader preserves reviewed identity decisions and legacy shapes."""
import json
from unittest.mock import Mock

from django.db.models import Value
from django.test import SimpleTestCase

from curriculum_api.attendance_link_policy import apply_reviewed_identities
from curriculum_api.session_results_policy import attendance_display_name, attendance_identity
from .attendance_identity_projection import AttendanceIdentityProjection


def identity_cases():
    return [None, False, [], '', 'invalid', json.dumps({'identity':{'displayName':'Learner One','id':'U1'}}),
        {}, {'identity':None}, {'identity':'invalid'},
        {'identity':{'displayName':'Learner One','id':'U1'}},
        {'identity':{'user':{'displayName':'Learner One','id':'U1'}}},
        {'identity':{'guest':{'displayName':'Learner One','id':'U1'}}},
        {'identity':{'phone':{'displayName':'Learner One','id':'U1'}}},
        {'identity':{'encrypted':{'displayName':'Learner One','id':'U1'}}},
        {'identity':{'name':'Learner One'}, 'attendanceIntervals':[{'raw':'unused'}]},
        {'displayName':'Learner One','other':'unused'},
        {'participantDisplayName':'Learner One','other':'unused'},
        {'name':'Learner One','other':'unused'},
        {'identity':{'id':'U1'},'lmsAccountResolution':{'status':'resolved','mail':'learner@example.test'},
         'attendanceIntervals':[{'raw':'unused'}],'totalAttendanceInSeconds':999},
    ]


def assert_identity_parity(test, full, compact):
    records = [{'id':'A1','occurrence_id':'O1','email':'','display_name':'','role':'attendee','raw_data':full},
               {'id':'A2','occurrence_id':'O1','email':'','display_name':'', 'role':'attendee',
                'raw_data':{'identity':{'displayName':'Learner One','id':'OTHER'}}}]
    projected = [{**records[0], 'raw_data':compact}, records[1]]
    test.assertEqual(attendance_display_name(records[0]), attendance_display_name(projected[0]))
    test.assertEqual(attendance_identity(records[0]), attendance_identity(projected[0]))
    roster = {'learner@example.test':{'name':'Learner One','learnerProfileId':9}}
    scenarios = [([], [], []),
        ([{'alias_email':'guest@example.test','canonical_email':'learner@example.test'}], [], []),
        ([], [{'occurrence_id':'O1','attendance_row_id':'A1','canonical_email':'learner@example.test'}], []),
        ([], [], [{'identity_kind':'record','identity_value':'O1:A1','active':False}])]
    for aliases, links, rules in scenarios:
        before = apply_reviewed_identities(records, aliases, links, rules, learners=roster)
        after = apply_reviewed_identities(projected, aliases, links, rules, learners=roster)
        # Raw bodies intentionally differ; every identity decision must agree.
        test.assertEqual([{k:v for k,v in row.items() if k!='raw_data'} for row in before],
                         [{k:v for k,v in row.items() if k!='raw_data'} for row in after])


class AttendanceIdentityProjectionTests(SimpleTestCase):
    def test_reviewed_identity_rules_keep_full_roster_and_legacy_shapes(self):
        for full in identity_cases():
            compact = {key:full.get(key) for key in AttendanceIdentityProjection.keys} if isinstance(full,dict) else full
            assert_identity_parity(self, full, compact)

    def test_sql_projection_binds_repeated_expression_and_sqlite_keeps_original(self):
        compiler = Mock()
        compiler.compile.return_value = ('%s', ['synthetic value'])
        projection = AttendanceIdentityProjection(Value(None))
        sql, params = projection.as_postgresql(compiler,None)
        self.assertEqual(params, ['synthetic value']*(len(projection.keys)+2))
        self.assertIn("CASE WHEN jsonb_typeof(%s)='object'",sql)
        self.assertIn('ELSE %s END',sql)
        self.assertNotIn('attendanceIntervals',sql)
        self.assertEqual(projection.as_sqlite(compiler,None),('%s',['synthetic value']))
