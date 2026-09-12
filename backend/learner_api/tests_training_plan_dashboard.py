"""Contract extraction and access controls without a test database."""
from types import SimpleNamespace
from datetime import date, datetime, time, timezone, timedelta
from unittest.mock import patch, MagicMock
from hashlib import sha256
import json
import pymupdf as fitz
from django.test import SimpleTestCase, RequestFactory
from .training_plan_contract import parse_contract, read_verified_extract, contract_extract_metadata, read_contract
from .training_plan_dashboard import training_plan_dashboard, number, selected_contract, plan_session, read_dashboard


def contract_pdf(total=30, review_on_same_page=False, joined_provider=False, split_header=False, split_total=False):
    document = fitz.open()
    page = document.new_page()
    page.insert_text((65,55),'Off-The-Job Training Hours',fontsize=9)
    for x, text in [(65, 'Activity/Unit'), (190, 'Method'), (270, 'Delivery'), (370, 'Planned Date'), (485, 'Planned')]:
        page.insert_text((x,100),text,fontsize=9)
    if split_header:
        page = document.new_page()
        page.insert_text((485,50),'OTJ (hr)',fontsize=9)
    else:
        page.insert_text((485,112),'OTJ (hr)',fontsize=9)
    for y, title, date, hours in [(145,'Marketing foundations','05/09/2026','10'),(180,'Brand strategy','19/09/2026','20')]:
        delivery = [(280,'Kent'+date)] if joined_provider else [(270,'College'),(370,date)]
        for x,text in [(65,title),(190,'Assignment'),*delivery,(490,hours)]:
            page.insert_text((x,y),text,fontsize=9)
        page.draw_line((65,y+12),(535,y+12))
    page.insert_text((375,218),'Total (hr)',fontsize=9)
    if split_total:
        page = document.new_page()
        page.insert_text((490,110),'0',fontsize=9)
        page.insert_text((490,145),str(total),fontsize=9)
        page.insert_text((65,180),'Progress Reviews',fontsize=12)
    else:
        page.insert_text((490,218),str(total),fontsize=9)
    if review_on_same_page:
        page.insert_text((65,260),'Progress Reviews',fontsize=12)
        page.insert_text((65,285),'Review type',fontsize=9)
        page.insert_text((370,310),'20/09/2026',fontsize=9)
        page.insert_text((490,310),'99',fontsize=9)
    result=document.tobytes()
    document.close()
    return result


class TrainingPlanDashboardTests(SimpleTestCase):
    def test_overview_reads_current_calendar_targets_and_stored_booking_changes(self):
        from coach_api.models import CoachCalendarEvent

        source = SimpleNamespace(pk=125, aptem_id=None, email='learner@example.com',
                                 start_date='2024-11-04', end_date='2026-11-03')
        profile = SimpleNamespace(id=272, lifecycle_status='active', email=source.email,
                                  start_date=None, end_date=None, coach_name='Assigned Coach', coach_email='coach@example.com')
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        records = []
        event_key = 'mcr:272:23:2026-09-25'
        with patch('learner_api.training_plan_dashboard.connections', {'enrolment': connection}), \
             patch('learner_api.training_plan_dashboard.LearnerProfile') as profiles, \
             patch('learner_api.training_plan_dashboard._builder_subject_metadata', return_value=({}, {})), \
             patch('learner_api.calendar.CoachCalendarEvent.objects.filter') as stored:
            profiles.objects.filter.return_value.first.return_value = profile
            stored.return_value.order_by.return_value = records

            def current():
                return [event for event in read_dashboard(source, section='overview')['reviews']
                        if event['eventKey'] == event_key]

            target = current()
            self.assertEqual(len(target), 1)
            self.assertEqual(target[0]['targetDate'], '2026-09-25')
            self.assertEqual(target[0]['status'], 'not-scheduled')
            self.assertIsNone(target[0]['scheduledDate'])

            # Unsaved fixture only: exercise the actual calendar serializer and
            # generated/stored merge without making any database changes.
            booking = CoachCalendarEvent(event_key=event_key, event_type='mcr', learner_id=272,
                                         learner_email=source.email, sequence=23, target_date=date(2026, 9, 25),
                                         scheduled_date=date(2026, 9, 28), scheduled_time=time(14),
                                         status='scheduled', owner_name='Assigned Coach')
            records.append(booking)
            booked = current()
            self.assertEqual(len(booked), 1)
            self.assertEqual(booked[0]['scheduledDate'], '2026-09-28')
            self.assertFalse(booked[0]['invited'])

            booking.scheduled_date = date(2026, 9, 20)
            booking.scheduled_time = time(10, 30)
            booking.owner_name = 'New Coach'
            booking.graph_event_id = 'invitation-synced'
            moved = current()[0]
            self.assertEqual((moved['scheduledDate'], moved['scheduledTime'], moved['coachName'], moved['invited']),
                             ('2026-09-20', '10:30', 'New Coach', True))

            for status in ('cancelled', 'completed'):
                booking.status = status
                booking.scheduled_date = None
                booking.scheduled_time = None
                result = current()
                self.assertEqual(len(result), 1)
                self.assertEqual(result[0]['status'], status)
                # The stored inactive row must suppress its generated target;
                # Upcoming filters it rather than showing a duplicate To book.

            # Unbooked targets also track changes to the source programme window.
            records.clear()
            source.start_date = '2024-11-05'
            source.end_date = '2026-09-30'
            profile.coach_name = 'Replacement Coach'
            reviews = read_dashboard(source, section='overview')['reviews']
            monthly = [event for event in reviews if event['source'] == 'mcr']
            self.assertEqual(monthly[-1]['sequence'], 23)
            self.assertEqual(monthly[-1]['targetDate'], '2026-09-26')
            self.assertEqual(monthly[-1]['coachName'], 'Replacement Coach')
            self.assertNotIn(event_key, [event['eventKey'] for event in reviews])

    def test_overview_does_not_download_or_parse_contract(self):
        source = SimpleNamespace(pk=125, aptem_id='92', email='learner@example.com')
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch('learner_api.training_plan_dashboard.connections', {'enrolment': connection}), \
             patch('learner_api.training_plan_dashboard.LearnerProfile') as profiles, \
             patch('learner_api.training_plan_dashboard.rows', return_value=[]), \
             patch('learner_api.training_plan_dashboard.find_contract', return_value={'azure_path':'stored'}), \
             patch('learner_api.training_plan_dashboard._builder_subject_metadata', return_value=({}, {})), \
             patch('learner_api.calendar.coaching_events_for_learner', return_value=[]), \
             patch('learner_api.training_plan_dashboard.contract_plan') as extract:
            profiles.objects.filter.return_value.first.return_value = None
            result = read_dashboard(source, section='overview')
        self.assertEqual(result['contractStatus'], 'loading')
        self.assertEqual(result['months'], {})
        extract.assert_not_called()

    def test_contract_section_does_not_read_modules_or_reviews(self):
        source = SimpleNamespace(pk=101, aptem_id=None, email='learner@example.com')
        connection = MagicMock()
        with patch('learner_api.training_plan_dashboard.connections', {'enrolment': connection}), \
             patch('learner_api.training_plan_dashboard.LearnerProfile') as profiles, \
             patch('learner_api.calendar.coaching_events_for_learner') as reviews:
            self.assertEqual(read_dashboard(source, section='contract'), {'months': {}, 'contractStatus': 'not-available'})
        profiles.objects.filter.assert_not_called()
        connection.cursor.return_value.__enter__.return_value.execute.assert_not_called()
        reviews.assert_not_called()

    def test_contract_download_uses_one_size_check_and_reuses_versioned_extract(self):
        read_contract.cache_clear()
        service = MagicMock()
        client = service.get_blob_client.return_value
        client.get_blob_properties.return_value.size = 100
        client.download_blob.return_value.readall.return_value = contract_pdf()
        try:
            with patch('audit_api.views._azure_service_client') as storage, \
                 patch('audit_api.views._parse_contract_azure_path', return_value=('contracts', 'plan.pdf')):
                storage.return_value.__enter__.return_value = service
                first = read_contract('stored', 30, 'version-1')
                self.assertEqual(read_contract('stored', 30, 'version-1'), first)
                self.assertEqual(first['2026-09']['planned'], 30)
                client.get_blob_properties.assert_called_once_with(connection_timeout=5, read_timeout=10, retry_total=0)
                client.download_blob.assert_called_once()
                read_contract('stored', 30, 'version-2')
                self.assertEqual(client.download_blob.call_count, 2)
        finally:
            read_contract.cache_clear()

    def test_oversized_contract_is_not_downloaded(self):
        read_contract.cache_clear()
        service = MagicMock()
        client = service.get_blob_client.return_value
        client.get_blob_properties.return_value.size = 31 * 1024 * 1024
        try:
            with patch('audit_api.views._azure_service_client') as storage, \
                 patch('audit_api.views._parse_contract_azure_path', return_value=('contracts', 'plan.pdf')):
                storage.return_value.__enter__.return_value = service
                self.assertIsNone(read_contract('oversize', None, '1'))
                client.download_blob.assert_not_called()
        finally:
            read_contract.cache_clear()

    def test_occurrence_link_and_rescheduled_duration_win_over_series_defaults(self):
        start=datetime(2026,9,14,12,0,tzinfo=timezone.utc)
        row={'occurrence_id':'O1','session_id':'S1','module_id':'M1','module_title':'Marketing',
             'scheduled_start':start,'scheduled_end':start+timedelta(minutes=45),'start_datetime':start-timedelta(days=7),
             'duration_minutes':60,'join_url':'https://teams.microsoft.com/occurrence','series_join_url':'https://teams.microsoft.com/series',
             'status':'completed','series_status':'active','attended':False}
        self.assertEqual(plan_session(row),{'id':'O1','moduleId':'M1','title':'Marketing','start':start.isoformat(),
          'end':(start+timedelta(minutes=45)).isoformat(),'minutes':45,'joinUrl':row['join_url'],'status':'completed','attended':False})
        row.update(occurrence_id=None,scheduled_start=None,scheduled_end=None,status=None,series_status='completed',join_url='')
        self.assertEqual(plan_session(row)['status'],'completed')
        self.assertEqual(plan_session(row)['joinUrl'],row['series_join_url'])

    def reviewed_extract(self, **changes):
        return json.dumps({'version':1,'pdf_sha256':sha256(b'reviewed PDF').hexdigest(),'printed_total':10,
            'activities':[{'date':'2026-09-14','title':'Marketing','method':'Assignment','hours':10}],**changes})

    def test_reviewed_scan_preserves_its_monthly_plan(self):
        result=read_verified_extract(b'reviewed PDF',self.reviewed_extract())
        self.assertEqual(result['2026-09']['planned'],10)
        self.assertEqual(result['2026-09']['topics'],['Marketing'])

    def test_reviewed_extract_cannot_be_used_for_a_replaced_pdf(self):
        self.assertIsNone(read_verified_extract(b'changed PDF',self.reviewed_extract()))

    def test_reviewed_extract_must_match_its_printed_total(self):
        self.assertIsNone(read_verified_extract(b'reviewed PDF',self.reviewed_extract(printed_total=11)))

    def test_reviewed_extract_rejects_invalid_rows_and_numbers(self):
        for changes in ({'date':'2026-02-30'},{'hours':'NaN'},{'hours':-1},{'hours':True},{'title':''}):
            row={'date':'2026-09-14','title':'Marketing','method':'Assignment','hours':10,**changes}
            self.assertIsNone(read_verified_extract(b'reviewed PDF',self.reviewed_extract(activities=[row])))

    def test_bad_reviewed_metadata_does_not_break_the_dashboard(self):
        for metadata in (None,'invalid','[]','{"activities": null}',self.reviewed_extract(version=2)):
            self.assertIsNone(read_verified_extract(b'reviewed PDF',metadata))
        for raw in (None,'invalid','[]',{'other':'metadata'}):
            self.assertIsNone(contract_extract_metadata(raw))
        raw={'_verified_training_plan':json.loads(self.reviewed_extract()),'other':'preserved'}
        self.assertEqual(json.loads(contract_extract_metadata(json.dumps(raw))),raw['_verified_training_plan'])

    def test_missing_review_placeholder_uses_its_matching_azure_document(self):
        date = datetime(2025,5,8,23,16,46,616667,tzinfo=timezone.utc)
        placeholder = {'id':6320,'date':date,'document_name':'Training Plan.pdf','azure_path':None}
        document = {'id':790,'date':date-timedelta(microseconds=1),'document_name':'Training Plan','azure_path':'az://existing.pdf'}
        self.assertIs(selected_contract([placeholder, document]),document)
        self.assertIs(selected_contract([placeholder, {**document,'date':date-timedelta(days=1)}]),placeholder)
        self.assertIs(selected_contract([placeholder, document, {**document,'id':791}]),placeholder)

    def test_reads_topics_and_contract_total_without_adding_the_total_row(self):
        result = parse_contract(contract_pdf(),30)
        self.assertEqual(result['2026-09']['planned'],30)
        self.assertEqual(result['2026-09']['topics'],['Marketing foundations','Brand strategy'])
        self.assertEqual(len(result['2026-09']['activities']),2)

    def test_rejects_an_extract_that_disagrees_with_the_pdf_total(self):
        self.assertIsNone(parse_contract(contract_pdf(31)))

    def test_uses_verified_pdf_total_when_database_extraction_is_stale(self):
        self.assertEqual(parse_contract(contract_pdf(),29)['2026-09']['planned'],30)

    def test_learning_total_and_reviews_can_share_the_last_page(self):
        result = parse_contract(contract_pdf(review_on_same_page=True),30)
        self.assertEqual(result['2026-09']['planned'],30)
        self.assertEqual(len(result['2026-09']['activities']),2)

    def test_dates_can_touch_the_delivery_provider_text(self):
        result = parse_contract(contract_pdf(joined_provider=True),30)
        self.assertEqual(result['2026-09']['planned'],30)

    def test_table_heading_can_split_between_pdf_pages(self):
        result = parse_contract(contract_pdf(split_header=True),30)
        self.assertEqual(result['2026-09']['planned'],30)
        self.assertEqual(result['2026-09']['topics'],['Marketing foundations','Brand strategy'])

    def test_printed_total_can_continue_on_the_next_page_before_reviews(self):
        result = parse_contract(contract_pdf(split_total=True),30)
        self.assertEqual(result['2026-09']['planned'],30)
        self.assertIsNone(parse_contract(contract_pdf(total=31, split_total=True)))

    def test_missing_numeric_values_are_not_reported_as_zero(self):
        for value in (None,'invalid','NaN','Infinity',-1):
            self.assertIsNone(number(value))
        self.assertEqual(number(0),0)

    def test_other_learner_cannot_read_dashboard(self):
        account=SimpleNamespace(role='learner',subject_type='learner',subject_id=125)
        request=RequestFactory().get('/?aptem_id=92')
        with patch('login.permissions.authenticate_request',return_value=account), patch('learner_api.training_plan_dashboard.read_dashboard') as read:
            response=training_plan_dashboard(request,kind='commercial',pk=126)
        self.assertEqual(response.status_code,404)
        read.assert_not_called()

    def test_dashboard_has_no_write_method(self):
        response=training_plan_dashboard(RequestFactory().post('/'),kind='commercial',pk=125)
        self.assertEqual(response.status_code,405)
