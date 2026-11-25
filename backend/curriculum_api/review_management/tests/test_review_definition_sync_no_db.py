"""No-database coverage for editable Review definition synchronisation."""
from unittest.mock import patch
from curriculum_api.review_management.tests.instance_test_support import instance_fixture

from django.test import SimpleTestCase

import curriculum_api.review_management.application.instance_answers as review_application_instance_answers
import curriculum_api.review_management.application.instance_definitions as review_application_instance_definitions
import curriculum_api.review_management.domain.instance_definitions as review_domain_instance_definitions
import curriculum_api.review_management.domain.instance_rules as review_domain_instance_rules


def field(field_id, title, *, field_type='text', required=False, configuration=None):
    return {
        'id': field_id,
        'title': title,
        'fieldType': field_type,
        'required': required,
        'displayOrder': 0,
        'configuration': configuration or {},
    }


def section(section_id, title, fields):
    return {
        'id': section_id,
        'title': title,
        'estimatedMinutes': 5,
        'displayOrder': 0,
        'enabled': True,
        'fields': fields,
    }


class EditableReviewDefinitionSyncTests(SimpleTestCase):
    def instance(self, status=review_domain_instance_rules.STATUS_IN_PROGRESS, snapshot=None):
        return {
            'id': 'REVI-1',
            'review_template_id': 'REV-1',
            'status': status,
            'definition_snapshot': snapshot or {},
        }

    def test_unanswered_editable_review_uses_the_current_section_tree(self):
        stored = {
            'fieldCount': 1,
            'signatures': {'advisor': True},
            'sections': [section('S1', 'Old', [field('F1', 'Old question')])],
        }
        live = {
            'fieldCount': 2,
            'signatures': {'advisor': False},
            'sections': [
                section('S1', 'Current', [field('F1', 'Current question')]),
                section('SUMMARY', 'Meeting Summary', [
                    field('SUMMARY-FIELD', 'Summary', configuration={'semanticKey': 'meeting_summary'}),
                ]),
            ],
        }

        for status in review_domain_instance_rules.EDITABLE_DEFINITION_STATUSES:
            result = review_application_instance_definitions.effective_review_definition_snapshot(
                self.instance(status=status, snapshot=stored),
                snapshot=stored,
                live_snapshot=live,
                answers_by_field={},
                signatures_by_role={},
            )
            self.assertEqual(result['sections'], live['sections'])
            self.assertEqual(result['fieldCount'], 2)
            self.assertEqual(result['signatures'], {'advisor': True})
        self.assertEqual(stored['sections'][0]['title'], 'Old')

    def test_answer_safe_merge_adds_new_fields_and_keeps_answered_contracts(self):
        answered = field(
            'F1', 'Old wording', field_type='text', required=True,
            configuration={'placeholder': 'Old placeholder'},
        )
        removed_unanswered = field('F2', 'Remove me')
        stored = {'sections': [section('S1', 'Old section', [answered, removed_unanswered])]}
        live = {'sections': [
            section('S1', 'Updated section', [
                field('F1', 'Updated wording', field_type='select', configuration={'options': ['A', 'B']}),
            ]),
            section('SUMMARY', 'Meeting Summary', [
                field('SUMMARY-FIELD', 'Summary', configuration={'semanticKey': 'meeting_summary'}),
            ]),
        ]}

        result = review_application_instance_definitions.effective_review_definition_snapshot(
            self.instance(snapshot=stored),
            snapshot=stored,
            live_snapshot=live,
            answers_by_field={'F1': {'answer': 'Existing answer'}},
            signatures_by_role={},
        )

        fields = review_domain_instance_definitions._field_index(result['sections'])
        self.assertEqual(result['sections'][0]['title'], 'Updated section')
        self.assertEqual(fields['F1']['title'], 'Updated wording')
        self.assertEqual(fields['F1']['fieldType'], 'text')
        self.assertEqual(fields['F1']['configuration'], {'placeholder': 'Old placeholder'})
        self.assertNotIn('F2', fields)
        self.assertEqual(fields['SUMMARY-FIELD']['configuration']['semanticKey'], 'meeting_summary')

    def test_terminal_or_signed_review_keeps_its_frozen_snapshot(self):
        stored = {'sections': [section('S1', 'Frozen', [field('F1', 'Frozen question')])]}
        live = {'sections': [section('S2', 'Replacement', [field('F2', 'Replacement question')])]}

        for status in (
            review_domain_instance_rules.STATUS_AWAITING_SIGNATURE,
            review_domain_instance_rules.STATUS_COMPLETED,
        ):
            result = review_application_instance_definitions.effective_review_definition_snapshot(
                self.instance(status=status, snapshot=stored),
                snapshot=stored,
                live_snapshot=live,
                answers_by_field={},
                signatures_by_role={},
            )
            self.assertEqual(result, stored)

        signed = review_application_instance_definitions.effective_review_definition_snapshot(
            self.instance(snapshot=stored),
            snapshot=stored,
            live_snapshot=live,
            answers_by_field={},
            signatures_by_role={'advisor': {'signed_at': '2026-09-21T10:00:00'}},
        )
        self.assertEqual(signed, stored)

    def test_answered_field_moved_to_a_new_section_is_not_duplicated_or_retyped(self):
        stored = {'sections': [
            section('OLD', 'Old section', [field('F1', 'Old question', field_type='text')]),
        ]}
        live = {'sections': [
            section('NEW', 'New section', [field('F1', 'Moved question', field_type='select')]),
        ]}

        result = review_application_instance_definitions.effective_review_definition_snapshot(
            self.instance(snapshot=stored),
            snapshot=stored,
            live_snapshot=live,
            answers_by_field={'F1': {'answer': 'Existing answer'}},
            signatures_by_role={},
        )

        self.assertEqual([item['id'] for item in result['sections']], ['NEW'])
        fields = review_domain_instance_definitions._flatten_snapshot_fields(result['sections'])
        self.assertEqual([item['id'] for item in fields], ['F1'])
        self.assertEqual(fields[0]['title'], 'Moved question')
        self.assertEqual(fields[0]['fieldType'], 'text')

    def test_passive_form_read_exposes_live_sections_without_writing(self):
        stored = {
            'name': 'Monthly Coaching Meeting',
            'reviewTypeCode': 'mcm',
            'signatures': {},
            'sections': [section('S1', 'Old', [field('F1', 'Old question')])],
        }
        live = {
            **stored,
            'sections': [
                section('S1', 'Current', [field('F1', 'Current question')]),
                section('SUMMARY', 'Meeting Summary', [
                    field('SUMMARY-FIELD', 'Summary', configuration={'semanticKey': 'meeting_summary'}),
                ]),
            ],
        }
        instance = {
            **self.instance(snapshot=stored),
            'learner_id': 12,
            'programme_id': 'PROG-1',
            'occurrence_number': 2,
            'target_date': None,
            'started_at': None,
            'completed_at': None,
        }
        template_row = {'id': 'REV-1', 'name': 'Monthly Coaching Meeting', 'review_type_id': 'TYPE-MCM'}

        with instance_fixture('get_review_template_row', return_value=template_row,
        ), instance_fixture('build_definition_snapshot', return_value=live,
        ), instance_fixture('get_review_instance_answers', return_value={},
        ), instance_fixture('get_review_instance_signatures', return_value={},
        ), instance_fixture('review_type_index', return_value={},
        ), instance_fixture('latest_review_instance_manual_override', return_value=None,
        ), instance_fixture('review_instance_progress_snapshot', return_value=None,
        ), patch(
            'curriculum_api.review_management.domain.pdf_policy.pdf_availability', return_value={'available': False},
        ), instance_fixture('update_rows',
        ) as update_rows:
            definition = review_application_instance_definitions.review_instance_form_definition(instance)

        self.assertEqual([item['id'] for item in definition['sections']], ['S1', 'SUMMARY'])
        self.assertEqual(
            review_domain_instance_definitions.meeting_summary_field(definition)['id'],
            'SUMMARY-FIELD',
        )
        update_rows.assert_not_called()

    def test_save_accepts_a_new_live_field_after_refreshing_the_locked_snapshot(self):
        refreshed = self.instance(snapshot={
            'sections': [section('SUMMARY', 'Meeting Summary', [
                field('SUMMARY-FIELD', 'Summary', configuration={'semanticKey': 'meeting_summary'}),
            ])],
        })
        with instance_fixture('_refresh_locked_editable_definition_snapshot',
            return_value=refreshed,
        ) as refresh, instance_fixture('fetch_all', return_value=[],
        ), instance_fixture('json_db_value', side_effect=lambda value: value,
        ), instance_fixture('unique_prefixed_id', return_value='REVIA-1',
        ), instance_fixture('insert_row', return_value={},
        ) as insert:
            review_application_instance_answers._save_review_instance_answers_locked(
                self.instance(snapshot={'sections': []}),
                {'SUMMARY-FIELD': 'Generated summary'},
                actor='coach@example.test',
            )

        refresh.assert_called_once()
        payload = insert.call_args.args[1]
        self.assertEqual(payload['field_id'], 'SUMMARY-FIELD')
        self.assertEqual(payload['answer'], 'Generated summary')

    def test_locked_save_persists_the_effective_snapshot_before_answers(self):
        stored = {'sections': [section('S1', 'Old', [field('F1', 'Old question')])]}
        effective = {
            'fieldCount': 2,
            'sections': [
                section('S1', 'Current', [field('F1', 'Current question')]),
                section('SUMMARY', 'Meeting Summary', [field('SUMMARY-FIELD', 'Summary')]),
            ],
        }
        instance = self.instance(snapshot=stored)
        with instance_fixture('effective_review_definition_snapshot', return_value=effective,
        ), instance_fixture('json_db_value', side_effect=lambda value: value,
        ), instance_fixture('update_rows', return_value=[instance],
        ) as update_rows:
            refreshed = review_application_instance_answers._refresh_locked_editable_definition_snapshot(
                instance,
                actor='coach@example.test',
            )

        self.assertEqual(refreshed['definition_snapshot'], effective)
        update_rows.assert_called_once()
        self.assertEqual(update_rows.call_args.args[3]['definition_snapshot'], effective)
