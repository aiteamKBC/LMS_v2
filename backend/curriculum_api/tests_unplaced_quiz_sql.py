"""PostgreSQL coverage for quiz recovery, using only synthetic SELECTs."""
import os
import re
import unittest

from django.db import connections
from django.test import SimpleTestCase

from learner_api.quiz_placement import UNPLACED_QUIZ_SQL


def fixture_sql():
    # Reuse the production query with relations backed by synthetic rows.
    relations = {
        'curriculum.components': '''
            (VALUES ('target','M','W','quiz',NULL::timestamp,'{"linkedQuizId":"10"}'::jsonb),
                    ('other','OTHER','W-OTHER','quiz',NULL,'{"linkedQuizId":"10"}'::jsonb),
                    ('alternate','M','W','quiz',NULL,'{"linkedQuizId":"11"}'::jsonb),
                    ('manual','MANUAL','W-MANUAL','quiz',NULL,'{"linkedQuizId":"10"}'::jsonb))
        ''',
        'curriculum.modules': '''
            (VALUES ('M','Current',NULL::timestamp,false,'inherited'),
                    ('OTHER','Other',NULL,false,'inherited'),
                    ('MANUAL','Manual',NULL,false,'manual'))
        ''',
        'curriculum.weeks': '''
            (VALUES ('W','M','Week',NULL::timestamp),('W-OTHER','OTHER','Week',NULL),
                    ('W-MANUAL','MANUAL','Week',NULL))
        ''',
        'curriculum.quiz_component_links': '''
            (SELECT ''::text AS component_id, 0::bigint AS quiz_id WHERE false)
        ''',
        'curriculum.groups': '''
            (VALUES ('G','Group','Programme','P','["M","MANUAL"]'::jsonb,
                     NULL::timestamp,false,NULL::timestamp,NULL::timestamp),
                    ('B','Both','Programme','P','["M","OTHER"]'::jsonb,NULL,false,NULL,NULL))
        ''',
        '"Learner".learners': '''
            (VALUES (1,101,'G'),(2,102,'B'),(3,103,'G'),(4,104,'G'),(5,105,'B'),
                    (6,106,'G'),(7,107,'G'),(8,108,'G'))
        ''',
        'enrolment."Created_users"': '''
            (VALUES (101,'Programme','Group',NULL::jsonb,'[{"moduleId":"M"}]'::jsonb),
                    (102,'Programme','Both',NULL,'[{"moduleId":"M"}]'),
                    (103,'Programme','Group',NULL,'[]'),
                    (104,'Programme','Group',NULL,NULL),
                    (105,'Programme','Both','[{"moduleId":"M","assignmentMode":"explicit"}]',
                     '[{"moduleId":"OTHER"}]'),
                    (106,'Programme','Group',NULL,'[{"moduleId":"OTHER","assignmentMode":"explicit"}]'),
                    (107,'Programme','Group',NULL,'"legacy string"'),
                    (108,'Programme','Group',NULL,NULL))
        ''',
        '"Learner".learner_progress_entries': '''
            (VALUES
                (1,1,'quiz',true,now(),NULL::timestamp,NULL::text,NULL::text,NULL::text,NULL::text,'Old','Week','10'),
                (2,2,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (3,3,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (4,4,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (5,5,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (6,6,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (7,7,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (8,8,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (9,1,'quiz',false,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10'),
                (10,1,'quiz',true,now(),now(),NULL,NULL,NULL,NULL,'Old','Week','10'),
                (11,1,'quiz',true,now(),NULL,'other',NULL,NULL,NULL,'Old','Week','10'),
                (12,1,'quiz',true,now(),NULL,NULL,NULL,'OTHER',NULL,'Old','Week','10'),
                (13,1,'quiz',true,now(),NULL,NULL,NULL,NULL,'W-OTHER','Old','Week','10'),
                (14,1,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Wrong week','10'),
                (15,1,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Other','Week','10'),
                (16,1,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'M','Week','11'),
                (17,2,'quiz',true,now(),NULL,NULL,NULL,NULL,'W','Old','Week','10'),
                (18,2,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'OTHER','Week','10'),
                (19,1,'quiz',true,now(),NULL,NULL,NULL,NULL,NULL,'Old',NULL,'10'),
                (20,1,'quiz_reading',true,now(),NULL,NULL,NULL,NULL,NULL,'Old','Week','10')
            )
        ''',
    }
    columns = {
        'c': 'id,module_catalogue_id,week_id,type,deleted_at,settings_json',
        'm': 'module_catalogue_id,title,deleted_at,is_programme_deleted,learner_roster_mode',
        'w': 'id,module_catalogue_id,title,deleted_at',
        'g': 'group_id,group_name,programme_name,programme_id,module_ids,deleted_at,is_programme_deleted,updated_at,created_at',
        'l': 'id,enrolment_id,group_id',
        'lp': 'id,enrolment_id,group_id',
        'u': 'id,"Programme","Group","Training_plan","Learning_plan"',
        'p': 'id,learner_id,kind,passed,submitted_at,deleted_at,component_ref,curriculum_component_ref,module_ref,week_ref,module_title,week_title,quiz_ref',
    }
    pattern = '(' + '|'.join(map(re.escape, relations)) + r') (lp|[cgmwulp])\b'

    def replace(match):
        relation, alias = match.groups()
        fields = f'({columns[alias]})' if alias in columns else ''
        if relation == 'curriculum.quiz_component_links':
            fields = ''
        return f'{relations[relation]} AS {alias}{fields}'

    return re.sub(pattern, replace, UNPLACED_QUIZ_SQL)


def fixture_results(cursor):
    cursor.execute(fixture_sql(), ['M', [1, 2, 3, 4, 5, 6, 7]])
    return sorted((row[0], row[-1]) for row in cursor.fetchall())


EXPECTED = [(1, 'target'), (4, 'target'), (5, 'target'), (16, 'alternate'), (17, 'target')]


@unittest.skipUnless(os.getenv('CURRICULUM_SQL_COUNT_LIVE_CHECK') == '1', 'requires a verified PostgreSQL runner')
class UnplacedQuizSqlTests(SimpleTestCase):
    databases = {'enrolment'}

    def test_effective_plan_recovery_preserves_exact_evidence_and_rejects_ambiguity(self):
        with connections['enrolment'].cursor() as cursor:
            self.assertEqual(fixture_results(cursor), EXPECTED)
