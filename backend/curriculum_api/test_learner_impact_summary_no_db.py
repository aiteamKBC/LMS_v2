"""The programme Learners dialog's summary view, without a database.

Pins the roll-up that moved from programmes/page.tsx (learnerAchievementMap) to
the server: achieved weight from progress rows only, reflections annotating
existing lines, declared weight beside achieved weight, labels sent once, and
the plain response left untouched when ``view=summary`` is not asked for.
"""
import json
import math
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views
from curriculum_api.learner_impact_summary import learner_impact_summary, learner_ksb_achievements


def progress(learner, code, title='Reading', **extra):
    return {'learnerId': learner, 'code': code, 'weight': 1, 'componentTitle': title,
            'module': 'Module A', 'week': 'Week 1', 'componentType': 'reading', **extra}


PAYLOAD = {
    'scope': 'programme', 'identifier': 'PROG-1', 'assignedLearners': [{'id': 7}], 'assignedLearnerCount': 1,
    'learnerKsbConsumption': [{'learnerId': 7}], 'otjhAchievement': {'learners': []}, 'ksbAchievement': {},
    'coverage': {'items': [1] * 50}, 'programmeCoverage': {'items': [1] * 50},
    'consumptionSources': {
        'progress': [
            progress(7, ' k1 ', plannedOtjh=1.5, plannedOtjhSource='component'),
            progress(7, 'K1', title='Quiz', weight=2),
            progress(7, 'K1', weight='bad'),            # unreadable weight counts, adds nothing
            progress(8, 'S2'),
            progress(0, 'K9'),                           # falsy learner: skipped, as on the page
            progress(7, ''),                             # no code: skipped
        ],
        'outOfScopeProgress': [progress(7, 'B1')],
    },
    'learnerActivities': [
        {'learnerId': 7, 'actualOtjh': 2, 'actualOtjhSource': 'reflection', 'reflection': {'text': ' Learned a lot '},
         'ksbSnapshot': [{'code': 'k1'}, {'code': 'B5'}], 'declaredReflectionKsbs': [{'code': 'K1', 'weight': 0.5}, {'code': 'X1', 'weight': 9}]},
        {'learnerId': 7, 'actualOtjh': None, 'reflection': {'text': 'Learned a lot'}, 'ksbSnapshot': [{'code': 'K1'}]},
        {'learnerId': 8, 'reflection': 'not an object', 'ksbSnapshot': [{'code': 'S2'}]},
    ],
}


class LearnerKsbAchievementTests(SimpleTestCase):
    def test_achieved_weight_comes_from_progress_rows_and_reflections_only_annotate(self):
        lines, labels = learner_ksb_achievements(PAYLOAD)
        self.assertEqual(sorted(lines), ['7', '8'])
        [k1] = lines['7']
        self.assertEqual((k1['code'], k1['count'], k1['weight']), ('K1', 3, 3.0))
        self.assertEqual((k1['plannedOtjh'], k1['plannedOtjhSource']), (1.5, 'component'))
        self.assertEqual((k1['actualOtjh'], k1['actualOtjhSource']), (2.0, 'reflection'))
        self.assertEqual(k1['declaredWeight'], 0.5)          # beside weight, never in it
        self.assertEqual(k1['reflections'], ['Learned a lot'])
        self.assertEqual([labels[i] for i in k1['activities']], ['Reading - Module A - Week 1', 'Quiz - Module A - Week 1'])

    def test_a_reflection_never_creates_a_line_and_out_of_scope_rows_are_ignored(self):
        lines, _ = learner_ksb_achievements(PAYLOAD)
        codes = {line['code'] for rows in lines.values() for line in rows}
        self.assertEqual(codes, {'K1', 'S2'})               # not B5, X1 (reflection only) nor B1 (out of scope)
        [s2] = lines['8']
        self.assertEqual((s2['actualOtjh'], s2['actualOtjhSource'], s2['reflections']), (None, 'not_returned', []))

    def test_labels_are_sent_once_across_learners(self):
        _, labels = learner_ksb_achievements(PAYLOAD)
        self.assertEqual(labels.count('Reading - Module A - Week 1'), 1)

    def test_summary_keeps_what_the_dialog_reads_and_drops_the_raw_rows(self):
        summary = learner_impact_summary(PAYLOAD)
        for key in ('consumptionSources', 'learnerActivities', 'coverage', 'programmeCoverage'):
            self.assertNotIn(key, summary)
        for key in ('assignedLearners', 'learnerKsbConsumption', 'otjhAchievement', 'ksbAchievement', 'scope'):
            self.assertEqual(summary[key], PAYLOAD[key])
        self.assertEqual(summary['view'], 'summary')
        json.dumps(summary, allow_nan=False)

    def test_an_unreadable_declared_weight_is_null_not_nan(self):
        payload = {'consumptionSources': {'progress': [progress(7, 'K1')]},
                   'learnerActivities': [{'learnerId': 7, 'declaredReflectionKsbs': [{'code': 'K1', 'weight': 'x'}]}]}
        self.assertTrue(math.isnan(learner_ksb_achievements(payload)[0]['7'][0]['declaredWeight']))
        self.assertIsNone(learner_impact_summary(payload)['learnerKsbAchievements']['7'][0]['declaredWeight'])


class ProgrammeImpactViewTests(SimpleTestCase):
    def _get(self, **params):
        request = RequestFactory().get('/x', params)
        with mock.patch.object(views, 'scope_learner_ksb_impact_payload', return_value=(dict(PAYLOAD), None)):
            return json.loads(views.curriculum_programme_learner_ksb_impact(request, 'PROG-1').content)

    def test_plain_request_is_unchanged(self):
        self.assertEqual(self._get(learnerStatus='all'), json.loads(json.dumps(PAYLOAD)))

    def test_summary_view_is_opt_in(self):
        body = self._get(learnerStatus='all', view='summary')
        self.assertNotIn('consumptionSources', body)
        self.assertEqual(sorted(body['learnerKsbAchievements']), ['7', '8'])

    def test_errors_pass_through(self):
        error = views.json_error('Programme not found.', status=404)
        with mock.patch.object(views, 'scope_learner_ksb_impact_payload', return_value=(None, error)):
            response = views.curriculum_programme_learner_ksb_impact(RequestFactory().get('/x', {'view': 'summary'}), 'P')
        self.assertEqual(response.status_code, 404)
