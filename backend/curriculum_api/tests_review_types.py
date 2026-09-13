"""Review Types -- the configurable classification a Review Template carries.

Covers the three things that must stay true no matter what anyone renames:

  * a Review is classified by a stable ``review_type_id`` / ``code``, never by
    its display name;
  * a Review Type classifies and nothing else -- it never implies a
    recurrence, a question set or an eligibility rule;
  * the two system types are permanent, and the backfill from the retired
    ``coach_surface`` column lands existing Reviews on the right one.
"""
import json
from datetime import date
from io import StringIO

from django.core.management import call_command
from django.db import connection
from django.test import TestCase

from coach_api.views import review_event_type_for_type_code

from . import review_instances, review_schedule, review_types, reviews, views


class ReviewTypeTestCaseBase(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_schedule.provision_review_schedule_tables()
        review_instances.provision_review_instance_tables()
        self._clear()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            table = 'curriculum.programmes' if connection.vendor == 'postgresql' else 'programmes'
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
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
        for table in (
            reviews.REVIEW_FIELDS_TABLE,
            reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE,
            review_types.REVIEW_TYPES_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')
        review_types.seed_system_review_types()

    def _programme(self, programme_id='PROG-DATA', name='Data Technician'):
        views.insert_row('programmes', {
            'id': programme_id, 'programme_id': programme_id, 'program_id': programme_id,
            'name': name, 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': views.datetime.utcnow(), 'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _type_id(self, code):
        return review_types.get_review_type_by_code(code)['id']

    def _review_payload(self, **overrides):
        payload = {
            'name': 'Progress Review',
            'enabled': True,
            'reviewTypeId': self._type_id(review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW),
            'recurrence': {'interval': 12, 'unit': 'weeks'},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [{'title': 'Notes', 'fieldType': 'text', 'required': True}]}],
        }
        payload.update(overrides)
        return payload


class ReviewTypeCatalogueTests(ReviewTypeTestCaseBase):
    def test_seed_contains_the_two_system_types(self):
        by_code = {row['code']: row for row in review_types.list_review_types()}
        self.assertEqual(set(by_code), {'mcm', 'progress_review'})
        self.assertEqual(by_code['mcm']['name'], 'Monthly Coaching Meeting')
        self.assertEqual(by_code['progress_review']['name'], 'Progress Review')
        self.assertTrue(all(bool(row['is_system']) for row in by_code.values()))
        self.assertTrue(all(bool(row['is_active']) for row in by_code.values()))

    def test_seeding_twice_does_not_duplicate(self):
        review_types.seed_system_review_types()
        review_types.seed_system_review_types()
        self.assertEqual(len(review_types.list_review_types()), 2)

    def test_create_custom_type_generates_everything_but_the_name(self):
        row, errors = review_types.create_review_type('Career Review')
        self.assertIsNone(errors)
        self.assertEqual(row['name'], 'Career Review')
        self.assertEqual(row['code'], 'career_review')
        self.assertFalse(bool(row['is_system']))
        self.assertTrue(bool(row['is_active']))
        # Ids follow the project's generator, same as REV-/MOD-/PROG-.
        self.assertTrue(row['id'].startswith('REVT-'), row['id'])

    def test_duplicate_active_name_is_rejected(self):
        review_types.create_review_type('Career Review')
        row, errors = review_types.create_review_type('Career Review')
        self.assertIsNone(row)
        self.assertEqual(errors['name'], 'A review type with this name already exists.')

    def test_duplicate_name_comparison_ignores_case_and_whitespace(self):
        review_types.create_review_type('Career Review')
        for candidate in ('  career review  ', 'CAREER REVIEW', 'Career   Review'):
            row, errors = review_types.create_review_type(candidate)
            self.assertIsNone(row, candidate)
            self.assertEqual(errors['name'], 'A review type with this name already exists.', candidate)

    def test_a_system_type_name_cannot_be_reused(self):
        row, errors = review_types.create_review_type('  progress review ')
        self.assertIsNone(row)
        self.assertEqual(errors['name'], 'A review type with this name already exists.')

    def test_blank_name_is_rejected(self):
        row, errors = review_types.create_review_type('   ')
        self.assertIsNone(row)
        self.assertIn('name', errors)

    def test_generated_code_is_stable_across_a_rename(self):
        created, _ = review_types.create_review_type('Six Week Review')
        self.assertEqual(created['code'], 'six_week_review')

        renamed, errors = review_types.rename_review_type(created['id'], 'Six Weekly Check-in')
        self.assertIsNone(errors)
        self.assertEqual(renamed['name'], 'Six Weekly Check-in')
        # The code -- and therefore every routing decision keyed on it -- is
        # untouched by the rename.
        self.assertEqual(renamed['code'], 'six_week_review')

    def test_codes_stay_unique_when_two_names_slugify_the_same(self):
        first, _ = review_types.create_review_type('End of Module Review')
        second, _ = review_types.create_review_type('End-of-Module  Review!')
        self.assertEqual(first['code'], 'end_of_module_review')
        self.assertEqual(second['code'], 'end_of_module_review_2')

    def test_system_types_cannot_be_deleted(self):
        for code in ('mcm', 'progress_review'):
            row, errors = review_types.archive_review_type(self._type_id(code))
            self.assertIsNone(row, code)
            self.assertIn('cannot be deleted', errors['_'])
        self.assertEqual(len(review_types.list_review_types()), 2)

    def test_system_types_cannot_be_renamed(self):
        row, errors = review_types.rename_review_type(self._type_id('mcm'), 'Monthly Catch-up')
        self.assertIsNone(row)
        self.assertIn('cannot be renamed', errors['_'])

    def test_custom_type_is_archived_not_deleted(self):
        created, _ = review_types.create_review_type('Career Review')
        archived, errors = review_types.archive_review_type(created['id'])
        self.assertIsNone(errors)
        self.assertFalse(bool(archived['is_active']))
        # Gone from the picker, still resolvable by id for anything using it.
        self.assertNotIn(created['id'], {row['id'] for row in review_types.list_review_types()})
        self.assertIsNotNone(review_types.get_review_type(created['id']))

    def test_archiving_a_type_frees_its_name(self):
        created, _ = review_types.create_review_type('Career Review')
        review_types.archive_review_type(created['id'])
        row, errors = review_types.create_review_type('Career Review')
        self.assertIsNone(errors)
        self.assertNotEqual(row['id'], created['id'])


class ReviewTypeApiTests(ReviewTypeTestCaseBase):
    def _get(self, suffix=''):
        return self.client.get(f'/curriculum_api/curriculum/review-types/{suffix}')

    def _post(self, payload):
        return self.client.post(
            '/curriculum_api/curriculum/review-types/',
            data=json.dumps(payload), content_type='application/json',
        )

    def test_get_lists_active_types_in_the_documented_shape(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        results = response.json()['results']
        self.assertEqual(
            [{'name': row['name'], 'code': row['code'], 'isSystem': row['isSystem']} for row in results],
            [
                {'name': 'Monthly Coaching Meeting', 'code': 'mcm', 'isSystem': True},
                {'name': 'Progress Review', 'code': 'progress_review', 'isSystem': True},
            ],
        )
        self.assertTrue(all(row['id'] for row in results))

    def test_post_creates_from_the_name_alone(self):
        response = self._post({'name': '  Career Review  '})
        self.assertEqual(response.status_code, 201)
        created = response.json()['reviewType']
        self.assertEqual(created['name'], 'Career Review')
        self.assertEqual(created['code'], 'career_review')
        self.assertFalse(created['isSystem'])

        # And it is immediately offered for the next Review.
        names = [row['name'] for row in self._get().json()['results']]
        self.assertIn('Career Review', names)

    def test_post_ignores_client_supplied_internals(self):
        response = self._post({'name': 'Career Review', 'code': 'mcm', 'isSystem': True, 'id': 'REVT-HACK'})
        created = response.json()['reviewType']
        self.assertEqual(created['code'], 'career_review')
        self.assertFalse(created['isSystem'])
        self.assertNotEqual(created['id'], 'REVT-HACK')

    def test_post_duplicate_name_returns_the_validation_message(self):
        self._post({'name': 'Career Review'})
        response = self._post({'name': 'career review'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['fields']['name'], 'A review type with this name already exists.')

    def test_delete_refuses_a_system_type(self):
        response = self.client.delete(
            f'/curriculum_api/curriculum/review-types/{self._type_id("mcm")}/'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('cannot be deleted', response.json()['error'])

    def test_delete_archives_a_custom_type(self):
        created = self._post({'name': 'Career Review'}).json()['reviewType']
        response = self.client.delete(f'/curriculum_api/curriculum/review-types/{created["id"]}/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['archived'])
        self.assertFalse(response.json()['deleted'] and response.json()['permanent'])
        self.assertNotIn('Career Review', [row['name'] for row in self._get().json()['results']])
        self.assertIn('Career Review', [row['name'] for row in self._get('?includeInactive=1').json()['results']])


class ReviewTemplateTypeTests(ReviewTypeTestCaseBase):
    def _create(self, programme_id, payload):
        return self.client.post(
            f'/curriculum_api/curriculum/programmes/{programme_id}/reviews/',
            data=json.dumps(payload), content_type='application/json',
        )

    def test_a_review_cannot_be_saved_without_a_type(self):
        programme_id = self._programme()
        payload = self._review_payload()
        payload.pop('reviewTypeId')
        response = self._create(programme_id, payload)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['fields']['reviewTypeId'], 'Review type is required.')

    def test_a_blank_type_is_rejected(self):
        programme_id = self._programme()
        response = self._create(programme_id, self._review_payload(reviewTypeId='  '))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['fields']['reviewTypeId'], 'Review type is required.')

    def test_an_unknown_type_is_rejected(self):
        programme_id = self._programme()
        response = self._create(programme_id, self._review_payload(reviewTypeId='REVT-NOT-REAL'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['fields']['reviewTypeId'], 'Choose a valid review type.')

    def test_a_saved_review_echoes_its_type_id_code_and_name(self):
        programme_id = self._programme()
        review = self._create(programme_id, self._review_payload()).json()['review']
        self.assertEqual(review['reviewTypeId'], self._type_id('progress_review'))
        self.assertEqual(review['reviewTypeCode'], 'progress_review')
        self.assertEqual(review['reviewTypeName'], 'Progress Review')

    def test_a_custom_type_can_be_selected_for_a_review(self):
        programme_id = self._programme()
        custom, _ = review_types.create_review_type('Career Review')
        review = self._create(programme_id, self._review_payload(
            name='Where next?', reviewTypeId=custom['id'],
        )).json()['review']
        self.assertEqual(review['reviewTypeCode'], 'career_review')

    def test_two_reviews_on_one_programme_may_share_a_type(self):
        # A type classifies; it does not claim a slot. Nothing stops a
        # programme running two Monthly Coaching Meetings.
        programme_id = self._programme()
        mcm = self._type_id('mcm')
        first = self._create(programme_id, self._review_payload(name='Catch-up A', reviewTypeId=mcm))
        second = self._create(programme_id, self._review_payload(name='Catch-up B', reviewTypeId=mcm))
        self.assertEqual((first.status_code, second.status_code), (200, 200))

    def test_changing_the_type_leaves_recurrence_and_form_untouched(self):
        programme_id = self._programme()
        review = self._create(programme_id, self._review_payload(
            name='Six weekly coaching', reviewTypeId=self._type_id('mcm'),
            recurrence={'interval': 6, 'unit': 'weeks'},
        )).json()['review']

        custom, _ = review_types.create_review_type('Career Review')
        response = self.client.patch(
            f'/curriculum_api/curriculum/reviews/{review["id"]}/',
            data=json.dumps({'reviewTypeId': custom['id']}), content_type='application/json',
        )
        updated = response.json()['review']
        self.assertEqual(updated['reviewTypeCode'], 'career_review')
        # Schedule and Form Builder are the template's, not the type's.
        self.assertEqual(updated['recurrence'], {'interval': 6, 'unit': 'weeks'})
        self.assertEqual([field['title'] for field in updated['fields']], ['Notes'])

    def test_an_archived_type_stays_editable_on_the_review_using_it(self):
        programme_id = self._programme()
        custom, _ = review_types.create_review_type('Career Review')
        review = self._create(programme_id, self._review_payload(reviewTypeId=custom['id'])).json()['review']
        review_types.archive_review_type(custom['id'])

        response = self.client.patch(
            f'/curriculum_api/curriculum/reviews/{review["id"]}/',
            data=json.dumps({'name': 'Career conversation', 'reviewTypeId': custom['id']}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['review']['reviewTypeCode'], 'career_review')

    def test_cloning_a_review_carries_its_type(self):
        source = self._programme('PROG-SOURCE', 'Source')
        destination = self._programme('PROG-DEST', 'Destination')
        custom, _ = review_types.create_review_type('Career Review')
        review_id = self._create(source, self._review_payload(reviewTypeId=custom['id'])).json()['review']['id']

        response = self.client.post(
            f'/curriculum_api/curriculum/programmes/{destination}/reviews/clone/',
            data=json.dumps({'sourceProgrammeId': source, 'reviewIds': [review_id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        cloned = response.json()['reviews'][0]
        self.assertEqual(cloned['reviewTypeId'], custom['id'])
        self.assertEqual(cloned['reviewTypeCode'], 'career_review')


class ReviewTypeCalendarClassificationTests(ReviewTypeTestCaseBase):
    """The Review Type code is the only thing that decides a calendar bucket."""

    def _template(self, programme_id, *, name, type_code, interval=1, unit='months'):
        review_id, errors = reviews.create_review(programme_id, self._review_payload(
            name=name,
            reviewTypeId=self._type_id(type_code),
            recurrence={'interval': interval, 'unit': unit},
        ), actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _occurrences(self, programme_id):
        return review_instances.resolve_programme_review_occurrences(
            programme_id, learner_id=1, learner_status=None,
            learner_start_date=date(2026, 1, 1),
            window_start=date(2026, 1, 1), window_end=date(2026, 12, 31),
        )

    def _event_types(self, programme_id):
        return {
            occurrence['reviewName']: review_event_type_for_type_code(occurrence.get('reviewTypeCode'))
            for occurrence in self._occurrences(programme_id)
        }

    def test_mcm_type_maps_to_the_coach_mcr_filter(self):
        programme_id = self._programme()
        self._template(programme_id, name='Monthly Coaching Meeting', type_code='mcm')
        self.assertEqual(self._event_types(programme_id), {'Monthly Coaching Meeting': 'mcr'})

    def test_progress_review_type_maps_to_the_progress_review_filter(self):
        programme_id = self._programme()
        self._template(programme_id, name='Progress Review', type_code='progress_review', interval=12, unit='weeks')
        self.assertEqual(self._event_types(programme_id), {'Progress Review': 'progress-review'})

    def test_a_renamed_review_still_filters_by_its_type(self):
        programme_id = self._programme()
        review_id = self._template(programme_id, name='Monthly Learner Catch-up', type_code='mcm')
        # The name says nothing about MCM, and the type says nothing about the
        # name -- the bucket comes from the type.
        self.assertEqual(self._event_types(programme_id), {'Monthly Learner Catch-up': 'mcr'})

        reviews.update_review(review_id, {'name': 'Something else entirely'}, actor='test')
        self.assertEqual(self._event_types(programme_id), {'Something else entirely': 'mcr'})

    def test_a_custom_type_stays_a_generic_review_without_disturbing_the_two_filters(self):
        programme_id = self._programme()
        custom, _ = review_types.create_review_type('Career Review')
        reviews.create_review(programme_id, self._review_payload(
            name='Career Review', reviewTypeId=custom['id'],
            recurrence={'interval': 6, 'unit': 'weeks'},
        ), actor='test')
        self._template(programme_id, name='Monthly Coaching Meeting', type_code='mcm')
        self._template(programme_id, name='Progress Review', type_code='progress_review', interval=12, unit='weeks')

        self.assertEqual(self._event_types(programme_id), {
            'Career Review': 'review',
            'Monthly Coaching Meeting': 'mcr',
            'Progress Review': 'progress-review',
        })

    def test_an_unclassified_template_falls_into_the_generic_bucket(self):
        # A template that predates the backfill: no type, so no dedicated
        # bucket -- but it still reaches the calendar.
        programme_id = self._programme()
        review_id = self._template(programme_id, name='Legacy review', type_code='mcm')
        views.update_rows(
            reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id],
            {'review_type_id': ''},
        )
        self.assertEqual(self._event_types(programme_id), {'Legacy review': 'review'})

    def test_review_type_never_implies_a_recurrence(self):
        # Section 15 of the brief: "Review Type: Monthly Coaching Meeting,
        # Schedule: Every 6 weeks" must stay valid, and a custom type inherits
        # neither the MCM month nor the PR twelve weeks.
        programme_id = self._programme()
        custom, _ = review_types.create_review_type('Career Review')
        six_weekly_mcm = self._template(programme_id, name='Six weekly coaching', type_code='mcm', interval=6, unit='weeks')
        custom_id, _ = reviews.create_review(programme_id, self._review_payload(
            name='Career Review', reviewTypeId=custom['id'],
            recurrence={'interval': 3, 'unit': 'days'},
        ), actor='test')

        by_name = {
            row['name']: review_instances.template_recurrence_config(row)
            for row in review_instances.list_enabled_review_templates(programme_id)
        }
        self.assertEqual(by_name['Six weekly coaching']['interval'], 6)
        self.assertEqual(by_name['Six weekly coaching']['unit'], 'weeks')
        self.assertEqual(by_name['Career Review']['interval'], 3)
        self.assertEqual(by_name['Career Review']['unit'], 'days')
        self.assertTrue(six_weekly_mcm and custom_id)

    def test_the_mapping_never_reads_a_name(self):
        self.assertEqual(review_event_type_for_type_code('mcm'), 'mcr')
        self.assertEqual(review_event_type_for_type_code('progress_review'), 'progress-review')
        self.assertEqual(review_event_type_for_type_code('career_review'), 'review')
        self.assertEqual(review_event_type_for_type_code(''), 'review')
        self.assertEqual(review_event_type_for_type_code(None), 'review')
        # The display names of the system types are not codes.
        self.assertEqual(review_event_type_for_type_code('Monthly Coaching Meeting'), 'review')


class ReviewTypeBackfillTests(ReviewTypeTestCaseBase):
    """The one-time migration off review_templates.coach_surface."""

    def _add_legacy_column(self):
        """Recreate the pre-migration shape: the retired coach_surface column
        alongside the new review_type_id."""
        with connection.cursor() as cursor:
            cursor.execute(
                f'alter table {views.authoring_table_name(reviews.REVIEW_TEMPLATES_TABLE)} '
                f'add column coach_surface varchar(32)'
            )
        views.reset_schema_ready_flags()

    def _legacy_template(self, programme_id, *, name, coach_surface):
        review_id, errors = reviews.create_review(programme_id, self._review_payload(name=name), actor='test')
        self.assertIsNone(errors, errors)
        # Unclassified and carrying only the legacy routing value, exactly as
        # a template looks before the backfill runs.
        views.update_rows(
            reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id],
            {'review_type_id': '', 'coach_surface': coach_surface},
        )
        return review_id

    def test_existing_templates_are_backfilled_onto_the_right_type(self):
        programme_id = self._programme()
        self._add_legacy_column()
        mcm_id = self._legacy_template(programme_id, name='Monthly Coaching Meeting', coach_surface='mcr')
        pr_id = self._legacy_template(programme_id, name='Progress Review', coach_surface='progress_review')
        untouched_id = self._legacy_template(programme_id, name='Ad-hoc review', coach_surface=None)

        call_command('backfill_review_types', '--apply', stdout=StringIO(), stderr=StringIO())

        self.assertEqual(
            reviews.get_review_template_row(mcm_id)['review_type_id'], self._type_id('mcm'),
        )
        self.assertEqual(
            reviews.get_review_template_row(pr_id)['review_type_id'], self._type_id('progress_review'),
        )
        # A template that never claimed a Coach page is left alone -- it keeps
        # classifying generically until someone picks a type in the editor.
        self.assertFalse(reviews.get_review_template_row(untouched_id)['review_type_id'])

    def test_the_backfill_is_idempotent_and_never_overwrites_a_chosen_type(self):
        programme_id = self._programme()
        self._add_legacy_column()
        review_id = self._legacy_template(programme_id, name='Monthly Coaching Meeting', coach_surface='mcr')

        call_command('backfill_review_types', '--apply', stdout=StringIO(), stderr=StringIO())
        # Someone then corrects the classification by hand.
        custom, _ = review_types.create_review_type('Career Review')
        views.update_rows(reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], {'review_type_id': custom['id']})

        call_command('backfill_review_types', '--apply', stdout=StringIO(), stderr=StringIO())
        self.assertEqual(reviews.get_review_template_row(review_id)['review_type_id'], custom['id'])

    def test_a_dry_run_writes_nothing(self):
        programme_id = self._programme()
        self._add_legacy_column()
        review_id = self._legacy_template(programme_id, name='Monthly Coaching Meeting', coach_surface='mcr')

        out = StringIO()
        call_command('backfill_review_types', stdout=out, stderr=StringIO())

        self.assertFalse(reviews.get_review_template_row(review_id)['review_type_id'])
        self.assertIn('Dry run', out.getvalue())

    def test_backfilled_templates_classify_on_the_calendar(self):
        programme_id = self._programme()
        self._add_legacy_column()
        self._legacy_template(programme_id, name='Monthly Learner Catch-up', coach_surface='mcr')

        call_command('backfill_review_types', '--apply', stdout=StringIO(), stderr=StringIO())

        occurrences = review_instances.resolve_programme_review_occurrences(
            programme_id, learner_id=1, learner_status=None,
            learner_start_date=date(2026, 1, 1),
            window_start=date(2026, 1, 1), window_end=date(2026, 12, 31),
        )
        self.assertTrue(occurrences)
        self.assertEqual(
            {review_event_type_for_type_code(o.get('reviewTypeCode')) for o in occurrences},
            {'mcr'},
        )
