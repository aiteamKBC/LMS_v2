"""Programme Review Templates ("Reviews ID" tab)."""
import json

from django.db import connection
from django.test import TestCase

from . import reviews, views


class ReviewTemplateTestCase(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        self.client_ = None
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        self._clear()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table = 'curriculum.programmes'
            else:
                table = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    status varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (reviews.REVIEW_FIELDS_TABLE, reviews.REVIEW_SECTIONS_TABLE, reviews.REVIEW_TEMPLATES_TABLE, 'programmes'):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')

    def _programme(self, programme_id='PROG-DATA', name='Data Technician'):
        views.insert_row('programmes', {
            'id': programme_id,
            'programme_id': programme_id,
            'program_id': programme_id,
            'name': name,
            'status': 'active',
            'is_active': True,
            'is_archived': False,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _basic_payload(self, **overrides):
        payload = {
            'name': 'Progress Review',
            'enabled': True,
            'recurrence': {'interval': 12, 'unit': 'weeks'},
            'applicableStatuses': ['Active'],
            'signatures': {'advisor': True, 'employer': False, 'participant': True, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': False},
            'recordTimeSpent': True,
            'allowEditingPriorDays': 7,
            'notifications': {'employer': False, 'participant': True},
            'incompleteMarker': 'Overdue',
            'fields': [
                {'title': 'Progress notes', 'fieldType': 'text_multiline', 'required': True},
                {'title': 'Hours spent', 'fieldType': 'numeric', 'required': False},
            ],
        }
        payload.update(overrides)
        return payload

    # ------------------------------------------------------------- helpers

    def _post(self, programme_id, payload):
        return self.client.post(
            f'/curriculum_api/curriculum/programmes/{programme_id}/reviews/',
            data=json.dumps(payload), content_type='application/json',
        )

    def _get_list(self, programme_id):
        return self.client.get(f'/curriculum_api/curriculum/programmes/{programme_id}/reviews/')

    def _get_detail(self, review_id):
        return self.client.get(f'/curriculum_api/curriculum/reviews/{review_id}/')

    def _patch(self, review_id, payload):
        return self.client.patch(
            f'/curriculum_api/curriculum/reviews/{review_id}/',
            data=json.dumps(payload), content_type='application/json',
        )

    def _delete(self, review_id):
        return self.client.delete(f'/curriculum_api/curriculum/reviews/{review_id}/')

    def _clone(self, dest_programme_id, source_programme_id, review_ids):
        return self.client.post(
            f'/curriculum_api/curriculum/programmes/{dest_programme_id}/reviews/clone/',
            data=json.dumps({'sourceProgrammeId': source_programme_id, 'reviewIds': review_ids}),
            content_type='application/json',
        )


class ReviewCreateTests(ReviewTemplateTestCase):
    def test_create_review_generates_id_with_rev_prefix_and_curriculum_format(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload())
        self.assertEqual(response.status_code, 200, response.content)
        review_id = response.json()['review']['id']
        self.assertTrue(review_id.startswith('REV-'))
        # Same shape as every other curriculum id: PREFIX-<digits>.
        suffix = review_id.split('-', 1)[1]
        self.assertTrue(suffix.isdigit())
        self.assertGreaterEqual(len(suffix), 14)

    def test_review_ids_are_unique_across_creates(self):
        programme_id = self._programme()
        first = self._post(programme_id, self._basic_payload(name='Review A')).json()['review']['id']
        second = self._post(programme_id, self._basic_payload(name='Review B')).json()['review']['id']
        self.assertNotEqual(first, second)

    def test_create_with_days_recurrence(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(recurrence={'interval': 80, 'unit': 'days'}))
        review = response.json()['review']
        self.assertEqual(review['recurrence'], {'interval': 80, 'unit': 'days'})

    def test_create_with_weeks_recurrence(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(recurrence={'interval': 12, 'unit': 'weeks'}))
        self.assertEqual(response.json()['review']['recurrence'], {'interval': 12, 'unit': 'weeks'})

    def test_create_with_months_recurrence_is_not_converted_to_days(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(recurrence={'interval': 1, 'unit': 'months'}))
        self.assertEqual(response.json()['review']['recurrence'], {'interval': 1, 'unit': 'months'})

    def test_reject_recurrence_interval_zero(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(recurrence={'interval': 0, 'unit': 'weeks'}))
        self.assertEqual(response.status_code, 400)
        self.assertIn('recurrenceInterval', response.json()['fields'])

    def test_reject_negative_recurrence(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(recurrence={'interval': -3, 'unit': 'weeks'}))
        self.assertEqual(response.status_code, 400)
        self.assertIn('recurrenceInterval', response.json()['fields'])

    def test_reject_invalid_recurrence_unit(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(recurrence={'interval': 1, 'unit': 'fortnights'}))
        self.assertEqual(response.status_code, 400)
        self.assertIn('recurrenceUnit', response.json()['fields'])

    def test_invalid_field_title_rejected(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(fields=[
            {'title': '', 'fieldType': 'text', 'required': True},
        ]))
        self.assertEqual(response.status_code, 400)
        self.assertIn('fields[0].title', response.json()['fields'])

    def test_invalid_field_type_rejected(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(fields=[
            {'title': 'Something', 'fieldType': 'not-a-real-type', 'required': True},
        ]))
        self.assertEqual(response.status_code, 400)
        self.assertIn('fields[0].fieldType', response.json()['fields'])

    def test_list_item_requires_options(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(fields=[
            {'title': 'Pick one', 'fieldType': 'list_item', 'required': True, 'configuration': {}},
        ]))
        self.assertEqual(response.status_code, 400)
        self.assertIn('fields[0].configuration.options', response.json()['fields'])

    def test_unknown_programme_status_rejected(self):
        programme_id = self._programme()
        response = self._post(programme_id, self._basic_payload(applicableStatuses=['Made up status']))
        self.assertEqual(response.status_code, 400)
        self.assertIn('applicableStatuses', response.json()['fields'])

    def test_create_against_missing_programme_is_404(self):
        response = self._post('PROG-NOPE', self._basic_payload())
        self.assertEqual(response.status_code, 404)

    def test_signatures_and_visibility_saved(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._basic_payload()).json()['review']
        self.assertEqual(review['signatures'], {'advisor': True, 'employer': False, 'participant': True, 'referrer': False})
        self.assertEqual(review['visibleTo'], {'advisor': True, 'employer': True, 'participant': True, 'referrer': False})


class ReviewReadTests(ReviewTemplateTestCase):
    def test_retrieve_programme_reviews(self):
        programme_id = self._programme()
        self._post(programme_id, self._basic_payload(name='Review A'))
        self._post(programme_id, self._basic_payload(name='Review B'))
        response = self._get_list(programme_id)
        self.assertEqual(response.status_code, 200)
        names = {row['name'] for row in response.json()['results']}
        self.assertEqual(names, {'Review A', 'Review B'})

    def test_retrieve_review_detail_includes_fields(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._basic_payload()).json()['review']['id']
        response = self._get_detail(review_id)
        self.assertEqual(response.status_code, 200)
        detail = response.json()['review']
        self.assertEqual(len(detail['fields']), 2)
        self.assertEqual(detail['fields'][0]['displayOrder'], 0)

    def test_programme_isolation(self):
        programme_a = self._programme('PROG-A', 'Programme A')
        programme_b = self._programme('PROG-B', 'Programme B')
        self._post(programme_a, self._basic_payload(name='Only in A'))
        response = self._get_list(programme_b)
        self.assertEqual(response.json()['results'], [])

    def test_unauthorized_field_title_error_shape(self):
        response = self._get_detail('REV-DOES-NOT-EXIST')
        self.assertEqual(response.status_code, 404)


class ReviewUpdateDeleteTests(ReviewTemplateTestCase):
    def test_edit_review_updates_fields(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._basic_payload()).json()['review']['id']
        response = self._patch(review_id, {'name': 'Renamed Review', 'enabled': False})
        self.assertEqual(response.status_code, 200)
        review = response.json()['review']
        self.assertEqual(review['name'], 'Renamed Review')
        self.assertFalse(review['enabled'])

    def test_edit_review_fields_and_reorder(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._basic_payload()).json()['review']['id']
        response = self._patch(review_id, {'fields': [
            {'title': 'Hours spent', 'fieldType': 'numeric', 'required': False},
            {'title': 'Progress notes', 'fieldType': 'text_multiline', 'required': True},
            {'title': 'New question', 'fieldType': 'boolean', 'required': False},
        ]})
        self.assertEqual(response.status_code, 200)
        fields = response.json()['review']['fields']
        self.assertEqual([f['title'] for f in fields], ['Hours spent', 'Progress notes', 'New question'])
        self.assertEqual([f['displayOrder'] for f in fields], [0, 1, 2])

    def test_partial_update_leaves_other_fields_untouched(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._basic_payload()).json()['review']['id']
        self._patch(review_id, {'name': 'New Name'})
        review = self._get_detail(review_id).json()['review']
        self.assertEqual(review['name'], 'New Name')
        self.assertEqual(review['recurrence'], {'interval': 12, 'unit': 'weeks'})
        self.assertEqual(len(review['fields']), 2)

    def test_delete_archives_not_hard_deletes(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._basic_payload()).json()['review']['id']
        response = self._delete(review_id)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['deleted'])
        self.assertFalse(body['permanent'])
        # Archived: gone from the live list...
        self.assertEqual(self._get_list(programme_id).json()['results'], [])
        # ...but the row itself, and its fields, are still in the database.
        row = reviews.get_review_template_row(review_id, include_deleted=True)
        self.assertIsNotNone(row)
        self.assertIsNotNone(row['deleted_at'])
        self.assertEqual(len(reviews.get_review_field_rows(review_id)), 2)

    def test_delete_missing_review_is_404(self):
        response = self._delete('REV-DOES-NOT-EXIST')
        self.assertEqual(response.status_code, 404)


class ReviewCloneTests(ReviewTemplateTestCase):
    def test_clone_one_review_gets_new_id(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        source_review = self._post(source, self._basic_payload()).json()['review']['id']

        response = self._clone(dest, source, [source_review])
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(len(body['reviewIds']), 1)
        self.assertNotEqual(body['reviewIds'][0], source_review)
        self.assertTrue(body['reviewIds'][0].startswith('REV-'))

    def test_clone_multiple_reviews(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        review_a = self._post(source, self._basic_payload(name='A')).json()['review']['id']
        review_b = self._post(source, self._basic_payload(name='B')).json()['review']['id']

        response = self._clone(dest, source, [review_a, review_b])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['reviewIds']), 2)
        self.assertEqual(len(self._get_list(dest).json()['results']), 2)

    def test_clone_deep_copies_fields_list_options_and_recurrence(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        source_review = self._post(source, self._basic_payload(
            recurrence={'interval': 3, 'unit': 'months'},
            fields=[{
                'title': 'Choose one', 'fieldType': 'list_item', 'required': True,
                'configuration': {'options': ['Red', 'Green', 'Blue']},
            }],
        )).json()['review']['id']

        cloned_id = self._clone(dest, source, [source_review]).json()['reviewIds'][0]
        cloned = self._get_detail(cloned_id).json()['review']
        self.assertEqual(cloned['recurrence'], {'interval': 3, 'unit': 'months'})
        self.assertEqual(cloned['fields'][0]['configuration']['options'], ['Red', 'Green', 'Blue'])

    def test_clone_status_rules_and_signatures_copied(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        source_review = self._post(source, self._basic_payload(
            applicableStatuses=['Active', 'On break'],
            signatures={'advisor': True, 'employer': True, 'participant': False, 'referrer': False},
        )).json()['review']['id']

        cloned_id = self._clone(dest, source, [source_review]).json()['reviewIds'][0]
        cloned = self._get_detail(cloned_id).json()['review']
        self.assertEqual(set(cloned['applicableStatuses']), {'Active', 'On break'})
        self.assertEqual(cloned['signatures'], {'advisor': True, 'employer': True, 'participant': False, 'referrer': False})

    def test_destination_has_independent_id_and_editing_clone_does_not_touch_source(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        source_review = self._post(source, self._basic_payload(name='Original')).json()['review']['id']

        cloned_id = self._clone(dest, source, [source_review]).json()['reviewIds'][0]
        self.assertNotEqual(cloned_id, source_review)

        self._patch(cloned_id, {'name': 'Edited clone'})
        source_after = self._get_detail(source_review).json()['review']
        self.assertEqual(source_after['name'], 'Original')

    def test_clone_invalid_source_programme_is_404(self):
        dest = self._programme('PROG-DEST', 'Dest Programme')
        response = self._clone(dest, 'PROG-NOPE', ['REV-1'])
        self.assertEqual(response.status_code, 404)

    def test_clone_with_no_selected_reviews_is_rejected(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        response = self._clone(dest, source, [])
        self.assertEqual(response.status_code, 400)
        self.assertIn('reviewIds', response.json()['fields'])

    def test_clone_deep_copies_sections_and_boolean_case_children_with_remapped_parents(self):
        source = self._programme('PROG-SRC', 'Source Programme')
        dest = self._programme('PROG-DEST', 'Dest Programme')
        source_review = self._post(source, self._sections_payload()).json()['review']['id']

        cloned_id = self._clone(dest, source, [source_review]).json()['reviewIds'][0]
        cloned = self._get_detail(cloned_id).json()['review']
        source_detail = self._get_detail(source_review).json()['review']

        self.assertEqual(len(cloned['sections']), len(source_detail['sections']))
        self.assertEqual([s['title'] for s in cloned['sections']], [s['title'] for s in source_detail['sections']])

        case_section = next(s for s in cloned['sections'] if s['title'] == 'Meeting & Close')
        case_field = next(f for f in case_section['fields'] if f['fieldType'] == 'boolean_case_block')
        self.assertEqual(len(case_field['yesFields']), 1)
        self.assertEqual(len(case_field['noFields']), 1)
        self.assertEqual(case_field['yesFields'][0]['fieldType'], 'date')
        self.assertEqual(case_field['noFields'][0]['fieldType'], 'text')

        # Every id in the clone is fresh -- none reused from the source.
        source_ids = {source_review}
        for s in source_detail['sections']:
            source_ids.add(s['id'])
            for f in s['fields']:
                source_ids.add(f['id'])
                source_ids.update(c['id'] for c in f.get('yesFields', []))
                source_ids.update(c['id'] for c in f.get('noFields', []))
        cloned_ids = {cloned_id}
        for s in cloned['sections']:
            cloned_ids.add(s['id'])
            for f in s['fields']:
                cloned_ids.add(f['id'])
                cloned_ids.update(c['id'] for c in f.get('yesFields', []))
                cloned_ids.update(c['id'] for c in f.get('noFields', []))
        self.assertEqual(source_ids & cloned_ids, set())

        # Parent ids on cloned children point at the *cloned* parent, not the source's.
        self.assertEqual(case_field['yesFields'][0]['parentFieldId'], case_field['id'])
        self.assertEqual(case_field['noFields'][0]['parentFieldId'], case_field['id'])

        # Editing the clone must never touch the source.
        self._patch(cloned_id, {'sections': [{'title': 'Changed', 'estimatedMinutes': 0, 'fields': []}]})
        source_after = self._get_detail(source_review).json()['review']
        self.assertEqual(len(source_after['sections']), len(source_detail['sections']))


class ReviewSectionTests(ReviewTemplateTestCase):
    """Section -> Field -> optional conditional-child structure."""

    def _sections_payload(self, **overrides):
        payload = self._basic_payload()
        payload.pop('fields', None)
        payload['sections'] = [
            {
                'title': 'Learner Feedback on Teaching & Curriculum',
                'estimatedMinutes': 5,
                'fields': [
                    {'title': 'Learner Feedback', 'fieldType': 'title_description', 'configuration': {'description': "I'd also like your feedback."}},
                    {'title': 'The curriculum is well planned', 'fieldType': 'list_item', 'required': True, 'configuration': {'options': ['Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree']}},
                ],
            },
            {
                'title': 'Meeting & Close',
                'estimatedMinutes': 5,
                'fields': [
                    {
                        'title': 'Please confirm that the next session has been booked',
                        'fieldType': 'boolean_case_block',
                        'required': True,
                        'yesFields': [{'title': 'The date for the next coaching session is', 'fieldType': 'date', 'required': True}],
                        'noFields': [{'title': 'Why?', 'fieldType': 'text', 'required': True}],
                    },
                ],
            },
        ]
        payload.update(overrides)
        return payload

    def test_review_section_id_uses_revs_prefix_and_curriculum_format(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        section_id = review['sections'][0]['id']
        self.assertTrue(section_id.startswith('REVS-'))
        self.assertTrue(section_id.split('-', 1)[1].isdigit())

    def test_multiple_sections_created_in_order(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        self.assertEqual([s['title'] for s in review['sections']], ['Learner Feedback on Teaching & Curriculum', 'Meeting & Close'])
        self.assertEqual([s['displayOrder'] for s in review['sections']], [0, 1])

    def test_estimated_minutes_saved(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        self.assertEqual(review['sections'][0]['estimatedMinutes'], 5)

    def test_negative_estimated_minutes_rejected(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][0]['estimatedMinutes'] = -1
        response = self._post(programme_id, payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn('sections[0].estimatedMinutes', response.json()['fields'])

    def test_section_title_required(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][0]['title'] = ''
        response = self._post(programme_id, payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn('sections[0].title', response.json()['fields'])

    def test_review_with_sections_and_fields_created(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        self.assertEqual(review['fieldCount'], 5)  # 2 + (1 case block + 2 children)

    def test_existing_flat_review_still_reads_and_writes(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._basic_payload()).json()['review']
        self.assertEqual(len(review['sections']), 1)
        self.assertEqual(review['sections'][0]['title'], 'General')
        self.assertEqual(len(review['fields']), 2)

    def test_list_item_options_round_trip(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        list_field = review['sections'][0]['fields'][1]
        self.assertEqual(list_field['configuration']['options'], ['Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree'])

    def test_title_description_configuration_saved_and_not_required_flag(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        block = review['sections'][0]['fields'][0]
        self.assertEqual(block['fieldType'], 'title_description')
        self.assertEqual(block['configuration']['description'], "I'd also like your feedback.")
        self.assertFalse(block['required'])

    def test_simple_boolean_has_no_conditional_children(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][0]['fields'] = [{'title': 'Attended?', 'fieldType': 'boolean', 'required': True}]
        review = self._post(programme_id, payload).json()['review']
        field = review['sections'][0]['fields'][0]
        self.assertNotIn('yesFields', field)
        self.assertNotIn('noFields', field)

    def test_boolean_case_block_yes_branch_only(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][1]['fields'][0]['noFields'] = []
        review = self._post(programme_id, payload).json()['review']
        case_field = review['sections'][1]['fields'][0]
        self.assertEqual(len(case_field['yesFields']), 1)
        self.assertEqual(len(case_field['noFields']), 0)

    def test_boolean_case_block_no_branch_only(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][1]['fields'][0]['yesFields'] = []
        review = self._post(programme_id, payload).json()['review']
        case_field = review['sections'][1]['fields'][0]
        self.assertEqual(len(case_field['yesFields']), 0)
        self.assertEqual(len(case_field['noFields']), 1)

    def test_boolean_case_block_both_branches(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        case_field = review['sections'][1]['fields'][0]
        self.assertEqual(len(case_field['yesFields']), 1)
        self.assertEqual(len(case_field['noFields']), 1)
        self.assertEqual(case_field['yesFields'][0]['fieldType'], 'date')
        self.assertEqual(case_field['noFields'][0]['fieldType'], 'text')

    def test_conditional_children_belong_to_parent_review_and_section(self):
        programme_id = self._programme()
        review = self._post(programme_id, self._sections_payload()).json()['review']
        section = review['sections'][1]
        case_field = section['fields'][0]
        child = case_field['yesFields'][0]
        self.assertEqual(child['reviewId'], review['id'])
        self.assertEqual(child['sectionId'], section['id'])
        self.assertEqual(child['parentFieldId'], case_field['id'])
        self.assertEqual(child['conditionValue'], 'yes')

    def test_orphan_conditional_child_rejected_on_non_case_block_type(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][0]['fields'][1]['yesFields'] = [{'title': 'Stray', 'fieldType': 'text', 'required': False}]
        response = self._post(programme_id, payload)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(any('yesFields' in key for key in response.json()['fields']))

    def test_nested_boolean_case_block_inside_conditional_child_rejected(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][1]['fields'][0]['yesFields'] = [{
            'title': 'Nested case', 'fieldType': 'boolean_case_block', 'required': True,
            'yesFields': [{'title': 'Too deep', 'fieldType': 'text', 'required': False}],
        }]
        response = self._post(programme_id, payload)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(any(key.endswith('.yesFields[0].fieldType') for key in response.json()['fields']))

    def test_deleting_section_removes_it_from_active_read(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._sections_payload()).json()['review']['id']
        # An edit that omits a previously-saved section removes it (replace-whole-tree save).
        response = self._patch(review_id, {'sections': [{
            'title': 'Meeting & Close', 'estimatedMinutes': 5,
            'fields': [{'title': 'Confirm attendance', 'fieldType': 'boolean', 'required': True}],
        }]})
        self.assertEqual(response.status_code, 200)
        review = response.json()['review']
        self.assertEqual(len(review['sections']), 1)
        self.assertEqual(review['sections'][0]['title'], 'Meeting & Close')

    def test_reordering_sections(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._sections_payload()).json()['review']['id']
        payload = self._sections_payload()
        payload['sections'] = list(reversed(payload['sections']))
        response = self._patch(review_id, payload)
        self.assertEqual(response.status_code, 200)
        titles = [s['title'] for s in response.json()['review']['sections']]
        self.assertEqual(titles, ['Meeting & Close', 'Learner Feedback on Teaching & Curriculum'])

    def test_reordering_conditional_children(self):
        programme_id = self._programme()
        payload = self._sections_payload()
        payload['sections'][1]['fields'][0]['yesFields'] = [
            {'title': 'First', 'fieldType': 'text', 'required': False},
            {'title': 'Second', 'fieldType': 'text', 'required': False},
        ]
        review_id = self._post(programme_id, payload).json()['review']['id']

        payload['sections'][1]['fields'][0]['yesFields'] = [
            {'title': 'Second', 'fieldType': 'text', 'required': False},
            {'title': 'First', 'fieldType': 'text', 'required': False},
        ]
        response = self._patch(review_id, payload)
        yes_fields = response.json()['review']['sections'][1]['fields'][0]['yesFields']
        self.assertEqual([f['title'] for f in yes_fields], ['Second', 'First'])
        self.assertEqual([f['displayOrder'] for f in yes_fields], [0, 1])

    def test_programme_isolation_for_sectioned_reviews(self):
        programme_a = self._programme('PROG-A', 'Programme A')
        programme_b = self._programme('PROG-B', 'Programme B')
        self._post(programme_a, self._sections_payload())
        self.assertEqual(self._get_list(programme_b).json()['results'], [])

    def test_soft_delete_leaves_sections_and_fields_in_database(self):
        programme_id = self._programme()
        review_id = self._post(programme_id, self._sections_payload()).json()['review']['id']
        self._delete(review_id)
        self.assertEqual(len(reviews.get_review_section_rows(review_id)), 0)  # soft-deleted, filtered from active reads
        with connection.cursor() as cursor:
            cursor.execute(
                f"select count(*) from {views.authoring_table_name(reviews.REVIEW_SECTIONS_TABLE)} where review_id = %s",
                [review_id],
            )
            self.assertEqual(cursor.fetchone()[0], 2)
        self.assertEqual(len(reviews.get_review_field_rows(review_id)), 5)
