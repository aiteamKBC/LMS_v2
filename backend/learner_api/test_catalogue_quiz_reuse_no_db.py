"""Overlapping quiz scopes must retain placements without refetching rows."""
from copy import deepcopy
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import learner_detail as detail


class CatalogueQuizReuseTests(SimpleTestCase):
    def read(self, reuse, *, extra_explicit=False):
        weeks=[{'moduleId':mid,'module':title,'weekId':wid,'week':wid}
               for mid,title,wid in [('M1','One','W1'),('M2','Two','W2')]]
        rows=[(1,'W1','Week quiz',3,10,'Minutes','P','Programme','One'),
              (2,'','Explicit quiz',3,10,'Minutes','P','Programme','One'),
              (3,'','Title quiz',3,10,'Minutes','P','Programme','Two'),
              (4,'W1','Week fallback',3,10,'Minutes','OTHER','Other','One'),
              (5,'','Foreign programme',3,10,'Minutes','OTHER','Other','One')]
        links=[(1,'M1','W1'),(1,'M2',''),(2,'M1','')]
        cursor=MagicMock()
        connection=MagicMock()
        connection.cursor.return_value.__enter__.return_value=cursor
        def execute(sql,params):
            if 'FROM curriculum.quiz_course_links' in sql:
                result=links if extra_explicit else links[:2]
            elif 'FROM curriculum.record_revisions' in sql:
                result=[]
            elif 'week_id = ANY' in sql:
                result=[rows[0],rows[3]]
            elif 'AND id = ANY' in sql:
                result=[row for row in rows if row[0] in params[0]]
            elif "lower(COALESCE(module, ''))" in sql:
                result=[row for row in rows if row[8].lower() in params[0]
                        and (len(params)==1 or row[0] not in params[1])]
            else:
                raise AssertionError('Unexpected quiz read')
            cursor.fetchall.return_value=deepcopy(result)
        cursor.execute.side_effect=execute
        metadata={'quiz_modules':{mid:{'module':title,'programmeId':'P','programme':'Programme'}
                                  for mid,title in [('M1','One'),('M2','Two')]}}
        with patch.object(detail,'connections',{'enrolment':connection}):
            result=detail._append_week_quizzes(weeks,[],assigned_modules=[{'moduleId':'M1'},{'moduleId':'M2'}],
                strict=True,resolved_metadata=metadata,reuse_loaded_quizzes=reuse)
        return result,cursor.execute.call_args_list

    def test_overlapping_week_and_module_scopes_preserve_cross_module_placement(self):
        before,before_calls=self.read(False)
        after,after_calls=self.read(True)
        self.assertEqual(after,before)
        self.assertEqual(len(after_calls),len(before_calls)-1)
        quizzes=[(row['moduleId'],row['quizMeta']['quizId']) for row in after[1]]
        self.assertIn(('M1',1),quizzes)
        self.assertIn(('M2',1),quizzes)
        self.assertIn(('M1',4),quizzes)
        self.assertNotIn(('M1',5),quizzes)
        title_read=next(call for call in after_calls if 'AND NOT (id = ANY' in call.args[0])
        self.assertEqual(title_read.args[1],[['one','two'],[1,4]])

    def test_explicit_scope_fetches_only_unread_quizzes_and_keeps_existing_order(self):
        before,_=self.read(False,extra_explicit=True)
        after,calls=self.read(True,extra_explicit=True)
        self.assertEqual(after,before)
        explicit=next(call for call in calls if 'AND id = ANY' in call.args[0])
        self.assertEqual(explicit.args[1],[[2]])
        title_read=next(call for call in calls if 'AND NOT (id = ANY' in call.args[0])
        self.assertEqual(title_read.args[1],[['one','two'],[1,2,4]])
