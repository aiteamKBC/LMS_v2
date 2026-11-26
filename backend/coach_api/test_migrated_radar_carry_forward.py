"""Synthetic imported sources and real private-database review snapshots."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from . import migrated_previous, migrated_radar_carry_forward as carry, views
from .migrated_skills_radar import build_section, rating_status
from .migrated_summary_binding import answer_version
from .migrated_template_sync import synchronize_locked, synchronize_on_open
from .models import ImportedReviewInstance, MigratedReviewTemplate
from .test_migrated_skills_radar import frozen_snapshot, source_fields, PREFIX, template
from .test_migrated_previous import source


class RadarContinuationTests(TestCase):
    def setUp(self):
        self.owner = 'coach@example.test'
        self.master = MigratedReviewTemplate.objects.create(scope='GLOBAL', programme_key='',
            review_family=carry.FAMILY, name='PR + Skills Radar', is_active=True,
            definition_json=template().definition_json)
        self.rows = [self.row(1, '2026-09-01'), self.row(2, '2026-10-01'), self.row(3, '2026-11-01')]
        self.previous = self.overlay(2, {PREFIX+'learner': '2', PREFIX+'coach': '4', PREFIX+'goal': '5'})
        self.current = self.overlay(3, {'unrelated': 'Keep this'})
        self.profiles = [SimpleNamespace(id=42, programme_id='p1', programme='Sample programme', aptem_id=902)]
        self.mock(views, 'fetch_caseload_dashboard_profiles', return_value=self.profiles)
        self.mock(views, 'resolve_effective_aptem_ids', return_value=({42: 902}, set()))
        self.mock(migrated_previous, '_sources', side_effect=lambda *args: self.rows)
        self.reader = self.mock(views, '_imported_review_definition', side_effect=self.definition)

    def mock(self, obj, name, **kwargs):
        p = patch.object(obj, name, **kwargs); result = p.start(); self.addCleanup(p.stop)
        return result

    def row(self, pk, planned, **kwargs):
        return source(pk, planned, family='Progress Review (+ Skills Radar)', **kwargs)

    def overlay(self, pk, answers=None, **kwargs):
        return ImportedReviewInstance.objects.create(event_key=f'imported-review:source-{pk}',
            learner_id=42, source_review_id=pk, owner_email=self.owner,
            template_snapshot=frozen_snapshot(), migrated_template=self.master,
            status=kwargs.pop('status', 'in-progress'), answers=answers or {}, **kwargs)

    def definition(self, owner=None, key=None, **kwargs):
        pk = int((key or self.current.event_key).rsplit('-', 1)[1])
        return {'migratedForm': True, 'localStatus': 'in-progress', 'migratedProgrammeKey': '',
                'instance': {'learnerId': 42, 'id': f'imported-review:source-{pk}'},
                'historicalReview': {'id': str(pk), 'type': 'Progress Review (+ Skills Radar)'},
                'programme': 'Sample programme', 'programmeId': 'p1'}

    def run_copy(self):
        changed = carry.carry_forward_locked(self.current, self.definition())
        self.current.refresh_from_db()
        return changed

    def state(self):
        return self.current.template_snapshot['sections'][0]['radarContinuation']

    def test_all_saved_scores_and_goals_copy_from_unfinished_previous(self):
        before = ImportedReviewInstance.objects.values().get(pk=self.previous.pk)
        version = answer_version(self.current)
        self.assertTrue(self.run_copy())
        self.assertEqual(self.current.answers, {'unrelated': 'Keep this', **self.previous.answers})
        self.assertEqual(self.state()['status'], 'copied')
        self.assertEqual(self.state()['plannedDate'], '2026-10-01')
        self.assertNotEqual(answer_version(self.current), version)
        self.assertEqual(before, ImportedReviewInstance.objects.values().get(pk=self.previous.pk))
        self.assertEqual(rating_status(self.current.answers[PREFIX+'coach'], self.current.answers[PREFIX+'goal']), 'Working Toward')

    def test_achieved_and_working_toward_items_are_both_carried(self):
        fields = source_fields(); payload = json.loads(fields[0]['value'])
        second = deepcopy(payload['characteristics'][0]); second['id'] = 35; second['name'] = 'B2: Another item'
        payload['characteristics'].append(second); fields[0]['value'] = json.dumps(payload)
        for overlay in (self.previous, self.current):
            overlay.template_snapshot['sections'] = [build_section(fields, None)]
            overlay.save(update_fields=['template_snapshot'])
        self.previous.answers.update({'lms-skills-radar:12:35:coach': '5', 'lms-skills-radar:12:35:goal': '4'})
        self.previous.save(update_fields=['answers'])
        self.run_copy()
        self.assertEqual(self.current.answers[PREFIX+'coach'], '4')
        self.assertEqual(self.current.answers['lms-skills-radar:12:35:coach'], '5')

    def test_second_and_third_reviews_continue_the_immediately_previous_answers(self):
        self.run_copy()
        self.current.answers[PREFIX+'coach'] = '5'; self.current.save(update_fields=['answers'])
        self.rows.append(self.row(4, '2026-12-01'))
        self.current = self.overlay(4)
        self.run_copy()
        self.assertEqual(self.current.answers[PREFIX+'coach'], '5')
        self.assertEqual(self.state()['sourceReview'], 'imported-review:source-3')

    def test_no_refresh_after_copy_even_when_previous_or_current_is_changed_or_cleared(self):
        self.run_copy()
        self.previous.answers[PREFIX+'coach'] = '5'; self.previous.save(update_fields=['answers'])
        self.current.answers.pop(PREFIX+'coach'); self.current.save(update_fields=['answers'])
        before = ImportedReviewInstance.objects.values().get(pk=self.current.pk)
        self.assertFalse(self.run_copy())
        self.assertEqual(before, ImportedReviewInstance.objects.values().get(pk=self.current.pk))

    def test_any_saved_or_cleared_or_audited_current_radar_preserves_current_section(self):
        for answers, audit in [({PREFIX+'coach': '3'}, {}), ({PREFIX+'coach': ''}, {}), ({}, {PREFIX+'coach': {}})]:
            self.current.template_snapshot = frozen_snapshot(); self.current.answers = answers
            self.current.meeting_intelligence = {'answerEdits': audit}
            self.current.save()
            with patch.object(carry, 'previous_radar', side_effect=AssertionError('Must preserve current work')):
                self.run_copy()
            self.assertEqual(self.current.answers, answers)
            self.assertEqual(self.state()['status'], 'preserved')

    def test_first_review_keeps_programme_questions_without_invented_answers(self):
        self.current.source_review_id = 1; self.current.event_key = 'imported-review:source-1'; self.current.save()
        self.run_copy()
        self.assertEqual(self.state()['status'], 'first')
        self.assertEqual(self.current.answers, {'unrelated': 'Keep this'})

    def test_waiting_signatures_and_completed_destinations_are_immutable(self):
        for status in ('awaiting-signature', 'completed'):
            self.current.status = status; self.current.save()
            before = ImportedReviewInstance.objects.values().get(pk=self.current.pk)
            self.assertFalse(self.run_copy())
            self.assertEqual(before, ImportedReviewInstance.objects.values().get(pk=self.current.pk))

    def test_all_previous_local_statuses_can_supply_saved_assessments(self):
        for status, _ in ImportedReviewInstance.STATUS_CHOICES:
            self.previous.status = status; self.previous.save()
            self.current.template_snapshot = frozen_snapshot(); self.current.answers = {}; self.current.save()
            self.run_copy()
            self.assertEqual(self.current.answers, self.previous.answers)

    def test_never_skips_empty_immediate_previous_to_older_completed(self):
        self.overlay(1, {PREFIX+'coach': '5'}, status='completed')
        self.previous.answers = {}; self.previous.save()
        self.run_copy()
        self.assertNotIn(PREFIX+'coach', self.current.answers)
        self.assertEqual(self.state()['status'], 'unavailable')

    def test_no_bare_ksb_code_or_changed_scale_or_question_mapping(self):
        for attribute, value in [('standardId', 'other'), ('levels', [{'value': '5', 'label': 'Changed meaning'}]),
                                 ('question', 'Different competency')]:
            self.current.template_snapshot = frozen_snapshot()
            for field in self.current.template_snapshot['sections'][0]['fields']:
                field['skillsRadar'][attribute] = value
            self.current.save()
            self.run_copy()
            self.assertNotIn(PREFIX+'coach', self.current.answers)

    def test_future_review_is_never_selected(self):
        self.rows.append(self.row(4, '2026-12-01')); self.overlay(4, {PREFIX+'coach': '5'})
        self.run_copy(); self.assertEqual(self.current.answers[PREFIX+'coach'], '4')

    def test_partial_matches_explain_why_some_previous_values_remain_blank(self):
        self.current.template_snapshot['sections'][0]['fields'][0]['skillsRadar']['levels'] = []
        self.current.save()
        self.run_copy()
        self.assertNotIn(PREFIX+'learner', self.current.answers)
        self.assertEqual(self.current.answers[PREFIX+'coach'], '4')
        self.assertIn('Some previous assessments could not be copied', self.state()['message'])

    def test_ambiguous_missing_dates_and_conflicting_source_identity_copy_nothing(self):
        for mutate in (lambda: self.rows.append(self.row(4, '2026-10-01')),
                       lambda: self.rows.append(self.row(4, None)),
                       lambda: self.rows[1][0].update(learner_id=99),
                       lambda: self.rows[1][0]['review_data'].update(aptem_learner_id=999)):
            original = deepcopy(self.rows); mutate()
            self.current.template_snapshot = frozen_snapshot(); self.current.save()
            self.run_copy()
            self.assertEqual(self.state()['status'], 'unavailable')
            self.assertNotIn(PREFIX+'coach', self.current.answers)
            self.rows = original

    def test_wrong_learner_coach_family_and_programme_never_copy(self):
        for attribute, value in [('learner_id', 99), ('owner_email', 'other@example.test'),
                                 ('template_snapshot', {'templateSource': {'family': 'PR'}}),
                                 ('template_snapshot', {'templateSource': {'family': carry.FAMILY, 'programmeKey': 'id:other'}})]:
            original = deepcopy(getattr(self.previous, attribute)); setattr(self.previous, attribute, value); self.previous.save()
            self.current.template_snapshot = frozen_snapshot(); self.current.save()
            self.run_copy()
            self.assertEqual(self.state()['status'], 'unavailable')
            self.assertNotIn(PREFIX+'coach', self.current.answers)
            setattr(self.previous, attribute, original); self.previous.save()

    def test_caseload_and_previous_definition_access_are_rechecked(self):
        with patch.object(views, 'resolve_effective_aptem_ids', return_value=({}, {42})):
            self.run_copy(); self.assertEqual(self.state()['status'], 'unavailable')
        self.reader.side_effect = None; self.reader.return_value = None
        self.run_copy(); self.assertNotIn(PREFIX+'coach', self.current.answers)

    def test_template_refresh_keeps_continuation_marker_and_provenance(self):
        self.run_copy(); before = deepcopy(self.current.template_snapshot['sections'])
        self.master.name = 'Updated template'; self.master.save()
        synchronize_locked(self.current, carry.FAMILY, '')
        self.current.refresh_from_db()
        self.assertEqual(self.current.template_snapshot['sections'], before)
        self.assertFalse(self.run_copy())

    def test_assigned_coach_open_invokes_continuation_and_returns_updated_definition(self):
        self.mock(views, '_owned_migrated_overlay', return_value=self.current)
        synchronize_on_open(self.owner, self.current.event_key, self.definition())
        self.current.refresh_from_db()
        self.assertEqual(self.current.answers[PREFIX+'coach'], '4')

    def test_ordinary_pr_is_untouched_and_does_not_query_previous(self):
        self.current.template_snapshot['templateSource']['family'] = 'PR'; self.current.save()
        with patch.object(carry, 'previous_radar', side_effect=AssertionError('Unrelated family')):
            self.assertFalse(self.run_copy())

    def test_initialization_seeds_only_the_new_overlay_and_retry_keeps_edits(self):
        from . import migrated_initialization
        from learner_api.models import LearnerProfile
        self.current.delete()
        definition = self.definition(key='imported-review:source-3')
        definition.update(canInitialize=True, readOnly=True, sourceStatus='scheduled')
        with patch.object(views, 'lock_learner_calendar'), \
             patch.object(LearnerProfile.objects, 'filter') as profile, \
             patch.object(migrated_initialization, '_review_snapshot', return_value=frozen_snapshot()), \
             patch.object(migrated_initialization, '_status_for_existing_booking', return_value='in-progress'):
            profile.return_value.values_list.return_value.first.return_value = self.owner
            self.current, created = migrated_initialization.initialize_imported_review(self.owner, definition)
            self.assertTrue(created)
            self.assertEqual(self.current.answers, self.previous.answers)
            self.current.answers[PREFIX+'coach'] = '3'; self.current.save()
            retried, created = migrated_initialization.initialize_imported_review(self.owner, definition)
            self.assertFalse(created)
            self.assertEqual(retried.answers[PREFIX+'coach'], '3')

    def test_programme_fallback_uses_the_same_carry_forward(self):
        from .migrated_skills_radar import build_programme_section
        programme = SimpleNamespace(source_value='standard:st0001-v1-0', label='Example standard',
                                    items=[{'code': 'K1', 'description': 'Example knowledge'}])
        for overlay in (self.previous, self.current):
            overlay.template_snapshot['sections'] = [build_programme_section(programme)]
            overlay.save()
        key = self.previous.template_snapshot['sections'][0]['fields'][1]['key']
        self.previous.answers = {key: '4'}; self.previous.save()
        self.run_copy()
        self.assertEqual(self.current.answers[key], '4')

    def test_imported_reference_without_a_local_saved_review_is_not_invented_as_answers(self):
        self.previous.delete()
        self.run_copy()
        self.assertEqual(self.state()['status'], 'unavailable')
        self.assertNotIn(PREFIX+'coach', self.current.answers)

    def test_same_learner_different_captured_programme_is_excluded(self):
        self.rows[1] = self.row(2, '2026-10-01', programme='Other programme')
        self.rows = self.rows[1:]
        self.run_copy()
        self.assertEqual(self.state()['status'], 'first')
        self.assertNotIn(PREFIX+'coach', self.current.answers)
