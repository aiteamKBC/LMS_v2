"""Real PostgreSQL, ORM, sessions and HTTP; synthetic data; no production settings."""
def composition_fixture(*args, **kwargs):
    from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture as inject
    return inject(*args, **kwargs)

import ast
from contextlib import ExitStack, contextmanager
import hashlib
import importlib
import json
import os
from pathlib import Path
from types import FunctionType, SimpleNamespace
import socket
import sys
import unittest
from unittest.mock import patch

assert [name for _, name in socket.if_nameindex()] == ['lo']
assert len(Path('/proc/net/route').read_text().splitlines()) == 1
assert not any(key in os.environ for key in ('NEW_ENDPOINT_URL', 'DATABASE_URL', 'DJANGO_SETTINGS_MODULE'))
sys.path.insert(0, '/tmp/phase1f/backend')
os.environ['LEARNER_API_REQUIRE_AUTH'] = '1'
from django.apps import AppConfig
from django.conf import settings
db = dict(ENGINE='django.db.backends.postgresql', HOST='127.0.0.1', PORT='5432',
          NAME='phase1f', USER='postgres', PASSWORD='phase1f-synthetic', CONN_MAX_AGE=600,
          OPTIONS={'connect_timeout': 5, 'options': '-c statement_timeout=5000'})
settings.configure(SECRET_KEY='phase1f-synthetic', DEBUG=False, USE_TZ=True,
    INSTALLED_APPS=[AppConfig(n, importlib.import_module(n)) for n in ('learner_api','curriculum_api','login','read_models','coach_api')],
    DATABASES={k: dict(db) for k in ('default','enrolment','audit','audit_clone','kbc_attendance','assistant_conversations')},
    CACHES={'default': {'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}},
    ROOT_URLCONF=__name__, ALLOWED_HOSTS=['testserver'],
    DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'],
    MIDDLEWARE=['login.middleware.LoginSessionMiddleware'], DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
    CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP=False, READ_MODEL_OUTBOX_ENABLED=False)
assert all(v['HOST']=='127.0.0.1' and v['NAME']=='phase1f' for v in settings.DATABASES.values())
import django
django.setup()
from django.db import connection, transaction, connections
from django.core.cache import cache
from django.urls import path
from django.test import Client
from learner_api import learning_plan as learner_plan_http, models as lm
from curriculum_api import models as cm, views, learner_assignments as assignments, learner_status_counts as counts
from login import models as auth, sessions
assert lm.EnrolmentUser.all_learners.db == 'enrolment'
assert auth.LoginSession.objects.db == 'enrolment'
assert cm.ModuleAuthoringModule.objects.db == 'default'
from curriculum_api import learner_directory, learner_directory_details
from curriculum_api import record_snapshots
urlpatterns = [path('curriculum/learner-directory/learners/', learner_directory.learners),
               path('curriculum/learner-directory/progress/', learner_directory_details.progress),
               path('curriculum/learner-directory/counts/', learner_directory.counts),
               path('curriculum/tutor-workspace/', views.curriculum_tutor_workspace),
               path('curriculum/archive/modules/<str:module_catalogue_id>/structure/', views.curriculum_archived_module_structure),
               # Exact production routes needed by the existing TTL contract fixtures.
               path('curriculum_api/curriculum/programmes/<str:programme_id>/ksb-stats/', views.curriculum_programme_ksb_stats),
               path('curriculum_api/curriculum/programmes/<str:identifier>/detail/', views.curriculum_programme_tree_detail),
               path('curriculum_api/curriculum/programmes/<str:identifier>/detail/<str:section>/', views.curriculum_programme_detail_section),
               path('reporting/<str:programme_id>/impact/', views.curriculum_programme_learner_ksb_impact),
               path('curriculum/modules/<str:module_catalogue_id>/structure/', views.curriculum_module_structure),
               path('curriculum/standards/', views.curriculum_standards),
               path('curriculum/standards/<str:identifier>/', views.curriculum_standard_detail),
               path('reporting/<str:programme_id>/stats/', views.curriculum_programme_ksb_stats),
               path('reporting/<str:programme_id>/achievement/', views.curriculum_programme_ksb_achievement),
               path('reporting/<str:programme_id>/coverage/', views.curriculum_programme_ksb_coverage),
               path('curriculum/overview/', views.curriculum_overview),
               path('curriculum/sessions/', views.curriculum_sessions),
               path('curriculum/programmes/<str:identifier>/detail/<str:section>/', views.curriculum_programme_detail_section),
               path('curriculum/coaches/', views.curriculum_coaches),
               path('curriculum/tutors/', views.curriculum_tutors),
               path('curriculum/tutors/<str:identifier>/', views.curriculum_tutor_detail),
               path('modules/<str:identifier>/learners/', assignments.module_learner_assignments),
               path('curriculum/revisions/', views.curriculum_record_revisions),
               path('curriculum/record-snapshot/', record_snapshots.curriculum_record_snapshot),
               path('curriculum/week-templates/', views.curriculum_week_template_collection),
               path('curriculum/week-templates/<str:identifier>/', views.curriculum_week_template_detail),
               path('curriculum/holidays/', views.curriculum_holidays),
               path('curriculum/modules/<str:module_catalogue_id>/session-plan/', views.curriculum_module_session_plan),
               path('curriculum/preview/module-session-plan/', views.curriculum_preview_module_session_plan),
               path('curriculum/preview/tutor-availability/', views.curriculum_preview_tutor_availability),
               path('learning-plan/<int:pk>/', learner_plan_http.learning_plan)]

# Exact immutable old reader, retaining its original globals and relative imports.
snapshot_bytes = Path('/tmp/phase1f/backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots/membership_preintegration_snapshot.json').read_bytes()
assert '24c360f42bbc158624275b853222d2fe2476cdb201b89fe264bea6764c593e51' in {
    hashlib.sha256(snapshot_bytes).hexdigest(),
    hashlib.sha256(snapshot_bytes.replace(b'\r\n', b'\n')).hexdigest(),
}
snapshot = json.loads(snapshot_bytes)
old_env = dict(vars(counts))
# Independent pre-Batch-02 SQL reader, not the refactored compatibility wrapper.
facts_bytes = Path('/tmp/phase1f/backend/learner_api/learning_plans/tests/fixtures/legacy_snapshots/learner_facts_prebatch02.json').read_bytes()
assert '0a82781326dd696a2ab622350688ddbfef7c6e6dd667bc09fb2b0d8ad99c4376' in {
    hashlib.sha256(facts_bytes).hexdigest(),
    hashlib.sha256(facts_bytes.replace(b'\r\n', b'\n')).hexdigest(),
}
exec(compile(ast.parse(json.loads(facts_bytes)['source']), '<prebatch02-facts>', 'exec'), old_env)
for name in ('members_for_lineages','module_member_enrolment_ids'):
    entry = snapshot[name]
    exec(compile(ast.parse(entry['source']), '<immutable-preintegration>', 'exec'), old_env)
old_reader = old_env['module_member_enrolment_ids']
new_reader = counts.module_member_enrolment_ids

# Independent catalogue oracle frozen before Batch 03. No production imports
# are copied or replaced in the new branch; old runs patch only legacy exports.
from curriculum_api import home_summary, programme_list
catalogue_bytes = Path('/tmp/phase1f/backend/curriculum_api/catalogue/tests/fixtures/legacy_snapshots/prebatch03_snapshot.json').read_bytes()
assert 'df45c28e0d47de2e705afacfd39c9eb2b2a3c56ceec04e163271b2eba1afe19c' in {
    hashlib.sha256(catalogue_bytes).hexdigest(),
    hashlib.sha256(catalogue_bytes.replace(b'\r\n', b'\n')).hexdigest(),
}
catalogue_snapshot = json.loads(catalogue_bytes)
legacy_modules = {'views.py': views, 'home_summary.py': views, 'programme_list.py': views}
legacy_envs = {name: dict(vars(module)) for name, module in legacy_modules.items()}
from curriculum_api.catalogue.infrastructure import projection_sources as projection_fields
from curriculum_api import curriculum_names
from curriculum_api.test_projection_consumer_boundary_no_db import original as frozen_projection_consumer
module_authoring_facts = frozen_projection_consumer("home_summary.py")
legacy_projection_globals = {
    **{name: value for name, value in vars(projection_fields).items() if name.endswith('_FIELDS')},
    'views': views, 'curriculum_names': curriculum_names,
    'ksb_counts_selection': module_authoring_facts.ksb_counts_selection,
    'decode_counts': module_authoring_facts.decode_counts,
    'apply_authoring_facts': module_authoring_facts.apply_authoring_facts,
    'project_home': home_summary.project_home,
}
for key, entry in catalogue_snapshot.items():
    filename, name = key.split(':')
    exec(compile(ast.parse(entry['source']), '<prebatch03-catalogue>', 'exec'), legacy_envs[filename])
    original = legacy_envs[filename][name]
    # Use the real module globals so existing mock bindings and old-to-old calls
    # behave exactly as they did before extraction, not a stale dict copy.
    restored = FunctionType(original.__code__, vars(legacy_modules[filename]), name, original.__defaults__)
    restored.__kwdefaults__ = original.__kwdefaults__
    legacy_envs[filename][name] = restored

@contextmanager
def legacy_catalogue():
    with ExitStack() as stack:
        # Frozen source retains its original globals; production consumers no
        # longer import views. Supply the old binding only inside this oracle.
        for name, value in legacy_projection_globals.items():
            stack.enter_context(composition_fixture(views, name, value, create=True))
        for key in catalogue_snapshot:
            filename, name = key.split(':')
            stack.enter_context(patch.object(legacy_modules[filename], name, legacy_envs[filename][name]))
        yield

def report_sql_error(execute, sql, params, many, context):
    try:
        return execute(sql, params, many, context)
    except Exception as error:
        print('SQL ERROR:', type(error).__name__, str(error).splitlines()[0], 'SQL:', sql[:250], flush=True)
        raise
connection.execute_wrappers.append(report_sql_error)

with connection.cursor() as cursor:
    cursor.execute('SELECT current_database(), current_user')
    assert cursor.fetchone() == ('phase1f','postgres')
    for schema in ('curriculum','Learner','enrolment','login'):
        cursor.execute('CREATE SCHEMA ' + connection.ops.quote_name(schema))
models = [lm.PlacementProgramme,lm.PlacementCohort,lm.PlacementGroup,lm.PlacementCoach,
          cm.ModuleAuthoringModule,cm.ModuleAuthoringWeek,cm.ModuleAuthoringComponent,
          cm.ModuleAuthoringKsbMapping,cm.ModuleAuthoringCompletionCriteria,
          lm.EnrolmentUser,lm.StaffUser,lm.LearnerProfile,lm.LearnerTrainingPlanModule,
          lm.LearnerTrainingPlanWeek,lm.LearnerTrainingPlanComponent,auth.LoginAccount,auth.LoginSession]
with connection.schema_editor() as editor:
    for model in [*models, lm.LearnerProgressEntry]:
        editor.create_model(model)
with connection.cursor() as cursor:
    cursor.execute("ALTER TABLE curriculum.modules ADD COLUMN learner_roster_mode text DEFAULT 'inherited', ADD COLUMN source_type text, ADD COLUMN source_id text, ADD COLUMN start_date date, ADD COLUMN end_date date, ADD COLUMN sessions_number integer DEFAULT 0, ADD COLUMN weeks_number integer DEFAULT 0")
    cursor.execute('CREATE TABLE curriculum.standard_ksbs (id bigserial PRIMARY KEY, ksb_code text, ksb_description text, standard_ref text, standard_version text, ksb_type text, standard_title text)')
    cursor.execute('''CREATE TABLE curriculum.free_courses (
        id varchar(128) PRIMARY KEY, course_name text NOT NULL DEFAULT '', description text,
        cover_image_url text, display_order integer NOT NULL DEFAULT 0,
        week_count integer NOT NULL DEFAULT 0, component_count integer NOT NULL DEFAULT 0,
        total_otjh numeric NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT current_timestamp,
        updated_at timestamp NOT NULL DEFAULT current_timestamp, course_type varchar(16) NOT NULL DEFAULT 'free',
        is_for_sale boolean NOT NULL DEFAULT false, price numeric(10,2), currency varchar(3) NOT NULL DEFAULT 'GBP')''')
    cursor.execute('ALTER TABLE curriculum.programmes ADD COLUMN ksb_profile_source_id text')
    cursor.execute('CREATE TABLE curriculum.module_details (module_catalogue_id varchar(128) PRIMARY KEY, background text, epa_requirements jsonb, professional_qualification_outcomes jsonb, intent text, learner_benefit text, employer_benefit text, sequence_purpose text)')
    cursor.execute('ALTER TABLE curriculum.modules ADD COLUMN session_week_day text, ADD COLUMN color text')
    # Staff assignment is read by the raw catalogue reader, not the ORM model.
    cursor.execute('ALTER TABLE curriculum.modules ADD COLUMN tutor_name text')
    # Session-plan read contracts on disposable fixture tables only.
    cursor.execute('ALTER TABLE curriculum.modules ADD COLUMN session_start_time text, ADD COLUMN session_end_time text, ADD COLUMN schedule_mode text, ADD COLUMN week_starts_on text, ADD COLUMN weekly_schedule jsonb, ADD COLUMN session_overrides jsonb, ADD COLUMN session_holidays jsonb, ADD COLUMN calendar_policy jsonb')
    cursor.execute("CREATE TABLE curriculum.tutors (id text PRIMARY KEY, name text, email text, phone text, status text DEFAULT 'active')")
    for table in ('programmes','cohorts','groups'):
        cursor.execute("ALTER TABLE curriculum."+table+" ADD COLUMN status text DEFAULT 'active'")
    for table in ('cohorts','groups'):
        cursor.execute('ALTER TABLE curriculum.'+table+' ADD COLUMN start_date date, ADD COLUMN end_date date, ADD COLUMN created_at timestamp DEFAULT current_timestamp, ADD COLUMN updated_at timestamp DEFAULT current_timestamp')
    # Cohort/Group read-contract fixtures; never application schema provisioning.
    cursor.execute('ALTER TABLE curriculum.cohorts ADD COLUMN duration_months integer, ADD COLUMN epa_months integer, ADD COLUMN apprenticeship_end_override date, ADD COLUMN apprenticeship_end_date date, ADD COLUMN holiday_ids jsonb, ADD COLUMN excluded_holiday_ids jsonb, ADD COLUMN calendar_policy jsonb, ADD COLUMN deleted_at timestamp')
    cursor.execute('ALTER TABLE curriculum.groups ADD COLUMN schedule text, ADD COLUMN week_days text, ADD COLUMN session_start_time text, ADD COLUMN session_end_time text, ADD COLUMN coach_name text, ADD COLUMN module_ids jsonb, ADD COLUMN deleted_at timestamp')
    # Read-only calendar contracts on disposable synthetic tables only.
    cursor.execute('CREATE TABLE curriculum.calendar_holidays (id text PRIMARY KEY, source_kind text, source_record_id text, label text, start_date date, end_date date, category text, color text, notes text, is_archived boolean DEFAULT false, division text, bunting boolean, fetched_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())')
    cursor.execute('CREATE TABLE curriculum.cohort_calendar_holidays (id bigserial PRIMARY KEY, cohort_id text, calendar_holiday_id text, is_selected boolean, is_excluded boolean)')
    cursor.execute('CREATE TABLE curriculum.country_holiday_calendars (country text, year integer, fetched_at timestamptz, holidays jsonb, last_error text)')
    cursor.execute('CREATE TABLE curriculum.fixture_england_holidays (id text, holiday_date date, title text, division text, notes text, bunting boolean)')
    cursor.execute('CREATE TABLE curriculum.fixture_authored_holidays (id text, label text, start_date date, end_date date, is_archived boolean)')
    # Representative week-template rows in this disposable fixture only.
    cursor.execute("CREATE TABLE curriculum.week_templates (id varchar(128) PRIMARY KEY, title text, learning_outcomes jsonb, status text DEFAULT 'draft', created_at timestamp DEFAULT current_timestamp, updated_at timestamp DEFAULT current_timestamp)")
    cursor.execute("CREATE TABLE curriculum.week_template_components (id varchar(128) PRIMARY KEY, week_template_id varchar(128), type text, title text, settings_json jsonb, created_at timestamp DEFAULT current_timestamp, updated_at timestamp DEFAULT current_timestamp)")
    # Read-contract columns only, on disposable fixture tables; no app provisioning.
    cursor.execute("ALTER TABLE curriculum.week_templates ADD COLUMN summary text, ADD COLUMN course_type text DEFAULT 'paid', ADD COLUMN programme_id text, ADD COLUMN programme_name text, ADD COLUMN module_catalogue_id text, ADD COLUMN group_id text, ADD COLUMN group_name text, ADD COLUMN ksb_mappings jsonb, ADD COLUMN total_otjh numeric(8,2) DEFAULT 0, ADD COLUMN points integer DEFAULT 0, ADD COLUMN component_count integer DEFAULT 0, ADD COLUMN author text, ADD COLUMN deleted_at timestamp")
    cursor.execute("ALTER TABLE curriculum.week_template_components ADD COLUMN description text, ADD COLUMN expected_otjh numeric(8,2) DEFAULT 0, ADD COLUMN points integer DEFAULT 0, ADD COLUMN reflection_required boolean DEFAULT false, ADD COLUMN reflection_question text, ADD COLUMN workplace_evidence_required boolean DEFAULT false, ADD COLUMN tutor_validation_required boolean DEFAULT false, ADD COLUMN coach_validation_required boolean, ADD COLUMN ksb_mappings jsonb, ADD COLUMN display_order integer DEFAULT 0")
# Reporting read contracts exist only in this disposable synthetic database.
with connection.cursor() as cursor:
    cursor.execute('ALTER TABLE "Learner".learner_progress_entries ADD COLUMN ssot_updated_at timestamptz')
    cursor.execute('''CREATE TABLE "Learner".learner_progress_ksbs (
        progress_id bigint, position integer, ksb_code text, weight numeric, weight_class text)''')
    cursor.execute('''CREATE TABLE "Learner".learner_progress_ksb_exclusions (
        progress_id bigint, position integer, ksb_code text, status text)''')
    cursor.execute('''CREATE TABLE "Learner".learning_reflection_submissions (
        id text PRIMARY KEY, progress_entry_id bigint, ksb_weights jsonb, learner_id text,
        component_ref text, activity_id text, activity_title text, planned_otjh text,
        actual_time_hours text, status text, submitted_at timestamptz, ksb_codes jsonb)''')
    cursor.execute('''CREATE TABLE "Learner".evidence_files (
        id text PRIMARY KEY, progress_entry_id bigint, learner_id text, original_filename text,
        status text, scan_result text, section_ref text, component_ref text, uploaded_at timestamptz,
        content_type text, size_bytes bigint)''')
print('Django startup and disposable schema PASS', flush=True)

class MembershipIntegration(unittest.TestCase):
    def setUp(self):
        with connection.cursor() as cursor:
            cursor.execute('TRUNCATE "Learner".evidence_files, "Learner".learner_progress_entries, "Learner".learner_progress_ksbs, "Learner".learner_progress_ksb_exclusions, "Learner".learning_reflection_submissions')
            cursor.execute('TRUNCATE curriculum.standard_ksbs, curriculum.module_details, curriculum.week_templates, curriculum.week_template_components, curriculum.tutors CASCADE')
            cursor.execute('TRUNCATE curriculum.calendar_holidays, curriculum.cohort_calendar_holidays, curriculum.country_holiday_calendars, curriculum.fixture_england_holidays, curriculum.fixture_authored_holidays')
            cursor.execute('TRUNCATE ' + ','.join(connection.ops.quote_name(m._meta.db_table) for m in models) + ' RESTART IDENTITY CASCADE')
        cache.clear()
        views.cache_state._CURRICULUM_CACHE.clear()
        views.curriculum_names.invalidate()
        lm.PlacementProgramme.objects.create(programme_id='P', name='Synthetic programme')
        lm.PlacementCohort.objects.create(cohort_id='C',cohort_name='Synthetic cohort',programme_id='P')
        lm.PlacementGroup.objects.create(group_id='G',group_name='Synthetic group',programme_id='P',cohort_id='C')
        for mid in ('MOD-TEST','MOD-SIBLING','MOD-EMPTY'):
            cm.ModuleAuthoringModule.objects.create(module_catalogue_id=mid,title=mid,programme_id='P',cohort_id='C',group_id='G')
        with connection.cursor() as c:
            c.execute("UPDATE curriculum.modules SET learner_roster_mode='manual' WHERE module_catalogue_id='MOD-EMPTY'")
        for i in range(1,7):
            lm.EnrolmentUser.all_learners.create(id=100+i,username=f'Synthetic {7-i}',email=f'synthetic{i}@example.invalid',learner_type='apprenticeship',programme_id='P',cohort_id='C',group_id='G')
            p = lm.LearnerProfile.objects.create(id=i,full_name=f'Synthetic {i}',email=f'profile{i}@example.invalid',enrolment_id=100+i,
                programme_id='P' if i not in (4,5) else None,cohort_id='C' if i not in (4,5) else None,
                group_id='G' if i not in (4,5) else None,lifecycle_status='inactive' if i==6 else 'active')
            if i in (2,3,4):
                lm.LearnerTrainingPlanModule.objects.create(learner=p,position=1,curriculum_module_id='MOD-SIBLING' if i==3 else 'MOD-TEST')
        staff=lm.StaffUser.objects.create(username='Synthetic staff',email='staff@example.invalid',position='Admin',access='Super Admin')
        account=auth.LoginAccount.objects.create(subject_type='staff',subject_id=staff.pk,email='staff@example.invalid',role='admin')
        token,*_ = sessions.issue_session(account)
        self.client=Client()
        self.client.cookies[sessions.COOKIE_NAME]=token

    def url(self, mid='MOD-TEST'):
        return '/modules/'+mid+'/learners/'

    def test_learning_plan_get_patch_put_contract_and_explicit_empty(self):
        url = '/learning-plan/101/'
        initial = self.client.get(url)
        self.assertEqual(initial.status_code, 200, initial.content)
        self.assertTrue({
            'learner', 'plan', 'preset', 'available', 'programmes', 'saved',
            'inheritedCount', 'meetings', 'meetingsReason', 'totals',
        }.issubset(initial.json()))

        patched = self.client.patch(
            url,
            data=json.dumps({'modules': [{'moduleId': 'MOD-TEST'}]}),
            content_type='application/json',
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(
            [row['moduleId'] for row in patched.json()['plan']],
            ['MOD-TEST'],
        )

        emptied = self.client.put(
            url,
            data=json.dumps({'modules': []}),
            content_type='application/json',
        )
        self.assertEqual(emptied.status_code, 200, emptied.content)
        self.assertEqual(emptied.json()['plan'], [])
        stored = lm.EnrolmentUser.all_learners.get(pk=101)
        self.assertEqual(stored.learning_plan, [])

        reread = self.client.get(url)
        self.assertEqual(reread.status_code, 200, reread.content)
        self.assertEqual(reread.json()['plan'], [])
        self.assertTrue(reread.json()['saved'])

    def test_learning_plan_authorization_and_cross_learner_isolation(self):
        self.assertEqual(Client().get('/learning-plan/101/').status_code, 401)
        learner_account = auth.LoginAccount.objects.create(
            subject_type='learner',
            subject_id=101,
            email='synthetic1@example.invalid',
            role='learner',
        )
        learner_token, *_ = sessions.issue_session(learner_account)
        learner_client = Client()
        learner_client.cookies[sessions.COOKIE_NAME] = learner_token

        self.assertEqual(learner_client.get('/learning-plan/101/').status_code, 200)
        before = lm.EnrolmentUser.all_learners.get(pk=102).learning_plan
        self.assertEqual(learner_client.get('/learning-plan/102/').status_code, 404)
        denied = learner_client.patch(
            '/learning-plan/102/',
            data=json.dumps({'modules': [{'moduleId': 'MOD-TEST'}]}),
            content_type='application/json',
        )
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(
            lm.EnrolmentUser.all_learners.get(pk=102).learning_plan,
            before,
        )

    def test_hierarchy_preparation_reads_stored_dates_without_persisting(self):
        from curriculum_api.test_hierarchy_preparation_boundary_no_db import original_hierarchy_preparation
        from curriculum_api.catalogue.application import hierarchy_preparation
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET epa_months=3, apprenticeship_end_override='2028-02-20', excluded_holiday_ids='[]' WHERE cohort_id='C'")
            cursor.execute("SELECT epa_months, apprenticeship_end_override, excluded_holiday_ids FROM curriculum.cohorts WHERE cohort_id='C'")
            before = cursor.fetchone()
        payload = {'id': 'C', 'programmeId': 'P', 'startDate': '2026-09-01',
                   'endDate': '2027-08-31', 'epaMonths': 0}
        with original_hierarchy_preparation():
            expected = views.cohort_authoring_payload(payload)
            expected_group = views.group_authoring_payload({'id': 'G', 'cohortId': 'C', 'programmeId': 'P'})
        with patch.object(hierarchy_preparation, 'cohort_authoring_payload',
                          wraps=hierarchy_preparation.cohort_authoring_payload) as owner:
            actual = views.cohort_authoring_payload(payload)
        owner.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(actual['epa_months'], 0)
        self.assertEqual(actual['apprenticeship_end_date'], '2028-02-20')
        self.assertNotIn('apprenticeship_end_override', actual)
        self.assertEqual(views.group_authoring_payload({'id': 'G', 'cohortId': 'C', 'programmeId': 'P'}), expected_group)
        with connection.cursor() as cursor:
            cursor.execute("SELECT epa_months, apprenticeship_end_override, excluded_holiday_ids FROM curriculum.cohorts WHERE cohort_id='C'")
            self.assertEqual(cursor.fetchone(), before)

    def test_hierarchy_delete_plan_and_restore_candidates_real_sql_parity(self):
        from curriculum_api.test_hierarchy_preparation_boundary_no_db import original_hierarchy_preparation
        from curriculum_api.catalogue.infrastructure import lifecycle_reads
        cm.ModuleAuthoringWeek.objects.create(id='H-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='H-C', module_catalogue_id='MOD-TEST', week_id='H-W', type='reading', status='inactive')
        with original_hierarchy_preparation():
            expected = views.programme_permanent_delete_plan('P')
            old_candidates = views.soft_deleted_structure_ids({'weeks': ['H-W'], 'components': ['H-C']})
        with patch.object(lifecycle_reads, 'programme_dependency_counts',
                          wraps=lifecycle_reads.programme_dependency_counts) as read:
            actual = views.programme_permanent_delete_plan('P')
        read.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(set(actual['childIds']['moduleIds']), {'MOD-TEST', 'MOD-SIBLING', 'MOD-EMPTY'})
        self.assertEqual(actual['learners'], 4)
        self.assertEqual(actual['blockers']['learner_training_plan_modules'], 3)
        self.assertEqual(views.soft_deleted_structure_ids({'weeks': ['H-W'], 'components': ['H-C']}), old_candidates)
        self.assertEqual(old_candidates, {'H-C'})
        with self.assertRaises(views.ProgrammeContentRetained):
            views.refuse_if_programme_owns_content(actual)
        self.assertTrue(cm.ModuleAuthoringComponent.objects.filter(pk='H-C').exists())

    def test_attachment_component_aggregate_real_postgresql_parity(self):
        from curriculum_api.test_attachment_preparation_boundary_no_db import original_attachment_preparation
        from curriculum_api.catalogue.infrastructure import attachment_reads
        cm.ModuleAuthoringWeek.objects.create(id='ATT-W', module_catalogue_id='MOD-TEST', week_number=1)
        for identifier, kind, status, module in (
            ('ATT-A', 'reading', 'active', 'MOD-TEST'),
            ('ATT-B', 'quiz', 'active', 'MOD-TEST'),
            ('ATT-INACTIVE', 'reading', 'inactive', 'MOD-TEST'),
            ('ATT-RETIRED', sorted(views.RETIRED_COMPONENT_TYPES)[0], 'active', 'MOD-TEST'),
            ('ATT-LIBRARY', 'reading', 'active', ''),
        ):
            cm.ModuleAuthoringComponent.objects.create(id=identifier, week_id='ATT-W',
                module_catalogue_id=module, type=kind, status=status)
        with original_attachment_preparation():
            expected = views.authoring_component_counts_by_catalogue()
        with patch.object(attachment_reads, 'authoring_component_counts_by_catalogue',
                          wraps=attachment_reads.authoring_component_counts_by_catalogue) as read:
            actual = views.authoring_component_counts_by_catalogue()
        read.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(dict(actual), {'MOD-TEST': 2})

    def test_attachment_catalogue_selection_real_reads_and_existing_structure_parity(self):
        from curriculum_api.test_attachment_preparation_boundary_no_db import original_attachment_preparation
        from curriculum_api.catalogue.application import attachment_preparation
        cm.ModuleAuthoringModule.objects.filter(module_catalogue_id__in=['MOD-TEST', 'MOD-SIBLING']).update(title='Attachment')
        for module, amount in (('MOD-TEST', 2), ('MOD-SIBLING', 1)):
            week = 'ATT-' + module
            cm.ModuleAuthoringWeek.objects.create(id=week, module_catalogue_id=module, week_number=1)
            for index in range(amount):
                cm.ModuleAuthoringComponent.objects.create(id=week + str(index), week_id=week,
                    module_catalogue_id=module, type='reading', title='Synthetic content')
        item = {'title': 'Attachment', 'programmeId': 'P', 'cohortId': 'C', 'groupId': 'G'}
        group, cohort = {'id': 'G', 'programmeId': 'P', 'cohortId': 'C'}, {'id': 'C', 'programmeId': 'P'}
        # Attachment parity reads real catalogue rows; delivery enrichment is
        # outside this suite and must not require Teams tables or providers.
        with ExitStack() as stack:
            for name in ('apply_module_session_plan_to_weeks', 'apply_shared_teams_settings_to_weeks'):
                stack.enter_context(composition_fixture(views, name))
            for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session'):
                stack.enter_context(composition_fixture(views, name, return_value={}))
            with original_attachment_preparation():
                expected = views.find_existing_authoring_catalogue_id_for_payload(item)
                expected_attachment = views.contentful_catalogue_id_for_attachment(item, group, cohort, 'Attachment', 'MOD-SIBLING')
            with patch.object(attachment_preparation, 'find_existing_authoring_catalogue_id_for_payload',
                              wraps=attachment_preparation.find_existing_authoring_catalogue_id_for_payload) as select:
                actual = views.find_existing_authoring_catalogue_id_for_payload(item)
            select.assert_called_once()
            self.assertEqual((actual, expected), ('MOD-TEST', 'MOD-TEST'))
            self.assertEqual(views.contentful_catalogue_id_for_attachment(item, group, cohort, 'Attachment', 'MOD-SIBLING'), expected_attachment)
            self.assertEqual(expected_attachment, 'MOD-TEST')

    def test_progress_membership_plan_guards_counts_and_null_plan_rows(self):
        from curriculum_api import module_plan_rows
        from curriculum_api.test_progress_membership_boundary_no_db import original_progress_membership
        from curriculum_api.directory.infrastructure import assignment_reads
        lm.LearnerTrainingPlanModule.objects.create(learner_id=1, position=1, curriculum_module_id=None)
        source = lm.EnrolmentUser.all_learners.get(pk=102)
        with original_progress_membership():
            old_owner = module_plan_rows.profile_for(source)
            old_counts = assignments._plan_row_counts()
            expected = views.assigned_learners_for_scope('module', 'MOD-TEST', strict=True)
        owner = module_plan_rows.profile_for(source)
        self.assertEqual((owner.pk, owner.enrolment_id), (old_owner.pk, old_owner.enrolment_id))
        self.assertTrue(module_plan_rows.has_plan_rows(owner))
        self.assertTrue(module_plan_rows.has_module_row(owner, 'MOD-TEST'))
        self.assertFalse(module_plan_rows.has_module_row(None, 'MOD-TEST'))
        self.assertEqual(assignments._plan_row_counts(), old_counts)
        with patch.object(assignment_reads, 'module_roster_facts', wraps=assignment_reads.module_roster_facts) as reader:
            actual = views.assigned_learners_for_scope('module', 'MOD-TEST', strict=True)
        reader.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual({r['id'] for r in actual}, {1, 2, 4, 6})
        # Existing intentional distinction: any normalized row is explicit for
        # compact membership; the directory treats nonempty module refs as explicit.
        self.assertNotIn('101', counts.module_member_enrolment_ids('MOD-TEST'))

    def test_progress_membership_shared_count_and_batch_policy_real_sql(self):
        from curriculum_api.test_progress_membership_boundary_no_db import original_progress_membership
        from learner_api.learning_plans.domain import membership_policy
        ids = ['MOD-TEST', 'MOD-EMPTY', 'MOD-MISSING']
        with original_progress_membership():
            expected_counts = counts.status_counts('module', ids)
            expected_members = counts.module_member_enrolment_ids_by_module(ids)
        with patch.object(membership_policy, 'members_for_lineages', wraps=membership_policy.members_for_lineages) as policy:
            self.assertEqual(counts.status_counts('module', ids), expected_counts)
            self.assertEqual(counts.module_member_enrolment_ids_by_module(ids), expected_members)
        self.assertEqual(policy.call_count, 2)
        self.assertEqual(expected_counts['MOD-TEST']['total'], 4)
        self.assertEqual(expected_members['MOD-TEST'], {'101', '102', '104', '106'})
        self.assertIsNone(expected_counts['MOD-MISSING'])
        self.assertEqual(expected_members['MOD-MISSING'], set())

    def test_progress_membership_assignment_http_full_and_compact_owner_parity(self):
        from curriculum_api.test_progress_membership_boundary_no_db import original_progress_membership
        from curriculum_api.directory.application import assignment_queries
        for query, symbol in (({}, '_module_payload'), ({'assignedOnly': '1'}, '_module_assigned_payload')):
            with original_progress_membership(http=True):
                expected = self.client.get(self.url(), query)
            with patch.object(assignment_queries, symbol, wraps=getattr(assignment_queries, symbol)) as owner:
                actual = self.client.get(self.url(), query)
            self.assertEqual((actual.status_code, actual.json()), (expected.status_code, expected.json()))
            self.assertEqual(actual.status_code, 200)
            owner.assert_called_once()
            self.assertEqual(actual.json()['totals']['assignedCount'], 4)
            self.assertTrue(all(int(row['id']) >= 101 for row in actual.json()['learners']))

    def test_progress_membership_progress_http_real_source_bridge_and_journal(self):
        from curriculum_api.test_progress_membership_boundary_no_db import original_progress_membership
        from curriculum_api.directory.infrastructure import registration_reads
        from learner_api import journal_sources
        from datetime import datetime, timezone
        lm.LearnerProfile.objects.filter(pk=4).update(enrolment_id=None)
        seen = []
        def content(source, profile_id, module_ids, today):
            seen.append((source.pk, profile_id, module_ids, today, journal_sources.enabled()))
            self.assertTrue({'training_plan', 'learning_plan'} <= source.get_deferred_fields())
            self.assertEqual(source.__dict__['_educational_placement'].pk, int(profile_id))
            return {'available': {'total': 1}}
        with patch.object(learner_directory_details, 'learner_progress', side_effect=content), \
             patch.object(learner_directory_details, 'timezone', SimpleNamespace(
                 now=lambda: datetime(2028, 7, 1, 23, 30, tzinfo=timezone.utc))):
            for extra, state in (({}, True), ({'viewAsCoach': '1'}, False)):
                seen.clear()
                query = {'scope': 'module', 'id': 'MOD-TEST', 'learnerIds': '1,4', **extra}
                with original_progress_membership(http=True):
                    expected = self.client.get('/curriculum/learner-directory/progress/', query)
                with patch.object(registration_reads, 'progress_sources', wraps=registration_reads.progress_sources) as reader:
                    actual = self.client.get('/curriculum/learner-directory/progress/', query)
                self.assertEqual((actual.status_code, actual.json()), (expected.status_code, expected.json()))
                self.assertEqual(actual.status_code, 200)
                reader.assert_called_once()
                self.assertEqual(reader.call_args.args, ([101],))
                self.assertEqual(seen, [(101, '1', {'MOD-TEST'}, '2028-07-02', state)] * 2)
                self.assertIn('error', actual.json()['learners']['4'])
                self.assertFalse(journal_sources.enabled())

    def test_directory_programme_real_sql_projection_and_lifecycle_parity(self):
        from curriculum_api.test_directory_workspace_boundary_no_db import original_directory_workspace
        from curriculum_api.directory.infrastructure import assigned_reads
        with original_directory_workspace():
            expected = views.assigned_learners_for_programme('P', strict=True)
        with patch.object(assigned_reads, 'read_programme_profiles', wraps=assigned_reads.read_programme_profiles) as reader:
            actual = views.assigned_learners_for_programme('P', strict=True)
        self.assertEqual(actual, expected)
        reader.assert_called_once()
        self.assertEqual([r['id'] for r in actual], [1, 2, 3, 6])
        self.assertEqual([r['enrolmentId'] for r in actual], [101, 102, 103, 106])
        for status in ('active', 'inactive', 'missing'):
            with original_directory_workspace():
                expected = views.assigned_learners_for_programme('P', status, strict=True)
            self.assertEqual(views.assigned_learners_for_programme('P', status, strict=True), expected)

    def test_directory_scope_actual_orm_membership_manual_and_missing_bridge(self):
        from curriculum_api.test_directory_workspace_boundary_no_db import original_directory_workspace
        # Synthetic only: a direct member with no registration remains a profile member.
        lm.LearnerProfile.objects.filter(pk=4).update(enrolment_id=None)
        for scope, identifier in (('programme', 'P'), ('cohort', 'C'), ('group', 'G'),
                                  ('module', 'MOD-TEST'), ('module', 'MOD-EMPTY')):
            with self.subTest(scope=scope, identifier=identifier):
                with original_directory_workspace():
                    expected = views.assigned_learners_for_scope(scope, identifier, strict=True)
                actual = views.assigned_learners_for_scope(scope, identifier, strict=True)
                self.assertEqual(actual, expected)
                if identifier == 'MOD-TEST':
                    self.assertEqual({r['id'] for r in actual}, {1, 2, 4, 6})
                    self.assertIsNone(next(r for r in actual if r['id'] == 4)['enrolmentId'])
                elif identifier == 'MOD-EMPTY':
                    self.assertEqual(actual, [])

    def test_directory_http_real_auth_pagination_status_and_missing_target(self):
        from curriculum_api.test_directory_workspace_boundary_no_db import original_directory_workspace
        url = '/curriculum/learner-directory/learners/'
        for query, code in (({'scope': 'module', 'id': 'MOD-TEST'}, 200),
                            ({'scope': 'module', 'id': 'MOD-TEST', 'status': 'all', 'q': '6'}, 200),
                            ({'scope': 'module', 'id': 'MOD-EMPTY'}, 200),
                            ({'scope': 'module', 'id': 'MOD-MISSING'}, 404),
                            ({'scope': 'module', 'id': 'MOD-TEST', 'page': '0'}, 400)):
            with original_directory_workspace(http=True):
                expected = self.client.get(url, query)
            actual = self.client.get(url, query)
            self.assertEqual((actual.status_code, actual.json()), (expected.status_code, expected.json()))
            self.assertEqual(actual.status_code, code)
            self.assertIn('no-store', actual['Cache-Control'])
        result = self.client.get(url, {'scope': 'module', 'id': 'MOD-TEST'}).json()
        self.assertEqual([r['id'] for r in result['learners']], ['1', '2', '4'])
        self.assertEqual([r['enrolmentId'] for r in result['learners']], [101, 102, 104])
        self.assertEqual(self.client.post(url).status_code, 405)
        self.assertEqual(Client().get(url, {'scope': 'module', 'id': 'MOD-TEST'}).status_code, 401)

    def test_workspace_real_module_sql_payload_parity_with_session_port_stubbed(self):
        from curriculum_api.test_directory_workspace_boundary_no_db import original_directory_workspace
        from curriculum_api.catalogue.infrastructure import workspace_reads
        self.seed_reporting()
        # This verifies the changed catalogue reader; it never invokes meeting readers.
        with composition_fixture(views, 'tutor_profile_for_identity', return_value=({'id': 'T', 'name': 'Synthetic tutor'}, 'email')), \
             composition_fixture(views, 'staff_profile_assignment_ids', return_value=['MOD-TEST', 'MOD-EMPTY']), \
             composition_fixture(views, 'tutor_workspace_next_session_by_module', return_value={}):
            with original_directory_workspace(http=True):
                expected = self.client.get('/curriculum/tutor-workspace/', {'email': 't@example.invalid'})
            with patch.object(workspace_reads, 'tutor_workspace_module_rows', wraps=workspace_reads.tutor_workspace_module_rows) as reader:
                actual = self.client.get('/curriculum/tutor-workspace/', {'email': 't@example.invalid'})
            self.assertEqual((actual.status_code, actual.json()), (expected.status_code, expected.json()))
            self.assertEqual(actual.status_code, 200)
            reader.assert_called_once()
            modules = actual.json()['modules']
            self.assertEqual([row['moduleCatalogueId'] for row in modules], ['MOD-EMPTY', 'MOD-TEST'])
            # PostgreSQL numeric is serialized by the existing JSON encoder as a string.
            self.assertEqual(next(row for row in modules if row['moduleCatalogueId'] == 'MOD-TEST')['totalOtjh'], '6.00')
            self.assertIsNone(actual.json()['nextSession'])

    def seed_reporting(self):
        cm.ModuleAuthoringWeek.objects.create(id='W-R', module_catalogue_id='MOD-TEST', title='Live week')
        for cid in ('C-R1','C-R2'):
            cm.ModuleAuthoringComponent.objects.create(id=cid, module_catalogue_id='MOD-TEST',
                                                       week_id='W-R', title='Live '+cid, expected_otjh=3)
        with connection.cursor() as cursor:
            for pid, kind, cid, passed, mid in (
                (1,'component','C-R1',None,'MOD-TEST'),
                (2,'quiz','C-R2',False,'MOD-TEST'),
                (3,'quiz','C-OUT',True,'MOD-SIBLING'),
                (4,'component',None,None,None),
                (5,'component','C-GONE',None,'MOD-TEST'),
                (6,'component','C-R1',None,'MOD-TEST')):
                cursor.execute('''INSERT INTO "Learner".learner_progress_entries
                    (id,learner_id,kind,component_ref,component_title,component_type,submitted_at,
                     reported_time,feedback,passed,programme_ref,module_ref,module_title,week_title,expected_otjh)
                    VALUES (%s,1,%s,%s,'Stamped activity','reading','2028-01-02','2 hours','Synthetic reflection',%s,'P',%s,'Stamped module','Stamped week',3)''',
                    [pid,kind,cid,passed,mid])
            cursor.execute('''INSERT INTO "Learner".learner_progress_ksbs VALUES
                (1,1,'K1',100,'hard'),(2,1,'K1',40,'hard'),(3,1,'K1',20,'hard'),
                (5,1,'K1',25,'soft'),(6,1,'K1',20,''),(6,2,'K1',50,'hard'),
                (6,3,'B1',80,'hard'),(6,4,'S2',70,'soft')''')
            cursor.execute('''INSERT INTO "Learner".learner_progress_ksb_exclusions VALUES (6,3,'B1','excluded')''')
            cursor.execute('''INSERT INTO "Learner".learning_reflection_submissions (id,progress_entry_id,ksb_weights,learner_id,component_ref,activity_id,activity_title,planned_otjh,actual_time_hours,status,submitted_at) VALUES
                ('R1',6,'{"K1":50}','101','C-R1','C-R1','Synthetic reflection','4','2.5','submitted','2028-01-03'),
                ('R2',2,'{"K1":40}','101','C-R2','C-R2','Failed activity','3','2','submitted','2028-01-02'),
                ('R3',NULL,'{"K1":20}','101','C-R1','C-R1','Unlinked','3','1','submitted','2028-01-01')''')

    def test_read_runtime_schema_metadata_postgresql_parity(self):
        from curriculum_api.test_read_runtime_boundary_no_db import original_read_runtime
        from curriculum_api.catalogue.infrastructure import schema_reads
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            def read():
                return (views.learner_schema_table_exists('learners'),
                        views.learner_schema_table_exists('synthetic_missing'),
                        views.learner_relation_exists('learners'),
                        views.learner_schema_columns('learners'))
            views.reset_learner_schema_cache()
            with original_read_runtime():
                expected = read()
            views.reset_learner_schema_cache()
            with patch.object(schema_reads, 'learner_schema_columns', wraps=schema_reads.learner_schema_columns) as owner:
                actual = read()
            owner.assert_called_once()
            self.assertEqual(actual, expected)
            self.assertEqual(actual[:3], (True, False, True))
            self.assertTrue({'id', 'enrolment_id', 'programme_id', 'cohort_id', 'group_id'} <= actual[3])

    def test_archive_component_count_postgresql_parity(self):
        from curriculum_api.test_read_runtime_boundary_no_db import original_read_runtime
        from curriculum_api.catalogue.infrastructure import archive_reads
        for identifier, module_id in (('ARCH-C1', 'MOD-TEST'), ('ARCH-C2', 'MOD-TEST'), ('OTHER-C', 'MOD-SIBLING')):
            cm.ModuleAuthoringComponent.objects.create(id=identifier, module_catalogue_id=module_id, type='reading')
        with transaction.atomic(), composition_fixture(views, 'ensure_module_authoring_tables'):
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            ids = [' MOD-TEST ', 'MOD-TEST', '', 'MOD-EMPTY']
            with original_read_runtime():
                expected = dict(views.archived_module_component_counts(ids))
            with patch.object(archive_reads, 'archived_module_component_counts', wraps=archive_reads.archived_module_component_counts) as owner:
                actual = dict(views.archived_module_component_counts(ids))
            owner.assert_called_once()
            self.assertEqual(actual, expected)
            self.assertEqual(actual, {'MOD-TEST': 2})
            self.assertEqual(dict(views.archived_module_component_counts([])), {})

    def test_scope_lineage_sql_and_archive_http_guards_parity(self):
        from curriculum_api.test_read_runtime_boundary_no_db import original_read_runtime
        from curriculum_api.catalogue.application import placement_lineage
        from django.test import RequestFactory
        cm.ModuleAuthoringWeek.objects.create(id='LINEAGE-W', module_catalogue_id='MOD-TEST', title='Week')
        cm.ModuleAuthoringComponent.objects.create(id='LINEAGE-C', module_catalogue_id='MOD-TEST', week_id='LINEAGE-W', type='reading', title='Component')
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            for scope, identifier in (('programme', 'P'), ('cohort', 'C'), ('group', 'G'), ('module', 'MOD-TEST'), ('week', 'LINEAGE-W'), ('component', 'LINEAGE-C')):
                with original_read_runtime():
                    expected = views.scope_placement_lineage(scope, identifier)
                with patch.object(placement_lineage, 'scope_placement_lineage', wraps=placement_lineage.scope_placement_lineage) as owner:
                    actual = views.scope_placement_lineage(scope, identifier)
                owner.assert_called_once()
                self.assertEqual(actual, expected)
                self.assertTrue(actual['found'], actual)
                self.assertEqual(actual['programmeId'], 'P')
        for identifier, status in (('MOD-TEST', 409), ('MOD-MISSING', 404)):
            url = '/curriculum/archive/modules/' + identifier + '/structure/'
            with original_read_runtime():
                old = views.curriculum_archived_module_structure(RequestFactory().get(url), identifier)
            actual = self.client.get(url)
            self.assertEqual(actual.status_code, status, actual.content)
            self.assertEqual(actual.json(), json.loads(old.content))
            self.assertEqual(self.client.post(url, {}, content_type='application/json').status_code, 405)

    def test_module_structure_get_real_sql_http_and_legacy_alias_parity(self):
        from django.test import RequestFactory
        from curriculum_api.test_module_get_boundary_no_db import original_module_gets
        from curriculum_api.catalogue.application import structure_payloads
        cm.ModuleAuthoringWeek.objects.create(id='GET-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='GET-C', module_catalogue_id='MOD-TEST', week_id='GET-W',
            type='reading', title='Synthetic content', settings_json={'readingContent': 'Synthetic body'})
        with ExitStack() as stack:
            # Existing calendar/provider ports are opaque; Teams tests are excluded.
            for name in ('apply_module_session_plan_to_weeks', 'apply_shared_teams_settings_to_weeks'):
                stack.enter_context(composition_fixture(views, name))
            for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session'):
                stack.enter_context(composition_fixture(views, name, return_value={}))
            for name in ('link_training_row_to_catalogue', 'save_module_authoring_structure'):
                stack.enter_context(composition_fixture(views, name, side_effect=AssertionError('ordinary GET invoked writer')))
            for identifier in ('MOD-TEST', 'catalogue-module-MOD-TEST'):
                url = '/curriculum/modules/' + identifier + '/structure/'
                with original_module_gets():
                    old = views.curriculum_module_structure(RequestFactory().get(url, {'skipCache': '1'}), identifier)
                with patch.object(structure_payloads, 'load_stored_module_structure', wraps=structure_payloads.load_stored_module_structure) as query:
                    actual = self.client.get(url, {'skipCache': '1'})
                query.assert_called_once()
                self.assertEqual(actual.status_code, 200, actual.content)
                self.assertEqual(actual.json(), json.loads(old.content))
                self.assertEqual(actual.json()['structureRevision'], views.module_structure_revision('MOD-TEST'))
                self.assertEqual(set(actual.json()['itemFingerprints']['components']), {'GET-C'})

    def test_module_structure_get_force_refresh_reads_changed_synthetic_content(self):
        cm.ModuleAuthoringWeek.objects.create(id='GET-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='GET-C', module_catalogue_id='MOD-TEST', week_id='GET-W',
            type='reading', title='Before', settings_json={'readingContent': 'Synthetic body'})
        with ExitStack() as stack:
            for name in ('apply_module_session_plan_to_weeks', 'apply_shared_teams_settings_to_weeks'):
                stack.enter_context(composition_fixture(views, name))
            for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session'):
                stack.enter_context(composition_fixture(views, name, return_value={}))
            url = '/curriculum/modules/MOD-TEST/structure/'
            before = self.client.get(url)
            self.assertEqual(before.status_code, 200, before.content)
            cm.ModuleAuthoringComponent.objects.filter(id='GET-C').update(title='After')
            after = self.client.get(url, HTTP_CACHE_CONTROL='no-cache')
            self.assertEqual(after.status_code, 200, after.content)
            self.assertNotEqual(before.json()['structureRevision'], after.json()['structureRevision'])
            self.assertEqual(after.json()['structureRevision'], views.module_structure_revision('MOD-TEST'))
            self.assertNotEqual(before.json()['itemFingerprints']['components'], after.json()['itemFingerprints']['components'])

    def test_ksb_programme_source_identity_real_postgresql(self):
        from curriculum_api.test_ksb_identity_boundary_no_db import old_owner
        from curriculum_api.reporting.application import source_catalogue
        # Name sorting deliberately puts the misleading name before the real ID.
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO curriculum.programmes (programme_id, name, ksb_profile_source_id) VALUES (%s,%s,%s),(%s,%s,%s)',
                           ['PROG-WRONG', 'PROG-TARGET', 'standard:wrong',
                            'PROG-TARGET', 'ZZ Synthetic target', 'standard:correct'])
        self.assertEqual(old_owner('programme_row_ksb_source')('PROG-TARGET'), ('standard', 'wrong'))
        with patch.object(source_catalogue, 'programme_row_ksb_source', wraps=source_catalogue.programme_row_ksb_source) as owner:
            self.assertEqual(views.programme_row_ksb_source('PROG-TARGET'), ('standard', 'correct'))
            self.assertEqual(views.programme_row_ksb_source('ZZ Synthetic target'), ('standard', 'correct'))
            self.assertEqual(views.infer_source_from_scope([{'programme_id': 'PROG-TARGET', 'source_type': 'standard', 'source_id': 'stale'}]),
                             ('standard', 'correct', 'programme'))
            self.assertEqual(owner.call_count, 3)
        lm.PlacementProgramme.objects.filter(programme_id='PROG-TARGET').delete()
        self.assertEqual(views.programme_row_ksb_source('PROG-TARGET'), ('', ''))
        self.assertEqual(views.programme_row_ksb_source('PROG-WRONG'), ('standard', 'wrong'))

    def test_ksb_standard_reference_real_sql_and_http_parity(self):
        from curriculum_api.test_ksb_identity_boundary_no_db import original_views
        from curriculum_api.catalogue.api import ksb_sources
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO curriculum.standard_ksbs (standard_ref, standard_version, standard_title, ksb_type, ksb_code, ksb_description) VALUES (%s,%s,%s,%s,%s,%s)',
                           ['STTEST', '1', 'Synthetic standard', 'Knowledge', 'K1', 'Synthetic definition'])
        views._SKILLS_ENGLAND_ROWS = ('', [])
        with original_views():
            old = self.client.get('/curriculum/standards/')
            old_detail = self.client.get('/curriculum/standards/sttest-v1/')
        cache.clear()
        with patch.object(ksb_sources, 'curriculum_standards', wraps=ksb_sources.curriculum_standards) as owner:
            actual = self.client.get('/curriculum/standards/')
        owner.assert_called_once()
        self.assertEqual(actual.status_code, 200)
        self.assertEqual(actual.json(), old.json())
        self.assertEqual(actual.json()['count'], 1)
        self.assertEqual(actual.json()['results'][0]['ksbs'][0]['code'], 'K1')
        self.assertEqual(actual['ETag'], old['ETag'])
        self.assertEqual(self.client.get('/curriculum/standards/sttest-v1/').json(), old_detail.json())
        self.assertEqual(self.client.get('/curriculum/standards/missing/').status_code, 404)
        conditional = self.client.get('/curriculum/standards/', HTTP_IF_NONE_MATCH=actual['ETag'])
        self.assertEqual((conditional.status_code, conditional.content), (304, b''))

    def test_programme_source_convergence_real_postgresql_parity(self):
        from curriculum_api.test_programme_sources_no_db import original
        from curriculum_api.catalogue.application import programme_modules
        from curriculum_api import programme_workspace_reads
        programme = {'id': 'P', 'sourceId': 'P', 'name': 'Synthetic programme'}
        cm.ModuleAuthoringWeek.objects.create(id='W-SOURCE', module_catalogue_id='MOD-TEST', title='Week')
        cm.ModuleAuthoringComponent.objects.create(id='C-SOURCE', module_catalogue_id='MOD-TEST', week_id='W-SOURCE', title='Read', type='reading')
        # No invented delivery values: compare actual current normalized payloads.
        with ExitStack() as stack:
            for name in ('apply_shared_teams_settings_to_weeks',):
                stack.enter_context(composition_fixture(views, name))
            for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session'):
                stack.enter_context(composition_fixture(views, name, return_value={}))
            # Unchanged live-session/completion extras are supplied as empty fixture
            # facts; core programme/module/week/component/KSB reads execute on PG.
            original_hydrate = views.get_authoring_structure_payloads
            def catalogue_hydrate(ids, **kwargs):
                return original_hydrate(ids, **{**kwargs, 'include_extra': False})
            stack.enter_context(composition_fixture(views, 'get_authoring_structure_payloads', side_effect=catalogue_hydrate))
            stack.enter_context(transaction.atomic())
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            old = original('programme_authoring_modules')(programme, None)
            with patch.object(programme_modules, 'programme_module_candidates', wraps=programme_modules.programme_module_candidates) as query, \
                 composition_fixture(views, 'get_authoring_structure_payloads', wraps=views.get_authoring_structure_payloads) as hydration:
                current = views.programme_module_candidates([], programme, None)
            self.assertEqual(current, old)
            self.assertGreater(len(current), 0)
            query.assert_called_once()
            hydration.assert_called_once()
            # The lean response must equal projection of the full response.
            lean = views.programme_workspace_module_candidates([], programme, {'modules': [{'title': 'Ghost'}]})
            def projection(modules):
                return views.programme_modules_workspace_payload({'flat': {'modules': views.module_rows_with_week_outline(modules)}})
            self.assertEqual(projection(lean), projection(current))

    def test_programme_source_does_not_include_same_name_foreign_postgresql_module(self):
        from curriculum_api.catalogue.application.programme_modules import ProgrammeModulesUnavailable
        programme = {'id': 'P', 'sourceId': 'P', 'name': 'Synthetic programme'}
        original_hydrate = views.get_authoring_structure_payloads
        def catalogue_hydrate(ids, **kwargs):
            return original_hydrate(ids, **{**kwargs, 'include_extra': False})
        hydration = composition_fixture(views, 'get_authoring_structure_payloads', side_effect=catalogue_hydrate)
        hydration.start()
        self.addCleanup(hydration.stop)
        rows = views.module_index_rows(ensure_tables=False)
        target = next(row for row in rows if row['module_catalogue_id'] == 'MOD-TEST')
        # Simulate an index cached before a real reassignment in this disposable DB.
        cm.ModuleAuthoringModule.objects.filter(module_catalogue_id='MOD-TEST').update(programme_id='P2')
        with self.assertRaises(ProgrammeModulesUnavailable):
            views.programme_module_candidates([], programme, None, module_rows=[target], known_programme_ids={'P', 'P2'})
        current = views.programme_module_candidates([], programme, None, known_programme_ids={'P', 'P2'})
        self.assertNotIn('MOD-TEST', [module['catalogueId'] for module in current])

    def test_programme_source_http_full_section_and_workspace_use_actual_query(self):
        from curriculum_api.catalogue.application import programme_modules
        programme = {'id': 'P', 'sourceId': 'P', 'name': 'Synthetic programme'}
        rows = views.module_index_rows(ensure_tables=False)
        original_hydrate = views.get_authoring_structure_payloads
        def catalogue_hydrate(ids, **kwargs):
            return original_hydrate(ids, **{**kwargs, 'include_extra': False})
        with ExitStack() as stack:
            fixture_values = dict(
                get_cached_curriculum_rows=lambda **kw: {'training': [], 'ksb_profiles': [], 'modules': [], 'program_configs': [], 'authoring_modules': rows},
                build_programmes=lambda *a, **kw: [programme],
                build_cohorts_and_groups=lambda *a, **kw: ([], []),
                build_modules=lambda *a, **kw: [],
                read_programme_sessions=lambda *a: [],
                get_authoring_structure_payloads=catalogue_hydrate,
            )
            for name, value in fixture_values.items():
                stack.enter_context(composition_fixture(views, name, value))
            query = stack.enter_context(patch.object(programme_modules, 'programme_module_candidates', wraps=programme_modules.programme_module_candidates))
            full = self.client.get('/curriculum/programmes/P/detail/modules/?visibility=all&noCache=1')
            lean = self.client.get('/curriculum/programmes/P/detail/modules/?visibility=all&view=workspace&noCache=1')
        self.assertEqual(full.status_code, 200, full.content)
        self.assertEqual(lean.status_code, 200, lean.content)
        self.assertEqual(lean.json(), views.programme_modules_workspace_payload(full.json()))
        self.assertEqual({module['catalogueId'] for module in full.json()['flat']['modules']}, {'MOD-TEST', 'MOD-SIBLING', 'MOD-EMPTY'})
        self.assertEqual(query.call_count, 2)
        self.assertFalse(query.call_args_list[0].kwargs['workspace_view'])
        self.assertTrue(query.call_args_list[1].kwargs['workspace_view'])

    def test_workspace_resolution_real_postgresql_and_http_parity(self):
        from types import ModuleType
        from django.test import override_settings
        from curriculum_api.test_module_workspace_boundary_no_db import original_workspace
        from curriculum_api.catalogue.application import structure_resolution
        from curriculum_api.catalogue.infrastructure import resolution_candidates
        cm.ModuleAuthoringWeek.objects.create(id='W-WS', module_catalogue_id='MOD-TEST', title='Week')
        cm.ModuleAuthoringComponent.objects.create(id='C-WS', module_catalogue_id='MOD-TEST', week_id='W-WS', title='Read', type='reading')
        cm.ModuleAuthoringModule.objects.filter(module_catalogue_id='MOD-SIBLING').update(title='Shared')
        cm.ModuleAuthoringModule.objects.filter(module_catalogue_id='MOD-EMPTY').update(title='Shared')
        body = {'modules': ['MOD-TEST', 'Shared', 'MOD-MISSING']}
        with original_workspace():
            urls = ModuleType('synthetic_workspace_urls')
            urls.urlpatterns = [path('workspace/resolve/', views.curriculum_module_structure_resolve)]
            with override_settings(ROOT_URLCONF=urls):
                previous = self.client.post('/workspace/resolve/', body, content_type='application/json')
        views.cache_state._CURRICULUM_CACHE.clear()
        with patch.object(structure_resolution, 'resolve_module_structures', wraps=structure_resolution.resolve_module_structures) as app, \
             patch.object(resolution_candidates, 'read_resolution_candidates', wraps=resolution_candidates.read_resolution_candidates) as reader:
            urls = ModuleType('synthetic_workspace_urls')
            urls.urlpatterns = [path('workspace/resolve/', views.curriculum_module_structure_resolve)]
            with override_settings(ROOT_URLCONF=urls):
                current = self.client.post('/workspace/resolve/', body, content_type='application/json')
        self.assertEqual(current.status_code, 200, current.content)
        self.assertEqual(current.json(), previous.json())
        app.assert_called_once()
        reader.assert_called_once()
        result = current.json()['results']
        self.assertEqual(result[0]['componentCount'], 1)
        self.assertTrue(result[1]['ambiguous'])
        self.assertTrue(result[2]['missing'])

    def test_workspace_scope_sql_and_hydration_postgresql_parity(self):
        from curriculum_api.test_module_workspace_boundary_no_db import original_workspace
        from curriculum_api.catalogue.application import scope_queries
        from curriculum_api.catalogue.infrastructure import scope_reads
        cm.ModuleAuthoringWeek.objects.create(id='W-WS', module_catalogue_id='MOD-TEST', title='Week')
        cm.ModuleAuthoringComponent.objects.create(id='C-WS', module_catalogue_id='MOD-TEST', week_id='W-WS', title='Read', type='reading')
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            with original_workspace():
                old_ids = views.week_scope_module_ids('W-WS')
                previous = [views.authoring_scope_data(scope, ident) for scope, ident in [('module','MOD-TEST'), ('week','W-WS'), ('component','C-WS')]]
            with patch.object(scope_reads, 'week_scope_module_ids', wraps=scope_reads.week_scope_module_ids) as owner:
                self.assertEqual(views.week_scope_module_ids('W-WS'), old_ids)
            owner.assert_called_once()
            with patch.object(scope_queries, 'authoring_scope_data', wraps=scope_queries.authoring_scope_data) as app, \
                 patch.object(scope_reads, 'read_scope_children', wraps=scope_reads.read_scope_children) as child:
                current = [views.authoring_scope_data(scope, ident) for scope, ident in [('module','MOD-TEST'), ('week','W-WS'), ('component','C-WS')]]
            self.assertEqual(current, previous)
            self.assertEqual(app.call_count, 3)
            self.assertEqual(child.call_count, 3)
            self.assertEqual([r['module_catalogue_id'] for r in current[0][0]], ['MOD-TEST'])
            self.assertEqual([r['id'] for r in current[0][2]], ['C-WS'])

    def test_reporting_progress_sql_and_scope_parity_postgresql(self):
        from django.db import transaction
        from curriculum_api.test_reporting_boundary_no_db import original_reporting
        from curriculum_api.reporting.infrastructure import progress
        self.seed_reporting()
        predicate = views.progress_scope_predicate({'C-R1','C-R2'}, 'module_ref', 'MOD-TEST')
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            for codes in (None,['K1']):
                for achieved in (False,True):
                    with self.subTest(codes=codes, achieved=achieved):
                        with original_reporting():
                            expected = views.progress_consumption_rows([1], codes, predicate, achieved)
                        with patch.object(progress, 'progress_consumption_rows', wraps=progress.progress_consumption_rows) as owner:
                            actual = views.progress_consumption_rows([1], codes, predicate, achieved)
                        owner.assert_called_once()
                        self.assertEqual(actual, expected)
                        self.assertTrue(actual)
                        self.assertNotIn('B1', [r['ksb_code'] for r in actual])
                        if achieved:
                            self.assertTrue(all(r['feedback'] == '' for r in actual))
            with original_reporting():
                expected = views.out_of_scope_progress_count([1], *predicate)
            self.assertEqual(views.out_of_scope_progress_count([1], *predicate), expected)
            self.assertEqual(expected, 2)
            with original_reporting():
                old = views.learner_progress_ksb_consumption([1], ['K1','S2','B1'], ['C-R1','C-R2'],
                    include_unattributed=False, restrict_to_components=True, scope='module', scope_identifier='MOD-TEST')
            new = views.learner_progress_ksb_consumption([1], ['K1','S2','B1'], ['C-R1','C-R2'],
                include_unattributed=False, restrict_to_components=True, scope='module', scope_identifier='MOD-TEST')
            self.assertEqual(new, old)
            self.assertEqual(new[0], {1:{'K1':75.0,'S2':70.0}})
            self.assertTrue(any(r.get('exclusionReason') == 'repeat_completion' for r in new[2]))
            self.assertTrue(any(r['scopeBasis'] == 'lineage' for r in new[1]))

    def test_reporting_reflection_identity_and_sql_parity_postgresql(self):
        from django.db import transaction
        from curriculum_api.test_reporting_boundary_no_db import original_reporting
        from curriculum_api.reporting.infrastructure import reflections
        self.seed_reporting()
        learners = [{'id':1,'sourceId':1,'sourceKind':'learner'}]
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            with original_reporting():
                expected = views.reflection_submission_ksb_consumption(learners,['K1'],['C-R1','C-R2'],True,False)
            with patch.object(reflections, 'reflection_rows', wraps=reflections.reflection_rows) as owner:
                actual = views.reflection_submission_ksb_consumption(learners,['K1'],['C-R1','C-R2'],True,False)
            owner.assert_called_once()
            self.assertEqual(actual, expected)
            declared, rows, excluded, unlinked = actual
            self.assertEqual(declared, {1:{'K1':50.0}})
            self.assertEqual((len(rows),len(excluded),len(unlinked)), (1,1,1))
            self.assertEqual(rows[0]['learnerId'],1)
            self.assertEqual(rows[0]['submissionLearnerId'],'101')
            self.assertFalse(rows[0]['countsTowardAchievement'])
            self.assertEqual(rows[0]['actualOtjh'],2.5)
            self.assertIsNone(unlinked[0]['learnerId'])

    def test_reporting_end_to_end_projection_parity_postgresql(self):
        from copy import deepcopy
        from django.db import transaction
        from curriculum_api.test_reporting_boundary_no_db import original_reporting
        self.seed_reporting()
        def read():
            learners = [{'id':1,'group':'G','sourceId':1,'sourceKind':'learner'}, {'id':2,'group':'G'}]
            coverage = [{'code':'K1','raw_total_weight':100,'mappings':[{'module_id':'MOD-TEST','group_name':'G','weight':100}]}]
            components = [{'id':'C-R1','module_catalogue_id':'MOD-TEST','expected_otjh':3},
                          {'id':'C-R2','module_catalogue_id':'MOD-TEST','expected_otjh':3}]
            modules = [{'module_catalogue_id':'MOD-TEST','group_name':'G'}]
            plan = views.scope_authored_plan(modules,components,coverage)
            learner_plans = views.learner_plans_for_scope(plan,learners)
            totals, rows, excluded = views.learner_progress_ksb_consumption([1,2],['K1'],['C-R1','C-R2'],
                include_unattributed=False,restrict_to_components=True,scope='module',scope_identifier='MOD-TEST')
            declared, refs, excluded_refs, unlinked = views.reflection_submission_ksb_consumption(learners,['K1'],['C-R1','C-R2'],True,False)
            activities = views.learner_activity_trace(rows,excluded,refs,excluded_refs,{})
            expected_weights = {key: value.get('ksbWeights', {}) for key, value in learner_plans.items()}
            consumption_rows = views.learner_consumption_payload(learners,coverage,totals,declared,expected_weights)
            views.apply_reflection_otjh_to_learners(learners,refs)
            return deepcopy(dict(learners=learners,plan=plan,learnerPlans=learner_plans,
                consumption=consumption_rows,activities=activities,unlinked=unlinked,
                activityPlan=views.learner_activity_plan(learners,components,modules,[],activities,plan,learner_plans),
                otjh=views.scope_otjh_summary(plan,learner_plans,learners,activities),
                achievement=views.scope_ksb_achievement(coverage,consumption_rows,learners,plan,learner_plans)))
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            with original_reporting():
                expected = read()
            self.assertEqual(read(),expected)

    def seed_report_delivery(self):
        self.seed_reporting()
        with connection.cursor() as cursor:
            cursor.execute('''UPDATE "Learner".learning_reflection_submissions
                SET ksb_codes=%s::jsonb, status='accepted' WHERE id=%s''',
                [json.dumps(['k1',{'code':'S2'},'K1','OTHER']),'R1'])
            cursor.execute('''UPDATE "Learner".learning_reflection_submissions SET ksb_codes=%s::jsonb WHERE id=%s''',
                [json.dumps(['B1']),'R2'])
            cursor.execute('''INSERT INTO "Learner".evidence_files VALUES
                ('E1',6,'101','synthetic-one.pdf','accepted','clean','S','C-R1','2028-01-01','application/pdf',10),
                ('E2',6,'101','synthetic-two.pdf','submitted','pending','S','C-R1','2028-01-02','application/pdf',20),
                ('E3',2,'101','synthetic-failed.pdf','submitted','clean','S','C-R2','2028-01-03','application/pdf',30),
                ('OTHER',9999,'888','unrelated.pdf','submitted','clean','S','OTHER','2028-01-04','application/pdf',40)''')

    def test_report_delivery_supplementary_read_parity_postgresql(self):
        from curriculum_api.test_report_delivery_boundary_no_db import original_delivery
        from curriculum_api.reporting.infrastructure import supplementary
        self.seed_report_delivery()
        with transaction.atomic():
            with connection.cursor() as cursor:cursor.execute('SET TRANSACTION READ ONLY')
            for compact in (False,True):
                with original_delivery():expected=views.learner_progress_ksb_totals([1],['K1','S2','B1'],compact=compact)
                self.assertEqual(views.learner_progress_ksb_totals([1],['K1','S2','B1'],compact=compact),expected)
                self.assertEqual(expected,{1:{'K1':95.0,'S2':70.0}})
            with original_delivery():expected=views.learner_declared_ksb_codes([1],['K1','S2','B1'])
            self.assertEqual(views.learner_declared_ksb_codes([1],['K1','S2','B1']),expected)
            self.assertEqual(expected,{1:{'K1','S2'}})
            with original_delivery():expected=views.progress_evidence_index([6,'6',None,2,8888])
            with patch.object(supplementary,'evidence_rows',wraps=supplementary.evidence_rows) as owner:
                actual=views.progress_evidence_index([6,'6',None,2,8888])
            owner.assert_called_once()
            self.assertEqual(actual,expected)
            self.assertEqual(set(actual),{'2','6'})
            self.assertEqual([r['evidenceId'] for r in actual['6']],['E1','E2'])
            self.assertNotIn('learnerId',actual['6'][0])

    def test_report_delivery_fingerprint_sql_parity_postgresql(self):
        from curriculum_api.test_report_delivery_boundary_no_db import original_delivery
        from curriculum_api.reporting.infrastructure import achievement_cache
        self.seed_report_delivery()
        with patch.dict(views._ACHIEVEMENT_LEARNER_IDS,{'synthetic-key':{'1'}}), \
             composition_fixture(views,'component_source_inputs_fingerprint',return_value=('synthetic-source',)), \
             patch.object(views.time,'time',return_value=1800000000), transaction.atomic():
            with connection.cursor() as cursor:cursor.execute('SET TRANSACTION READ ONLY')
            with original_delivery():expected=views.achievement_inputs_fingerprint('P','synthetic-key')
            with patch.object(achievement_cache,'achievement_inputs_fingerprint',wraps=achievement_cache.achievement_inputs_fingerprint) as owner:
                actual=views.achievement_inputs_fingerprint('P','synthetic-key')
            owner.assert_called_once()
            self.assertEqual(actual,expected)
            self.assertNotEqual(actual[0],'unavailable')
            self.assertEqual(len(actual[0]),4)

    def test_report_delivery_real_http_results_and_get_contract_match(self):
        from curriculum_api.test_report_delivery_boundary_no_db import original_delivery
        self.seed_report_delivery()
        modules=[{'module_catalogue_id':'MOD-TEST','group_name':'G'}]
        components=[{'id':'C-R1','module_catalogue_id':'MOD-TEST','expected_otjh':3}]
        required=[{'code':'K1','source_type':'standard','source_id':'STD','description':'Synthetic knowledge'}]
        learners=[{'id':1,'sourceId':1,'sourceKind':'learner','cohortId':'C','groupId':'G','group':'G'}]
        with composition_fixture(views,'scope_placement_lineage',return_value={'found':True,'programmeId':'P','placementBasis':'group'}), \
             composition_fixture(views,'authoring_scope_data',return_value=(modules,[],components,[])), \
             composition_fixture(views,'required_ksbs_for_request',return_value=required), \
             composition_fixture(views,'required_ksbs_for_resolved_source',return_value=required), \
             composition_fixture(views,'resolve_coverage_source',return_value=('standard','STD','programme')), \
             composition_fixture(views,'programme_row_ksb_source',return_value=('standard','STD')), \
             composition_fixture(views,'source_display_metadata',return_value={'sourceLabel':'Synthetic standard'}), \
             composition_fixture(views,'assigned_learners_for_scope',return_value=learners), \
             composition_fixture(views,'mappings_with_inferred_sources',side_effect=lambda rows,modules:rows), \
             composition_fixture(views,'annotate_coverage_sources',side_effect=lambda data:data), \
             composition_fixture(views,'cached_curriculum_value',side_effect=lambda key,build,**kwargs:build()):
            for path in ('/reporting/P/impact/','/reporting/P/impact/?moduleProgress=1',
                         '/reporting/P/impact/?view=summary','/reporting/P/achievement/?ksb_page_size=1&page_size=1',
                         '/reporting/P/coverage/','/reporting/P/coverage/?view=items',
                         '/reporting/P/coverage/?view=heatmap','/reporting/P/coverage/?view=summary'):
                with self.subTest(path=path):
                    with original_delivery():expected=self.client.get(path)
                    actual=self.client.get(path)
                    self.assertEqual(actual.status_code,200)
                    self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
            self.assertEqual(self.client.post('/reporting/P/impact/',{}).status_code,405)

    def test_statistics_grouped_normalized_catalogue_sql_parity(self):
        from curriculum_api import ksb_stats_reads
        from curriculum_api.test_statistics_boundary_no_db import original_statistics
        from curriculum_api.reporting.infrastructure import statistics_reads
        cm.ModuleAuthoringWeek.objects.create(id='W-ST', module_catalogue_id='MOD-TEST', title='Synthetic week')
        cm.ModuleAuthoringComponent.objects.create(id='C-ST', week_id='W-ST', module_catalogue_id='MOD-TEST', type='reading', title='Synthetic component')
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,'K1','Synthetic'),(2,'K2','Synthetic')")
        for key, status, standard in (('ST-1','active',1), ('ST-2','active',1), ('ST-3','inactive',2)):
            cm.ModuleAuthoringKsbMapping.objects.create(id=key, component_id='C-ST', standard_ksb_id=standard, status=status, weight=10)
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            with original_statistics():
                expected = ksb_stats_reads.grouped_scope_rows(['MOD-TEST', 'MOD-TEST'])
                expected_counts = ksb_stats_reads.grouped_component_counts(['MOD-TEST'])
            with patch.object(statistics_reads, '_grouped_rows', wraps=statistics_reads._grouped_rows) as owner:
                actual = ksb_stats_reads.grouped_scope_rows(['MOD-TEST', 'MOD-TEST'])
            self.assertEqual(owner.call_count, 3)
            self.assertEqual(actual, expected)
            self.assertEqual(ksb_stats_reads.grouped_component_counts(['MOD-TEST']), expected_counts)
            self.assertEqual(expected_counts, {'MOD-TEST': 1})
            self.assertEqual([(row['ksb_code'], row['_stats_count']) for row in actual[2]], [('K1', 2)])

    @contextmanager
    def statistics_inputs(self):
        modules = [{'module_catalogue_id': 'MOD-TEST'}]
        mappings = [
            {'module_catalogue_id': 'MOD-TEST', 'component_id': 'C-R1', 'ksb_code': code,
             'source_type': 'standard', 'source_id': 'STD', 'weight': weight}
            for code, weight in (('K1', 10), ('S2', 20), ('B1', 30))
        ]
        required = [{'code': code, 'source_type': 'standard', 'source_id': 'STD'} for code in ('K1','S2','B1')]
        with composition_fixture(views, 'authoring_scope_data', return_value=(modules, [], [], mappings)), \
             composition_fixture(views, 'infer_source_from_scope', return_value=('standard','STD','programme')), \
             composition_fixture(views, 'required_ksbs_for_resolved_source', return_value=required), \
             composition_fixture(views, 'assigned_learners_for_programme', return_value=[{'id':1},{'id':2}]):
            yield

    def test_statistics_compact_sql_and_programme_caps_parity(self):
        from curriculum_api import ksb_stats_reads
        from curriculum_api.test_statistics_boundary_no_db import original_statistics
        from curriculum_api.reporting.infrastructure import statistics_reads
        self.seed_report_delivery()
        with self.statistics_inputs(), \
             composition_fixture(views, 'programme_ksb_design_value', side_effect=lambda kind, pid, build, **kwargs: build()), \
             transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
            with original_statistics():
                expected_totals = ksb_stats_reads.progress_totals([1,2], ['K1','S2','B1'])
                expected = views._programme_ksb_stats('P', ['K1','S2','B1'], None)
            with patch.object(statistics_reads, 'latest_progress_weights', wraps=statistics_reads.latest_progress_weights) as owner:
                actual = views._programme_ksb_stats('P', ['K1','S2','B1'], None)
            owner.assert_called_once()
            self.assertEqual(ksb_stats_reads.progress_totals([1,2], ['K1','S2','B1']), expected_totals)
            self.assertEqual(expected_totals, {1: {'K1':95.0, 'S2':70.0}})
            self.assertEqual(actual, expected)
            self.assertEqual(actual['ksbMapped'], 3)
            self.assertEqual(actual['learnerKsbConsumedWeight'], 30)
            self.assertEqual(actual['learnerKsbExpectedWeight'], 120)
            self.assertEqual(actual['learnerKsbProgressPercentage'], 25)
            self.assertEqual(actual['learnerKsbAchievedCount'], 2)
            self.assertEqual(actual['learnerKsbTargetCount'], 6)

    def test_statistics_real_http_cache_force_and_missing_contracts(self):
        from curriculum_api.test_statistics_boundary_no_db import original_statistics
        from curriculum_api.reporting.api import statistics
        self.seed_report_delivery()
        def build(identifier, visibility):
            if identifier != 'P':
                return None
            return {'programmeId': identifier, **views._programme_ksb_stats(identifier, ['K1','S2','B1'], None)}
        def request():
            cache.clear()
            views.cache_state._CURRICULUM_CACHE.clear()
            response = self.client.get('/reporting/P/stats/')
            warm = self.client.get('/reporting/P/stats/', HTTP_IF_NONE_MATCH=response['ETag'])
            forced = self.client.get('/reporting/P/stats/', HTTP_CACHE_CONTROL='no-cache')
            missing = self.client.get('/reporting/missing/stats/')
            return (response.status_code, response.content, response['ETag'], warm.status_code,
                    forced.status_code, forced.content, missing.status_code, missing.content)
        with self.statistics_inputs(), composition_fixture(views, 'build_programme_ksb_stats', side_effect=build):
            with original_statistics():
                expected = request()
            with patch.object(statistics, 'curriculum_programme_ksb_stats', wraps=statistics.curriculum_programme_ksb_stats) as owner:
                actual = request()
            self.assertEqual(owner.call_count, 4)
            self.assertEqual(actual, expected)
            self.assertEqual((actual[0], actual[3], actual[4], actual[6]), (200,304,200,404))
            self.assertEqual(json.loads(actual[1])['learnerKsbProgressPercentage'], 25)
            self.assertEqual(self.client.post('/reporting/P/stats/', {}).status_code, 405)

    def seed_cohort_calendar(self):
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.calendar_holidays(id,source_kind,source_record_id,label,start_date,end_date,is_archived,division,notes,bunting) VALUES ('england:B','england_official','B','Bank','2028-01-01','2028-01-01',false,'england-and-wales','Substitute day',false),('local:A','local','A','Closure','2028-01-03','2028-01-05',false,NULL,'Internal note',NULL),('local:OLD','local','OLD','Archived closure','2028-01-02','2028-01-02',true,NULL,NULL,NULL),('england:WITHDRAWN','england_official','WITHDRAWN','Withdrawn bank','2028-01-02','2028-01-02',true,'england-and-wales',NULL,false),('england:OUT','england_official','OUT','Later bank','2028-02-01','2028-02-01',false,'england-and-wales',NULL,false)")
            cursor.execute("UPDATE curriculum.cohorts SET start_date='2028-01-01',end_date='2028-01-31',duration_months=1,epa_months=1,holiday_ids='[\"STALE\"]',excluded_holiday_ids='[\"B\"]',calendar_policy=NULL WHERE cohort_id='C'")

    def seed_module_plan(self):
        self.seed_cohort_calendar()
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET group_id=NULL,start_date='2028-01-03',end_date='2028-01-31',sessions_number=4,weeks_number=2,session_week_day='Monday, Thursday',session_start_time='09:00',session_end_time='11:00',session_overrides='{}' WHERE module_catalogue_id='MOD-TEST'")

    def seed_tutor_schedules(self):
        self.seed_module_plan()
        lm.StaffUser.objects.create(username='Tutor Busy',email='busy@example.invalid',position='Tutor',access='tutor')
        lm.StaffUser.objects.create(username='Tutor Free',email='free@example.invalid',position='Tutor',access='tutor')
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET tutor_name='Tutor Busy',session_week_day='Monday',end_date='2028-02-01' WHERE module_catalogue_id='MOD-TEST'")

    def test_staff_directory_real_sql_role_status_and_identity_parity(self):
        from curriculum_api.test_staff_profiles_boundary_no_db import original_staff_profiles
        from curriculum_api.catalogue.infrastructure import staff_directory
        tutor = lm.StaffUser.objects.create(username='Tutor One', email='one@example.invalid', access='tutor')
        lm.StaffUser.objects.create(username='Tutor Gone', email='gone@example.invalid', access='tutor', status='disabled')
        lm.StaffUser.objects.create(username='Coach One', email='coach@example.invalid', access='coach')
        with original_staff_profiles():
            expected = views.fetch_staff_users_by_access(' TUTOR ')
        with patch.object(staff_directory, 'fetch_staff_users_by_access', wraps=staff_directory.fetch_staff_users_by_access) as owner:
            actual = views.fetch_staff_users_by_access(' TUTOR ')
        self.assertEqual(actual, expected)
        owner.assert_called_once()
        with composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('No provisioning')):
            profiles = staff_directory.read_staff_profile_rows(
                'tutor', enrolment_available=True, fetch_staff_users_by_access=views.fetch_staff_users_by_access,
                staff_user_profile_source=views.staff_user_profile_source, staff_profile_is_archived=views.staff_profile_is_archived)
        self.assertEqual([p['name'] for p in profiles], ['Tutor One'])
        self.assertEqual(profiles[0]['staffUserId'], str(tutor.pk))
        self.assertEqual(profiles[0]['uuid'], str(tutor.uuid))

    def seed_authored_session_links(self):
        self.seed_module_plan()
        cm.ModuleAuthoringWeek.objects.create(id='OV-W', module_catalogue_id='MOD-TEST', week_number=1, title='Synthetic week')
        cm.ModuleAuthoringComponent.objects.create(id='OV-C', module_catalogue_id='MOD-TEST', week_id='OV-W',
            type='live_session', title='Synthetic session', settings_json={'sessionDate': '2028-01-04'})

    def test_calendar_convergence_real_sql_jsonb_scope_and_read_only(self):
        from curriculum_api import delivery_dashboard, calendar_read_rows
        from curriculum_api.catalogue.infrastructure import calendar_rows
        self.seed_authored_session_links()
        cm.ModuleAuthoringComponent.objects.create(id='OV-INACTIVE', module_catalogue_id='MOD-TEST',
            week_id='OV-W', type='live_session', status='inactive', title='Archived synthetic component',
            settings_json={'sessionDate': '2028-01-06'})
        # Explicit null must not resurrect a legacy stored date in the slim SQL.
        cm.ModuleAuthoringComponent.objects.filter(id='OV-C').update(settings_json={
            'sessionDate': None, 'legacySettings': {'sessionDate': '2035-01-01'},
            'description': 'Unneeded heavy settings'})
        with composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('No provisioning')), transaction.atomic():
            with connection.cursor() as cursor: cursor.execute('SET TRANSACTION READ ONLY')
            with patch.object(calendar_rows, 'live_rows', wraps=calendar_rows.live_rows) as adapter:
                _, components = calendar_read_rows.live_rows(['MOD-TEST'])
            adapter.assert_called_once()
            self.assertEqual({row['id']: row['status'] for row in components}, {'OV-C': 'active', 'OV-INACTIVE': 'inactive'})
            settings_value = views.parse_json_value(next(row['settings_json'] for row in components if row['id'] == 'OV-C'), {})
            self.assertIsNone(settings_value['sessionDate'])
            self.assertEqual(settings_value['legacySettings'], {'sessionDate': '2035-01-01'})
            self.assertNotIn('description', settings_value)
            expected = delivery_dashboard.build_calendar_sessions()
            self.assertEqual([row['componentId'] for row in expected], ['OV-C'])
            self.assertEqual(views.read_programme_sessions({'sourceId': 'P'}, 'operational'), expected)
            self.assertEqual(views.module_scoped_sessions('MOD-TEST'), expected)
            self.assertEqual(views.module_scoped_sessions('MOD-TEST', visibility='all'), expected)
            self.assertEqual(views.read_programme_sessions({'sourceId': 'missing', 'name': 'Synthetic programme'}, 'all'), [])
            self.assertEqual(views.module_scoped_sessions('missing'), [])

    def test_calendar_convergence_real_http_serialization_and_deleted_component(self):
        from curriculum_api import delivery_dashboard
        self.seed_authored_session_links()
        with composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('No provisioning')):
            expected = delivery_dashboard.build_calendar_sessions()
            for query in ('', '?module_catalogue_id=MOD-TEST', '?moduleCatalogueId=MOD-TEST&visibility=all', '?visibility=all'):
                response = self.client.get('/curriculum/sessions/'+query, HTTP_CACHE_CONTROL='no-cache')
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()['results'], expected)
            missing = self.client.get('/curriculum/sessions/?module_catalogue_id=missing')
            self.assertEqual(missing.json()['results'], [])
            self.assertEqual(missing.json()['count'], 0)
        # This mutation affects only this test's disposable synthetic fixture.
        cm.ModuleAuthoringComponent.objects.filter(id='OV-C').delete()
        with composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('No provisioning')):
            self.assertEqual(views.read_programme_sessions({'id': 'P'}, 'all'), [])
            self.assertEqual(views.module_scoped_sessions('MOD-TEST'), [])

    def test_calendar_convergence_required_sql_failure_is_not_cached_http_success(self):
        from curriculum_api.catalogue.infrastructure import calendar_rows
        self.seed_authored_session_links()
        before = (list(cm.ModuleAuthoringModule.objects.values()), list(cm.ModuleAuthoringComponent.objects.values()))
        with patch.object(calendar_rows, 'live_rows', side_effect=RuntimeError('private read diagnostic')):
            for query in ('', '?module_catalogue_id=MOD-TEST', '?visibility=all'):
                response = self.client.get('/curriculum/sessions/'+query, HTTP_CACHE_CONTROL='no-cache')
                self.assertEqual(response.status_code, 503, response.content)
                self.assertNotIn(b'private', response.content)
        self.assertEqual((list(cm.ModuleAuthoringModule.objects.values()), list(cm.ModuleAuthoringComponent.objects.values())), before)
        self.assertNotIn('delivery-calendar:v4', views.cache_state._CURRICULUM_CACHE)
        self.assertNotIn('sessions:authored-v2:all', views.cache_state._CURRICULUM_CACHE)

    def test_session_enrichment_real_sql_and_planning_parity(self):
        from curriculum_api.test_session_enrichment_boundary_no_db import original_sessions
        from curriculum_api.catalogue.application import session_links
        self.seed_authored_session_links()
        with composition_fixture(views, 'ensure_module_authoring_tables', return_value=None), transaction.atomic():
            with connection.cursor() as cursor: cursor.execute('SET TRANSACTION READ ONLY')
            with original_sessions(), views.curriculum_read_scope():
                expected = views.authoring_session_links_by_catalogue(['MOD-TEST'])
            with views.curriculum_read_scope(), patch.object(session_links, 'authoring_session_links_by_catalogue', wraps=session_links.authoring_session_links_by_catalogue) as owner:
                actual = views.authoring_session_links_by_catalogue(['MOD-TEST'], strict=True)
            owner.assert_called_once()
            self.assertEqual(actual, expected)
            self.assertEqual(actual['MOD-TEST'][0]['componentId'], 'OV-C')

    def test_required_overview_authored_rows_only_with_real_postgresql(self):
        from curriculum_api.catalogue.application import overview, session_calendar
        from functools import partial
        from curriculum_api.catalogue.application.delivery_reads import group_details_from_rows
        self.seed_authored_session_links()
        with composition_fixture(views, 'ensure_module_authoring_tables', return_value=None), views.curriculum_read_scope(), transaction.atomic():
            with connection.cursor() as cursor: cursor.execute('SET TRANSACTION READ ONLY')
            rows = views.get_required_curriculum_rows(compact=False)
            source = overview.required_delivery_source(rows, compact=False, read_holidays=views.get_holiday_rows,
                serialize_cohort=views.serialize_cohort_authoring_detail,
                project_groups=partial(group_details_from_rows, serialize_group_authoring_detail=views.serialize_group_authoring_detail,
                    clean_str=views.clean_str, format_date=views.format_date,
                    group_tutor_from_module_names=views.group_tutor_from_module_names, staff_assignment_key=views.staff_assignment_key))
            cohorts, groups = views.build_cohorts_and_groups(source=source, include_learner_counts=False)
            result = session_calendar.required_curriculum_sessions(rows, rows['training'], rows['authoring_modules'], cohorts, groups, rows['holidays'],
                read_links=views.authoring_session_links_by_catalogue, select_holidays=views.cohort_selected_holidays_by_id,
                build_authored_sessions=views.build_sessions_from_authoring_modules, clean_str=views.clean_str, parse_date=views.parse_date)
            self.assertEqual([row['componentId'] for row in result], ['OV-C'])
            self.assertEqual(result[0]['moduleCatalogueId'], 'MOD-TEST')

    def test_required_overview_component_failure_is_http_503_with_real_sources(self):
        from django.db import DatabaseError
        self.seed_authored_session_links()
        reader = views.authoring_fetch_all
        def fail_components(table, *args, **kwargs):
            if table == views.AUTHORING_COMPONENTS_TABLE:
                raise DatabaseError('private component diagnostic')
            return reader(table, *args, **kwargs)
        with (composition_fixture(views, 'ensure_module_authoring_tables', return_value=None),
              composition_fixture(views, 'authoring_fetch_all', side_effect=fail_components),
              composition_fixture(views, 'enrich_modules_with_authoring', side_effect=lambda rows, **kwargs: rows),
              composition_fixture(views, 'attach_module_assignment_counts', return_value=None),
              composition_fixture(views, 'active_learner_delivery_counts', return_value=({}, {})),
              composition_fixture(views, 'active_learner_programme_counts', return_value=({}, {})),
              composition_fixture(views, 'programme_structure_counts', return_value={})):
            response = self.client.get('/curriculum/overview/', HTTP_CACHE_CONTROL='no-cache')
        self.assertEqual(response.status_code, 503, response.content)
        self.assertNotIn(b'private', response.content)
        self.assertNotIn('overview-required:v2:operational:full', views.cache_state._CURRICULUM_CACHE)

    def test_overview_required_rows_match_original_on_normalized_postgresql(self):
        from curriculum_api.test_overview_boundary_no_db import original_overview
        from curriculum_api.catalogue.infrastructure import overview_reads
        self.seed_tutor_schedules()
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET group_id='G',cohort_id='C' WHERE module_catalogue_id='MOD-TEST'")
        for compact in (True, False):
            with self.subTest(compact=compact):
                with (original_overview('get_curriculum_rows'),
                      composition_fixture(views, 'ensure_module_authoring_tables', return_value=None),
                      views.curriculum_read_scope()):
                    expected = views.get_curriculum_rows(compact=compact)
                with (composition_fixture(views, 'ensure_module_authoring_tables', return_value=None),
                      patch.object(overview_reads, 'read_curriculum_source', wraps=overview_reads.read_curriculum_source) as owner,
                      views.curriculum_read_scope()):
                    actual = views.get_required_curriculum_rows(compact=compact)
                owner.assert_called_once()
                self.assertEqual({k: v for k, v in actual.items() if k != '_delivery_rows'}, expected)
                self.assertTrue(any(row['module_catalogue_id'] == 'MOD-TEST' for row in actual['authoring_modules']))
                self.assertTrue(actual['training'])
                if not compact:
                    self.assertTrue(actual['tutors'])

    def test_overview_partial_sql_read_is_503_without_caching_or_persisted_changes(self):
        from django.db import DatabaseError
        self.seed_tutor_schedules()
        before = list(cm.ModuleAuthoringModule.objects.values_list('module_catalogue_id', 'group_id'))
        read = views.authoring_fetch_all
        for table in (views.GROUPS_TABLE, views.COHORT_AUTHORING_DETAILS_TABLE, views.AUTHORING_WEEKS_TABLE):
            with self.subTest(table=table):
                def refused(name, *args, **kwargs):
                    if name == table:
                        raise DatabaseError('private source diagnostic')
                    return read(name, *args, **kwargs)
                with (composition_fixture(views, 'authoring_fetch_all', side_effect=refused),
                      composition_fixture(views, 'ensure_module_authoring_tables', return_value=None)):
                    response = self.client.get('/curriculum/overview/?compact=1', HTTP_CACHE_CONTROL='no-cache')
                self.assertEqual(response.status_code, 503, response.content)
                self.assertEqual(response.json(), {'error': 'Curriculum overview unavailable. Please retry.'})
                self.assertNotIn('rows-required:v2:compact', views.cache_state._CURRICULUM_CACHE)
                self.assertNotIn('overview-required:v2:operational:compact', views.cache_state._CURRICULUM_CACHE)
        self.assertEqual(list(cm.ModuleAuthoringModule.objects.values_list('module_catalogue_id', 'group_id')), before)

    def test_full_overview_staff_failure_is_unavailable_not_empty_postgresql(self):
        from django.db import DatabaseError
        from curriculum_api.catalogue.application.overview import CurriculumOverviewUnavailable
        with (composition_fixture(views, 'fetch_staff_users_by_access', side_effect=DatabaseError('private')),
              composition_fixture(views, 'ensure_module_authoring_tables', return_value=None)):
            with views.curriculum_read_scope(), self.assertRaises(CurriculumOverviewUnavailable):
                views.get_required_curriculum_rows(compact=False)
            response = self.client.get('/curriculum/overview/', HTTP_CACHE_CONTROL='no-cache')
        self.assertEqual(response.status_code, 503, response.content)
        self.assertNotIn(b'private', response.content)
        for method in ('post', 'delete'):
            self.assertEqual(getattr(self.client, method)('/curriculum/overview/').status_code, 405)

    def test_staff_profiles_real_assignments_collection_detail_http_parity(self):
        from django.test import RequestFactory
        from curriculum_api.test_staff_profiles_boundary_no_db import original_staff_profiles
        from curriculum_api.catalogue.application import staff_profiles
        self.seed_tutor_schedules()
        lm.StaffUser.objects.create(username='Coach One', email='coach@example.invalid', access='coach')
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.groups SET coach_name='Coach One' WHERE group_id='G'")
            cursor.execute("UPDATE curriculum.modules SET group_id='G',cohort_id='C' WHERE module_catalogue_id='MOD-TEST'")
            cursor.execute("INSERT INTO curriculum.tutors(id,name,email,phone,status) VALUES ('CT','Tutor Busy','catalogue@example.invalid','123','active'),('CT-OLD','Old Tutor','old@example.invalid','','archived')")
        # Existing broad authoring-presence gate is outside this representative
        # read-contract fixture. The new staff SQL readers do not provision it.
        with composition_fixture(views, 'ensure_module_authoring_tables', return_value=None):
            for url, handler, args in (
                ('/curriculum/tutors/', views.curriculum_tutors, ()),
                ('/curriculum/tutors/?visibility=all', views.curriculum_tutors, ()),
                ('/curriculum/coaches/', views.curriculum_coaches, ()),
                ('/curriculum/tutors/busy@example.invalid/', views.curriculum_tutor_detail, ('busy@example.invalid',)),
            ):
                # Resolve after restoration: old endpoint functions call old helpers.
                with original_staff_profiles():
                    expected = getattr(views, handler.__name__)(RequestFactory().get(url), *args)
                with patch.object(staff_profiles, 'build_staff_profiles', wraps=staff_profiles.build_staff_profiles) as owner:
                    actual = self.client.get(url)
                self.assertTrue(owner.called)
                self.assertEqual(actual.status_code, 200, actual.content)
                self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
                body = actual.json()
                if '/coaches/' in url:
                    self.assertEqual(body['results'][0]['assignedGroupIds'], ['G'])
                elif args:
                    self.assertIn('MOD-TEST', body['profile']['assignedModuleIds'])
                    self.assertEqual(body['profile']['email'], 'busy@example.invalid')
                else:
                    profile = next(p for p in body['results'] if p['id'] == 'CT')
                    self.assertEqual(profile['email'], 'catalogue@example.invalid')
                    self.assertIn('MOD-TEST', profile['assignedModuleIds'])

    def test_staff_assignment_source_failure_refuses_incomplete_http_profiles(self):
        from django.db import DatabaseError
        self.seed_tutor_schedules()
        lm.StaffUser.objects.create(username='Coach One', email='coach@example.invalid', access='coach')
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.groups SET coach_name='Coach One' WHERE group_id='G'")
        before = list(cm.ModuleAuthoringModule.objects.values_list('module_catalogue_id', 'group_id'))
        read = views.authoring_fetch_all
        for table in (views.GROUPS_TABLE, views.COHORT_AUTHORING_DETAILS_TABLE):
            with self.subTest(table=table):
                def refused(name, *args, **kwargs):
                    if name == table:
                        raise DatabaseError('private diagnostic')
                    return read(name, *args, **kwargs)
                with composition_fixture(views, 'authoring_fetch_all', side_effect=refused):
                    response = self.client.get('/curriculum/coaches/')
                self.assertEqual(response.status_code, 503, response.content)
                self.assertNotIn(b'private', response.content)
                self.assertNotIn('results', response.json())
        for symbol in ('module_index_rows', 'get_program_config_rows'):
            with composition_fixture(views, symbol, side_effect=DatabaseError('private diagnostic')):
                response = self.client.get('/curriculum/tutors/busy@example.invalid/')
            self.assertEqual(response.status_code, 503, response.content)
        self.assertEqual(list(cm.ModuleAuthoringModule.objects.values_list('module_catalogue_id', 'group_id')), before)

    def test_staff_assignment_get_avoids_provisioning_calendar_and_learner_counts(self):
        lm.StaffUser.objects.create(username='Coach One', email='coach@example.invalid', access='coach')
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.groups SET coach_name='Coach One' WHERE group_id='G'")
        with (composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('schema provisioning')),
              composition_fixture(views, 'get_holiday_rows_safe', side_effect=AssertionError('unused calendar')),
              composition_fixture(views, 'active_learner_delivery_counts', side_effect=AssertionError('unused learner counts'))):
            response = self.client.get('/curriculum/coaches/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['results'][0]['assignedGroupIds'], ['G'])

    def test_staff_read_failure_http_never_reports_empty_and_does_not_mutate(self):
        from django.db import DatabaseError
        before = list(lm.StaffUser.objects.values_list('id', 'username', 'access'))
        with composition_fixture(views, 'fetch_staff_users_by_access', side_effect=DatabaseError('sensitive diagnostic')):
            for url in ('/curriculum/coaches/', '/curriculum/tutors/unknown/'):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 503, response.content)
                self.assertNotIn(b'sensitive', response.content)
                self.assertNotIn('results', response.json())
        with composition_fixture(views, 'table_exists', return_value=False):
            self.assertEqual(self.client.get('/curriculum/tutors/').status_code, 503)
        self.assertEqual(list(lm.StaffUser.objects.values_list('id', 'username', 'access')), before)
        self.assertEqual(self.client.get('/curriculum/coaches/').json()['results'], [])
        self.assertEqual(self.client.get('/curriculum/tutors/missing/').status_code, 404)
        for url in ('/curriculum/coaches/', '/curriculum/tutors/', '/curriculum/tutors/unknown/'):
            self.assertEqual(self.client.post(url, data={}, content_type='application/json').status_code, 405)

    def test_tutor_availability_real_directory_roster_and_single_http_parity(self):
        from django.test import RequestFactory
        from curriculum_api.test_tutor_availability_boundary_no_db import original_tutor_availability
        from curriculum_api.catalogue.application import tutor_availability
        self.seed_tutor_schedules()
        url='/curriculum/preview/tutor-availability/'
        slot={'startDate':'2028-01-03','sessionsNumber':2,'weekDays':'Monday','startTime':'09:00','endTime':'11:00'}
        with composition_fixture(views,'ensure_module_authoring_tables',return_value=None):
            for payload in (slot,{**slot,'tutor':'Tutor Busy'},{'moduleCatalogueId':'MOD-TEST'}):
                with original_tutor_availability():
                    expected=views.curriculum_preview_tutor_availability(RequestFactory().post(url,data=payload,content_type='application/json'))
                with patch.object(tutor_availability,'preview_tutor_availability',wraps=tutor_availability.preview_tutor_availability) as owner:
                    actual=self.client.post(url,data=payload,content_type='application/json')
                owner.assert_called_once()
                self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
                self.assertEqual(actual.status_code,200,actual.content)
                if 'tutor' in payload:
                    self.assertFalse(actual.json()['available'])
                elif 'moduleCatalogueId' not in payload:
                    self.assertEqual((actual.json()['busyCount'],actual.json()['availableCount']),(1,1))

    def test_tutor_preview_group_read_failure_refuses_verdict_without_database_mutation(self):
        from django.db import DatabaseError
        self.seed_tutor_schedules()
        def stored_assignments():
            return sorted((row['module_catalogue_id'],row.get('tutor_name')) for row in
                          views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,ensure_tables=False))
        before=stored_assignments()
        read=views.authoring_fetch_all
        def fail_groups(table,*args,**kwargs):
            if table==views.GROUPS_TABLE:
                raise DatabaseError('Synthetic group-read failure')
            return read(table,*args,**kwargs)
        with composition_fixture(views,'authoring_fetch_all',side_effect=fail_groups):
            response=self.client.post('/curriculum/preview/tutor-availability/',data={'startDate':'2028-01-03','sessionsNumber':2,'weekDays':'Monday'},content_type='application/json')
        self.assertEqual(response.status_code,503)
        self.assertEqual(set(response.json()),{'error'})
        self.assertEqual(stored_assignments(),before)

    def test_tutor_read_adapters_use_real_sql_without_provisioning(self):
        from curriculum_api.catalogue.infrastructure import tutor_reads
        self.seed_tutor_schedules()
        with composition_fixture(views,'ensure_module_authoring_tables',side_effect=AssertionError('No provisioning')):
            modules=tutor_reads.read_module_rows(authoring_fetch_all=views.authoring_fetch_all,table=views.AUTHORING_MODULES_TABLE)
            groups=tutor_reads.read_group_rows(authoring_fetch_all=views.authoring_fetch_all,table=views.GROUPS_TABLE,order_sql=views.GROUP_ROWS_ORDER,clean_str=views.clean_str)
            staff=tutor_reads.read_tutor_rows(fetch_staff_users_by_access=views.fetch_staff_users_by_access,staff_user_profile_source=views.staff_user_profile_source,staff_profile_is_archived=views.staff_profile_is_archived,enrolment_available=True)
        self.assertEqual({row['module_catalogue_id'] for row in modules},{'MOD-TEST','MOD-SIBLING','MOD-EMPTY'})
        self.assertEqual(set(groups),{'G'})
        self.assertEqual([row['name'] for row in staff],['Tutor Busy','Tutor Free'])

    def test_tutor_guard_new_vs_inherited_clash_parity_on_real_rows(self):
        from curriculum_api.test_tutor_availability_boundary_no_db import original_tutor_availability
        from curriculum_api.catalogue.application import tutor_availability
        self.seed_tutor_schedules()
        row=views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,'module_catalogue_id = %s',['MOD-TEST'],ensure_tables=False)[0]
        before={**views.module_schedule_view(row),'module_catalogue_id':'NEW','sessions_number':2}
        candidate={**before,'sessions_number':3}
        with composition_fixture(views,'ensure_module_authoring_tables',return_value=None):
            with original_tutor_availability():
                expected=views.tutor_schedule_conflicts_created(before,candidate)
            with patch.object(tutor_availability,'tutor_schedule_conflicts_created',wraps=tutor_availability.tutor_schedule_conflicts_created) as owner:
                actual=views.tutor_schedule_conflicts_created(before,candidate)
        owner.assert_called_once()
        self.assertEqual(actual,expected)
        self.assertEqual(actual[0]['dates'],['2028-01-17'])

    def test_delivery_schedule_stored_http_group_and_custom_parity_postgresql(self):
        from django.test import RequestFactory
        from curriculum_api.test_delivery_schedule_boundary_no_db import original_delivery_schedules
        from curriculum_api.catalogue.application import delivery_schedules
        self.seed_module_plan()
        url='/curriculum/modules/MOD-TEST/session-plan/'
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET group_id='G' WHERE module_catalogue_id='MOD-TEST'")
            cursor.execute("UPDATE curriculum.groups SET schedule='Thursday 14:00-16:00',session_start_time='14:00',session_end_time='16:00' WHERE group_id='G'")
        # Same reviewed fixture limitation as the existing session-plan tests:
        # skip only the broad table-presence gate, keep all SQL readers real.
        with composition_fixture(views,'ensure_module_authoring_tables',return_value=None):
            for mode in ('group','custom'):
                with connection.cursor() as cursor:
                    cursor.execute("UPDATE curriculum.modules SET schedule_mode=%s WHERE module_catalogue_id='MOD-TEST'",[mode])
                for query in ({'sessions':'3'},{'weeks':'2'}):
                    with original_delivery_schedules():
                        expected=views.curriculum_module_session_plan(RequestFactory().get(url,query),'MOD-TEST')
                    with patch.object(delivery_schedules,'load_module_session_plan',wraps=delivery_schedules.load_module_session_plan) as owner:
                        actual=self.client.get(url,query)
                    owner.assert_called_once()
                    self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
                    self.assertEqual(actual.status_code,200,actual.content)
                    self.assertEqual(actual.json()['sessions'][0]['startTime'],'14:00' if mode=='group' else '09:00')

    def test_delivery_preview_http_valid_and_invalid_payload_parity(self):
        from django.test import RequestFactory
        from curriculum_api.test_delivery_schedule_boundary_no_db import original_delivery_schedules
        from curriculum_api.catalogue.application import delivery_schedules
        url='/curriculum/preview/module-session-plan/'
        for payload,status in (({'startDate':'2028-01-03','weekDays':'Monday','sessionsNumber':3,'startTime':'09:00','endTime':'11:00'},200),
                               ({'startDate':'2028-01-03','endDate':'2028-01-31','weeksNumber':2,'weekDays':'Thursday'},200),
                               ({'weekStartsOn':'Funday'},400),({'weeklySchedule':'bad'},400)):
            with original_delivery_schedules():
                expected=views.curriculum_preview_module_session_plan(RequestFactory().post(url,data=payload,content_type='application/json'))
            with patch.object(delivery_schedules,'preview_module_session_plan',wraps=delivery_schedules.preview_module_session_plan) as owner:
                actual=self.client.post(url,data=payload,content_type='application/json')
            self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
            self.assertEqual(actual.status_code,status)
            self.assertEqual(owner.call_count,1 if status==200 else 0)

    def test_delivery_calendar_real_rows_preserve_explicit_dates_clock_and_projection(self):
        from curriculum_api.test_delivery_schedule_boundary_no_db import original_delivery_schedules
        from curriculum_api.catalogue.application import session_calendar
        self.seed_module_plan()
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET session_overrides=%s::jsonb WHERE module_catalogue_id='MOD-TEST'",[json.dumps({'1':{'date':'2028-01-03','startTime':'17:00','endTime':'18:30','durationMinutes':90}})])
        row=views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,'module_catalogue_id = %s',['MOD-TEST'],ensure_tables=False)[0]
        holidays={'C':views.module_cohort_selected_holidays(row)}
        # Explicit synthetic component links: this case verifies database row /
        # calendar projection, not the separate component-link SQL reader.
        links={'MOD-TEST':[{'date':'2028-01-03','componentId':'COMP-A','weekId':'W-A','title':'Synthetic session'},
                           {'date':'2028-01-06','componentId':'COMP-B','weekId':'W-B'},{'date':'','componentId':'UNDATED'}]}
        with original_delivery_schedules():
            expected=views.build_sessions_from_authoring_modules([row],holidays,session_links=links)
        with patch.object(session_calendar,'build_sessions_from_authoring_modules',wraps=session_calendar.build_sessions_from_authoring_modules) as owner:
            actual=views.build_sessions_from_authoring_modules([row],holidays,session_links=links)
        owner.assert_called_once()
        self.assertEqual(actual,expected)
        self.assertEqual([s['componentId'] for s in actual],['COMP-A','COMP-B'])
        self.assertEqual([s['startTime'] for s in actual],['17:00','09:00'])
        self.assertEqual([s['skippedHolidays'] for s in actual],[['2028-01-03'],[]])

    def test_delivery_group_read_and_payload_normalization_postgresql(self):
        from curriculum_api.test_delivery_schedule_boundary_no_db import original_delivery_schedules
        from curriculum_api.catalogue.application import delivery_schedules
        self.seed_module_plan()
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.groups SET schedule='Thursday 14:00-16:00',session_start_time='14:00',session_end_time='16:00' WHERE group_id='G'")
        with composition_fixture(views,'ensure_module_authoring_tables',return_value=None):
            with original_delivery_schedules():
                expected=views.safe_group_delivery_rows()
            with patch.object(delivery_schedules,'safe_group_delivery_rows',wraps=delivery_schedules.safe_group_delivery_rows) as owner:
                actual=views.safe_group_delivery_rows()
        owner.assert_called_once()
        self.assertEqual(actual,expected)
        self.assertEqual(actual['G']['session_start_time'],'14:00')
        row=views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,'module_catalogue_id = %s',['MOD-TEST'],ensure_tables=False)[0]
        with original_delivery_schedules():
            expected=views.module_schedule_view(row)
        # Approved dev adds an explicit nullable layout discriminator to legacy
        # rows. Keep every other frozen expectation and assert the new field.
        expected['week_boundary_mode'] = None
        self.assertEqual(views.module_schedule_view(row),expected)

    def test_session_plan_real_calendar_count_weeks_and_cache_parity(self):
        from django.test.utils import CaptureQueriesContext
        from curriculum_api.test_session_plan_boundary_no_db import original_session_plans
        from curriculum_api.catalogue.application import session_plans
        self.seed_module_plan()
        row=views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,'module_catalogue_id = %s',['MOD-TEST'],ensure_tables=False)[0]
        for name in ('module_session_plan_for_count','module_session_plan_for_weeks'):
            with original_session_plans():
                expected=getattr(views,name)(dict(row),2)
            with patch.object(session_plans,name,wraps=getattr(session_plans,name)) as owner:
                actual=getattr(views,name)(dict(row),2)
            self.assertEqual(actual,expected)
            owner.assert_called_once()
            self.assertEqual(actual['sessions'][0]['date'],'2028-01-03')
            self.assertEqual(actual['slots'][0]['cause'],'holiday')
        with original_session_plans():
            expected=views.module_session_dates(dict(row))
        actual=views.module_session_dates(row)
        self.assertEqual(actual,expected)
        with CaptureQueriesContext(connection) as queries:
            self.assertIs(actual,views.module_session_dates(row))
        self.assertEqual(len(queries),0)

    def test_session_plan_custom_json_overrides_and_date_clipping_postgresql(self):
        from curriculum_api.test_session_plan_boundary_no_db import original_session_plans
        self.seed_module_plan()
        weekly=[{'day':'Tuesday','startTime':'10:00','endTime':'11:00'}, {'day':'Thursday','startTime':'14:00','endTime':'16:00'}]
        overrides={'2':{'date':'2028-01-12','startTime':'12:00','endTime':'13:00','durationMinutes':60}}
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.modules SET schedule_mode='custom',week_starts_on='Thursday',start_date='2028-01-06',end_date='2028-01-18',weekly_schedule=%s::jsonb,session_overrides=%s::jsonb WHERE module_catalogue_id='MOD-TEST'",[json.dumps(weekly),json.dumps(overrides)])
        row=views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE,'module_catalogue_id = %s',['MOD-TEST'],ensure_tables=False)[0]
        with original_session_plans():
            expected=views.module_session_plan_for_weeks(row,4)
        actual=views.module_session_plan_for_weeks(row,4)
        self.assertEqual(actual,expected)
        self.assertEqual([s['date'] for s in actual['sessions']],['2028-01-06','2028-01-12','2028-01-13','2028-01-18'])
        self.assertEqual(actual['sessions'][1]['originalDate'],'2028-01-11')
        self.assertEqual(actual['sessions'][1]['durationMinutes'],60)

    def test_session_plan_http_payload_and_missing_module_parity(self):
        from curriculum_api.test_session_plan_boundary_no_db import original_session_plans
        from curriculum_api.catalogue.application import session_plans
        self.seed_module_plan()
        url='/curriculum/modules/MOD-TEST/session-plan/'
        # This fixture supplies read-contract tables, not the complete authoring
        # schema. Skip only the broad schema-presence gate; actual SQL and HTTP
        # handler/serialization remain real, with runtime provisioning disabled.
        with composition_fixture(views,'ensure_module_authoring_tables',return_value=None):
            for query in ('?sessions=3','?weeks=2',''):
                with original_session_plans():
                    expected=self.client.get(url+query)
                with patch.object(session_plans,'module_delivery_session_plan',wraps=session_plans.module_delivery_session_plan) as owner:
                    actual=self.client.get(url+query)
                self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
                self.assertEqual(actual.status_code,200,actual.content)
                owner.assert_called_once()
                self.assertEqual(actual.json()['moduleCatalogueId'],'MOD-TEST')
                self.assertEqual(actual.json()['sessions'][0]['date'],'2028-01-03')
            self.assertEqual(self.client.post(url,data={},content_type='application/json').status_code,405)
            with composition_fixture(views,'resolve_stored_module_catalogue_id',return_value=None):
                self.assertEqual(self.client.get('/curriculum/modules/UNSAVED/session-plan/').status_code,404)

    def test_inherited_calendar_bulk_real_reads_match_original_and_keep_open_end(self):
        from django.test.utils import CaptureQueriesContext
        from curriculum_api.test_inherited_calendar_boundary_no_db import original_inherited_calendar
        from curriculum_api.catalogue.application import inherited_calendar
        self.seed_cohort_calendar()
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.cohorts(cohort_id,cohort_name,programme_id,start_date,end_date,excluded_holiday_ids) VALUES ('C2','Second synthetic cohort','P','2028-02-01','2028-02-29','[]')")
        with original_inherited_calendar():
            expected = views.cohort_selected_holidays_by_cohort([' C ', 'C2', 'C', 'missing'])
        with patch.object(inherited_calendar, 'cohort_selected_holidays_by_cohort', wraps=inherited_calendar.cohort_selected_holidays_by_cohort) as owner, \
                composition_fixture(views, 'authoring_rows_by_id', wraps=views.authoring_rows_by_id) as cohorts, \
                composition_fixture(views, 'get_holiday_rows', wraps=views.get_holiday_rows) as holidays, \
                composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('Provisioning forbidden')), \
                CaptureQueriesContext(connection) as queries:
            actual = views.cohort_selected_holidays_by_cohort([' C ', 'C2', 'C', 'missing'])
        self.assertEqual(actual, expected)
        self.assertEqual({key:[h['id'] for h in value] for key,value in actual.items()}, {'C':['A','OUT'], 'C2':['OUT']})
        owner.assert_called_once()
        cohorts.assert_called_once_with(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', ['C','C2','missing'], views.COHORT_ROWS_ORDER, ensure_tables=False)
        holidays.assert_called_once_with()
        self.assertTrue(queries.captured_queries)
        self.assertTrue(all(q['sql'].lstrip().lower().startswith('select') for q in queries.captured_queries))

    def test_inherited_calendar_module_preview_and_cache_use_real_cohort_once(self):
        from curriculum_api.test_inherited_calendar_boundary_no_db import original_inherited_calendar
        self.seed_cohort_calendar()
        def scenario():
            cache = {}
            with composition_fixture(views, 'cohort_selected_holidays_by_cohort', wraps=views.cohort_selected_holidays_by_cohort) as read:
                one = views.module_schedule_holidays({'cohort_id':' C '}, cache)
                two = views.module_schedule_holidays({'cohort_id':'C', 'holidays':[]}, cache)
                self.assertIs(one, two)
                read.assert_called_once_with(['C'])
            return one
        with original_inherited_calendar():
            expected = scenario()
        self.assertEqual(scenario(), expected)
        with connection.execute_wrapper(lambda *a, **k: (_ for _ in ()).throw(AssertionError('Explicit preview must not read DB'))):
            preview = [{'id':'UNSAVED', 'startDate':'2028-03-01'}]
            self.assertIs(views.module_schedule_holidays({'cohort_id':'C','holidays':preview}), preview)
            self.assertEqual(views.module_cohort_selected_holidays(None), [])

    def test_inherited_calendar_saved_foreign_rows_and_failure_contracts(self):
        from curriculum_api import country_calendars
        from curriculum_api.test_inherited_calendar_boundary_no_db import original_inherited_calendar
        self.seed_cohort_calendar()
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET calendar_policy=%s::jsonb,excluded_holiday_ids='[]' WHERE cohort_id='C'", [json.dumps({'country':'US'})])
        overview = {'id':'C', 'startDate':'2028-01-01', 'endDate':'2028-01-31', 'calendarPolicy':{'country':'US'}}
        with composition_fixture(country_calendars, 'ensure_calendar', side_effect=AssertionError('Sync forbidden')), \
                composition_fixture(country_calendars, 'fetch_holidays', side_effect=AssertionError('Provider forbidden')), \
                patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')):
            for old in (True, False):
                with original_inherited_calendar() if old else ExitStack():
                    with self.assertRaises(country_calendars.CalendarUnavailable):
                        views.module_cohort_selected_holidays({'cohort_id':'C'})
                    row = dict(overview)
                    self.assertEqual(views.cohort_selected_holidays_by_id([row], views.get_holiday_rows()), {'C':[]})
                    self.assertTrue(row['calendarError'])
            with connection.cursor() as cursor:
                cursor.execute("INSERT INTO curriculum.country_holiday_calendars(country,year,fetched_at,holidays) VALUES ('US',2028,now(),%s::jsonb)", [json.dumps([{'id':'US:SYNTHETIC', 'label':'Synthetic public holiday', 'startDate':'2028-01-10', 'endDate':'2028-01-10', 'source':'calendarific', 'country':'US'}])])
            with original_inherited_calendar():
                expected = views.cohort_selected_holidays_by_cohort(['C'])
            self.assertEqual(views.cohort_selected_holidays_by_cohort(['C']), expected)
            self.assertEqual([h['id'] for h in expected['C']], ['US:SYNTHETIC'])

    def test_inherited_calendar_new_call_observes_updated_synthetic_exclusions(self):
        from curriculum_api.test_inherited_calendar_boundary_no_db import original_inherited_calendar
        self.seed_cohort_calendar()
        first = views.module_cohort_selected_holidays({'cohort_id':'C'})
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET excluded_holiday_ids='[\"A\"]' WHERE cohort_id='C'")
        with original_inherited_calendar():
            expected = views.module_cohort_selected_holidays({'cohort_id':'C'})
        actual = views.module_cohort_selected_holidays({'cohort_id':'C'})
        self.assertEqual(actual, expected)
        self.assertEqual([h['id'] for h in first], ['A','OUT'])
        self.assertEqual([h['id'] for h in actual], ['B','OUT'])

    def test_normalized_calendar_reader_schema_archive_and_projection_postgresql(self):
        from curriculum_api.test_cohort_calendar_boundary_no_db import original_cohort_calendar
        from curriculum_api.catalogue.infrastructure import holiday_reads
        from curriculum_api import calendar_holidays
        self.seed_cohort_calendar()
        self.assertTrue(calendar_holidays.in_use())
        for include_archived, ids in [(False, ['B','A','OUT']), (True, ['B','OLD','A','OUT'])]:
            with original_cohort_calendar():
                expected = [views.serialize_holiday_row(row) for row in views.get_holiday_rows(include_archived)]
            with patch.object(holiday_reads, '_scoped_holiday_rows', wraps=holiday_reads._scoped_holiday_rows) as called:
                actual = [views.serialize_holiday_row(row) for row in views.get_holiday_rows(include_archived)]
            self.assertEqual(actual, expected)
            called.assert_called_once()
            self.assertEqual([row['id'] for row in actual], ids)
            self.assertNotIn('notes', next(row for row in actual if row['id']=='A'))
            self.assertEqual(actual[0]['notes'], 'Substitute day')

    def test_separate_calendar_table_queries_and_order_postgresql_parity(self):
        from curriculum_api.test_cohort_calendar_boundary_no_db import original_cohort_calendar
        from curriculum_api import calendar_holidays
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.fixture_england_holidays VALUES ('B','2028-01-01','Bank','england-and-wales','Substitute day',false)")
            cursor.execute("INSERT INTO curriculum.fixture_authored_holidays VALUES ('A','Closure','2027-12-30','2028-01-02',false),('OLD','Archived','2027-12-01','2027-12-02',true)")
        # Same SQL shape as the older installation; source names are confined
        # to explicitly created fixture tables in this disposable database.
        with patch.object(calendar_holidays, 'in_use', return_value=False), \
                composition_fixture(views, 'ENGLAND_HOLIDAYS_TABLE', 'fixture_england_holidays'), \
                composition_fixture(views, 'authored_holiday_table_name', return_value='fixture_authored_holidays'):
            for include_archived, ids in [(False, ['A','B']), (True, ['OLD','A','B'])]:
                with original_cohort_calendar():
                    expected = views.get_holiday_rows(include_archived)
                actual = views.get_holiday_rows(include_archived)
                self.assertEqual(actual, expected)
                self.assertEqual([row['id'] for row in actual], ids)

    def test_cohort_detail_real_rows_recomputed_holidays_and_one_calendar_read(self):
        from curriculum_api.test_cohort_calendar_boundary_no_db import original_cohort_calendar
        from curriculum_api.catalogue.application import cohort_calendar
        from curriculum_api import calendar_holidays
        self.seed_cohort_calendar()
        lm.PlacementCohort.objects.create(cohort_id='C2',cohort_name='Second',programme_id='P')
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET start_date='2028-02-01',end_date='2028-02-29',excluded_holiday_ids='[]' WHERE cohort_id='C2'")
        with original_cohort_calendar():
            expected = views.cohort_authoring_detail_rows()
        with patch.object(calendar_holidays, 'rows', wraps=calendar_holidays.rows) as read, \
                patch.object(cohort_calendar, 'serialize_cohort_authoring_detail', wraps=cohort_calendar.serialize_cohort_authoring_detail) as project:
            actual = views.cohort_authoring_detail_rows()
        self.assertEqual(actual, expected)
        read.assert_called_once()
        self.assertEqual(project.call_count, 2)
        by_id = {row['cohortId']:row for row in actual}
        self.assertEqual(by_id['C']['holidayIds'], ['A'])
        self.assertEqual(by_id['C']['excludedHolidayIds'], ['B'])
        self.assertEqual(by_id['C']['apprenticeshipEndDate'], '2028-02-29')
        self.assertEqual(by_id['C2']['holidayIds'], ['OUT'])
        self.assertEqual(by_id['C']['holidaySummary'], {'global':3,'inRange':2,'selected':1})

    def test_saved_country_calendar_success_expiry_and_missing_never_sync(self):
        from curriculum_api.test_cohort_calendar_boundary_no_db import original_cohort_calendar
        from curriculum_api import country_calendars
        self.seed_cohort_calendar()
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET calendar_policy='{\"country\":\"US\"}',excluded_holiday_ids='[]' WHERE cohort_id='C'")
        def detail():
            return views.serialize_cohort_authoring_detail(views.fetch_cohort_row('C'))
        with composition_fixture(country_calendars, 'ensure_calendar', side_effect=AssertionError('Sync forbidden')) as sync, \
                composition_fixture(country_calendars, 'fetch_holidays', side_effect=AssertionError('Provider forbidden')) as fetch, \
                patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')):
            for state in ('missing','valid','expired'):
                with connection.cursor() as cursor:
                    if state == 'valid':
                        cursor.execute("INSERT INTO curriculum.country_holiday_calendars VALUES ('US',2028,now(),'[{\"id\":\"US-1\",\"label\":\"Synthetic US\",\"startDate\":\"2028-01-10\",\"endDate\":\"2028-01-10\",\"source\":\"calendarific\",\"country\":\"US\"}]','')")
                    if state == 'expired':
                        cursor.execute("UPDATE curriculum.country_holiday_calendars SET fetched_at=now()-interval '31 days'")
                with original_cohort_calendar():
                    expected = detail()
                actual = detail()
                self.assertEqual(actual, expected)
                self.assertEqual(actual['holidayIds'], ['US-1'] if state=='valid' else [])
                self.assertEqual(bool(actual['calendarError']), state!='valid')
            sync.assert_not_called()
            fetch.assert_not_called()

    def test_holiday_http_visibility_payload_and_method_parity(self):
        from curriculum_api.test_cohort_calendar_boundary_no_db import original_cohort_calendar
        from curriculum_api import england_holidays
        self.seed_cohort_calendar()
        # The GET's existing refresh notification is stubbed, never executed.
        with patch.object(england_holidays, 'auto_sync_if_due'):
            for query in ('', '?visibility=all'):
                cache.clear()
                views.cache_state._CURRICULUM_CACHE.clear()
                with original_cohort_calendar():
                    expected = self.client.get('/curriculum/holidays/'+query)
                cache.clear()
                views.cache_state._CURRICULUM_CACHE.clear()
                actual = self.client.get('/curriculum/holidays/'+query)
                self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
                self.assertEqual(actual.status_code,200)
                ids = [row['id'] for row in actual.json()['results']]
                self.assertEqual(ids, ['B','OLD','A','OUT'] if query else ['B','A','OUT'])
            self.assertEqual(self.client.post('/curriculum/holidays/').status_code,405)

    def test_calendar_scope_memo_and_external_fixture_edit_postgresql(self):
        from curriculum_api.test_cohort_calendar_boundary_no_db import original_cohort_calendar
        from curriculum_api import calendar_holidays
        self.seed_cohort_calendar()
        def scenario():
            with patch.object(calendar_holidays, 'rows', wraps=calendar_holidays.rows) as read:
                with views.curriculum_read_scope():
                    first = views.get_holiday_rows()
                    again = views.get_holiday_rows(include_archived=False)
                    archived = views.get_holiday_rows(include_archived=True)
                self.assertEqual(first,again)
                self.assertIsNot(first,again)
                self.assertEqual(read.call_count,2)
            return first,archived
        with original_cohort_calendar():
            expected = scenario()
        self.assertEqual(scenario(),expected)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.calendar_holidays SET start_date='2028-01-06',end_date='2028-01-08' WHERE id='local:A'")
        with original_cohort_calendar():
            expected = scenario()
        actual = scenario()
        self.assertEqual(actual,expected)
        closure = next(row for row in actual[0] if row['id']=='A')
        self.assertEqual(views.format_date(closure['start_date']), '2028-01-06')

    def seed_placement_records(self):
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET start_date='2026-01-31',end_date='2028-01-31',duration_months=24,epa_months=1,apprenticeship_end_date='2099-01-01',holiday_ids='[\"H\"]',excluded_holiday_ids='[\"EX\"]',calendar_policy='{\"version\":1}' WHERE cohort_id='C'")
            cursor.execute("UPDATE curriculum.groups SET start_date='2026-02-01',end_date='2028-01-31',schedule='Tuesday 09:30-11:45',week_days='Monday',session_start_time='08:00',session_end_time='10:00',coach_name='Ada, ada, Bea',module_ids='[\"MOD-SIBLING\",\"MOD-TEST\"]' WHERE group_id='G'")

    def test_placement_canonical_and_alias_readers_real_sql_parity(self):
        from curriculum_api.test_placement_record_boundary_no_db import original_placement_records
        from curriculum_api.catalogue.infrastructure import placement_records as readers
        from curriculum_api.catalogue.application import placement_records as records
        self.seed_placement_records()
        for kind, ident in [('cohort', 'C'), ('group', 'G')]:
            for symbol, owner in [('fetch_'+kind+'_row', readers), ('resolve_'+kind+'_row', records)]:
                for value in ('\u2003'+ident+'\t', ident.lower(), 'MISSING', ''):
                    with original_placement_records():
                        expected = getattr(views, symbol)(value)
                    with patch.object(owner, symbol, wraps=getattr(owner, symbol)) as called:
                        actual = getattr(views, symbol)(value)
                    self.assertEqual(actual, expected)
                    called.assert_called_once()
                    if symbol.startswith('resolve') and value == ident.lower():
                        self.assertEqual(actual[kind+'_id'], ident)

    def test_placement_name_resolution_archive_and_group_ambiguity_postgresql(self):
        from curriculum_api.test_placement_record_boundary_no_db import original_placement_records
        self.seed_placement_records()
        for kind, model, ident, label in [('cohort', lm.PlacementCohort, 'C', 'Synthetic cohort'),
                                          ('group', lm.PlacementGroup, 'G', 'Synthetic group')]:
            values = {kind+'_id': 'ARCHIVED-'+ident, kind+'_name': label, 'programme_id': 'P'}
            if kind == 'group':
                values['cohort_id'] = 'C'
            model.objects.create(**values)
            with connection.cursor() as cursor:
                cursor.execute('UPDATE curriculum.'+kind+"s SET status='archived' WHERE "+kind+'_id=%s', ['ARCHIVED-'+ident])
            symbol = 'resolve_'+kind+'_row'
            with original_placement_records():
                expected = getattr(views, symbol)(label.lower())
            actual = getattr(views, symbol)(label.lower())
            self.assertEqual(actual, expected)
            self.assertEqual(actual[kind+'_id'], ident)
        lm.PlacementGroup.objects.create(group_id='AMBIGUOUS', group_name='Synthetic group', programme_id='P', cohort_id='C')
        with original_placement_records():
            self.assertIsNone(views.resolve_group_row('Synthetic group'))
        self.assertIsNone(views.resolve_group_row('Synthetic group'))
        self.assertEqual(views.resolve_group_row('G')['group_id'], 'G')

    def test_cohort_record_http_native_dates_json_and_epa_parity(self):
        from curriculum_api.test_placement_record_boundary_no_db import original_placement_records
        from curriculum_api.catalogue.application import placement_records
        self.seed_placement_records()
        url = '/curriculum/record-snapshot/?kind=cohort&id=C'
        for months, override, expected_end in [(1, None, '2028-02-29'), (0, None, ''), (None, None, ''), (3, '2028-02-10', '2028-02-10')]:
            with connection.cursor() as cursor:
                cursor.execute('UPDATE curriculum.cohorts SET epa_months=%s,apprenticeship_end_override=%s WHERE cohort_id=%s', [months, override, 'C'])
            with original_placement_records():
                expected = self.client.get(url)
            with patch.object(placement_records, 'curriculum_cohort_from_authoring_detail', wraps=placement_records.curriculum_cohort_from_authoring_detail) as called:
                actual = self.client.get(url)
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
            self.assertEqual(actual.status_code, 200)
            called.assert_called_once()
            record = actual.json()['record']
            self.assertEqual((record['endDate'], record['apprenticeshipEndDate']), ('2028-01-31', expected_end))
            self.assertEqual(record['calendarPolicy'], {'version': 1})
            self.assertEqual((record['holidayIds'], record['excludedHolidayIds']), (['H'], ['EX']))
            response = views.record_conflict_response('stale', actual.json()['revision'], cohort=views.cohort_conflict_record('C'))
            self.assertEqual(response.status_code, 409)
            self.assertEqual(json.loads(response.content)['cohort'], record)

    def test_group_record_http_delivery_columns_schedule_and_order_parity(self):
        from curriculum_api.test_placement_record_boundary_no_db import original_placement_records
        from curriculum_api.catalogue.application import placement_records
        self.seed_placement_records()
        url = '/curriculum/record-snapshot/?kind=group&id=G'
        for structured, times in [(True, ('Monday', '08:00', '10:00')), (False, ('Tuesday', '09:30', '11:45'))]:
            if not structured:
                with connection.cursor() as cursor:
                    cursor.execute("UPDATE curriculum.groups SET week_days=NULL,session_start_time=NULL,session_end_time=NULL WHERE group_id='G'")
            with original_placement_records():
                expected = self.client.get(url)
            with patch.object(placement_records, 'curriculum_group_from_authoring_detail', wraps=placement_records.curriculum_group_from_authoring_detail) as called:
                actual = self.client.get(url)
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
            self.assertEqual(actual.status_code, 200)
            called.assert_called_once()
            record = actual.json()['record']
            self.assertEqual((record['weekDays'], record['startTime'], record['endTime']), times)
            self.assertEqual(record['startDate'], '2026-02-01')
            # This fixture deliberately stores the older physical JSON column.
            # Django's raw PostgreSQL cursor returns it as text; both original
            # and extracted builders pass it through, unlike derived lists.
            self.assertIsInstance(record['moduleIds'], str)
            self.assertEqual(record['moduleIds'], json.dumps(['MOD-SIBLING', 'MOD-TEST']))
            response = views.record_conflict_response('stale', actual.json()['revision'], group=views.group_conflict_record('G'))
            self.assertEqual(json.loads(response.content)['group'], record)

    def test_placement_snapshot_missing_and_read_failure_are_distinct_postgresql(self):
        from curriculum_api.test_placement_record_boundary_no_db import original_placement_records
        self.seed_placement_records()
        for kind in ('cohort', 'group'):
            url = '/curriculum/record-snapshot/?kind='+kind+'&id=MISSING'
            with original_placement_records():
                expected = self.client.get(url)
            actual = self.client.get(url)
            self.assertEqual(actual.content, expected.content)
            self.assertEqual((actual.status_code, actual.json()['record']), (200, None))
            ident = 'C' if kind == 'cohort' else 'G'
            url = '/curriculum/record-snapshot/?kind='+kind+'&id='+ident
            # A valid token followed by a failed record read must remain 503.
            with composition_fixture(views, 'curriculum_record_revision', return_value='synthetic-token'), \
                    composition_fixture(views, 'authoring_fetch_all', side_effect=RuntimeError('synthetic read failure')):
                with original_placement_records():
                    expected = self.client.get(url)
                actual = self.client.get(url)
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
            self.assertEqual(actual.status_code, 503)

    def seed_week_template_reads(self):
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.week_templates(id,title,summary,course_type,programme_id,module_catalogue_id,group_id,status,updated_at,total_otjh,points,component_count,learning_outcomes) VALUES ('WT','Reading One','Synthetic summary','paid','P','MOD-TEST','G','draft','2026-01-04',2.25,8,7,'[\"Outcome\"]'),('FREE','Other','Free summary','free',NULL,NULL,NULL,'published','2026-01-03',0,0,0,'[]'),('ARCHIVED','Archived','Hidden','paid','P','MOD-TEST','G','inactive','2026-01-02',0,0,0,'[]'),('STAMP','Deleted','Hidden','paid','P','MOD-TEST','G','draft','2026-01-01',0,0,0,'[]')")
            cursor.execute("UPDATE curriculum.week_templates SET deleted_at='2026-01-01' WHERE id='STAMP'")
            for cid, template, order, direct, settings in (
                ('B','WT',1,' Column question ',{'reflectionPrompt': 'ignored', 'body': 'Synthetic B'}),
                ('A','WT',0,'',{'reflectionPrompt': ' Legacy question ', 'body': 'Synthetic A'}),
                ('OTHER','FREE',0,None,{}),
            ):
                cursor.execute("INSERT INTO curriculum.week_template_components(id,week_template_id,type,title,display_order,expected_otjh,points,reflection_required,reflection_question,settings_json,ksb_mappings) VALUES (%s,%s,'reading',%s,%s,1.25,3,true,%s,%s,'[\"K1\"]')", [cid,template,'Synthetic '+cid,order,direct,json.dumps(settings)])

    def test_week_template_queries_archive_scope_and_order_postgresql(self):
        from curriculum_api.test_week_template_read_boundary_no_db import original_week_template_reads
        from curriculum_api.catalogue.infrastructure import week_templates
        self.seed_week_template_reads()
        def capture():
            return (views.get_week_template_rows(), views.get_week_template_rows(include_deleted=True),
                    views.get_week_template_rows('programme_id = %s', ['P']),
                    views.get_week_template_row('ARCHIVED'), views.get_week_template_row('STAMP', include_deleted=True),
                    views.get_week_template_component_rows('WT'))
        with original_week_template_reads():
            expected = capture()
        with patch.object(week_templates, 'get_week_template_rows', wraps=week_templates.get_week_template_rows) as called:
            actual = capture()
        self.assertEqual(actual, expected)
        self.assertEqual(called.call_count, 5)
        self.assertEqual([r['id'] for r in actual[0]], ['WT', 'FREE'])
        self.assertEqual(len(actual[1]), 4)
        self.assertEqual([r['id'] for r in actual[2]], ['WT'])
        self.assertIsNone(actual[3])
        self.assertEqual([r['id'] for r in actual[5]], ['A', 'B'])

    def test_week_template_collection_http_filters_and_payload_parity(self):
        from curriculum_api.test_week_template_read_boundary_no_db import original_week_template_reads
        from curriculum_api.catalogue.application import week_templates
        from django.test import RequestFactory
        self.seed_week_template_reads()
        cases = [('', ['WT','FREE']), ('?courseType=PAID&programmeId=P&moduleCatalogueId=MOD-TEST&groupId=G&status=draft&search=READ', ['WT']),
                 ('?courseType=free', ['FREE']), ('?search=missing', []), ('?programmeId=MISSING', [])]
        for query, ids in cases:
            url = '/curriculum/week-templates/'+query
            with original_week_template_reads():
                expected = views.curriculum_week_template_collection(RequestFactory().get(url))
            with patch.object(week_templates, 'list_week_template_payloads', wraps=week_templates.list_week_template_payloads) as called:
                actual = self.client.get(url)
            called.assert_called_once()
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
            self.assertEqual([r['id'] for r in actual.json()['results']], ids)
            self.assertEqual(actual.json()['count'], len(ids))
            self.assertTrue(all(r['components'] == [] for r in actual.json()['results']))
        self.assertEqual(self.client.put('/curriculum/week-templates/').status_code, 405)

    def test_week_template_detail_serialization_revision_and_missing_postgresql(self):
        from curriculum_api.test_week_template_read_boundary_no_db import original_week_template_reads
        from curriculum_api.catalogue.application import week_templates
        self.seed_week_template_reads()
        for ident in ('WT', 'FREE', 'ARCHIVED', 'STAMP', 'MISSING'):
            url = '/curriculum/week-templates/'+ident+'/'
            with original_week_template_reads():
                expected = self.client.get(url)
            with patch.object(week_templates, 'week_template_record', wraps=week_templates.week_template_record) as called:
                actual = self.client.get(url)
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
            self.assertEqual(actual.status_code, 200 if ident in ('WT','FREE') else 404)
            self.assertEqual(called.call_count, 1 if actual.status_code == 200 else 0)
            if ident == 'WT':
                record = actual.json()['weekTemplate']
                self.assertEqual([c['id'] for c in record['components']], ['A','B'])
                self.assertEqual([c['reflectionQuestion'] for c in record['components']], ['Legacy question', 'Column question'])
                self.assertTrue(all(c['coachValidationRequired'] for c in record['components']))
                self.assertEqual((record['totalOtjh'],record['points'],record['componentCount']), (2.25,8,7))
                self.assertEqual(record['revision'], views.week_template_revision('WT'))
        self.assertEqual(self.client.post('/curriculum/week-templates/WT/').status_code, 405)

    def test_week_template_record_fresh_revision_and_after_write_response_parity(self):
        from curriculum_api.test_week_template_read_boundary_no_db import original_week_template_reads
        self.seed_week_template_reads()
        before = views.week_template_record('WT')
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.week_template_components SET title='External edit' WHERE id='A'")
        for after_write in (False, True):
            with original_week_template_reads():
                expected = views.week_template_detail_response('WT', after_write=after_write, updated=after_write)
            actual = views.week_template_detail_response('WT', after_write=after_write, updated=after_write)
            self.assertEqual(actual.content, expected.content)
            record = json.loads(actual.content)['weekTemplate']
            self.assertNotEqual(record['revision'], before['revision'])
            self.assertEqual(record['revision'], views.week_template_revision('WT'))
            self.assertEqual(record['components'][0]['title'], 'External edit')
        with composition_fixture(views, 'week_template_revision', return_value=''):
            response = self.client.get('/curriculum/week-templates/WT/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['weekTemplate']['revision'], 'unverified')

    def test_record_revisions_real_sql_and_entity_scope_postgresql(self):
        from curriculum_api.test_record_revision_boundary_no_db import original_record_reads
        from curriculum_api.catalogue.infrastructure import record_revisions
        def capture():
            return {kind: views.curriculum_record_revision(kind, ident) for kind, ident in
                    [('programme', 'P'), ('cohort', 'C'), ('group', 'G'), ('module', 'MOD-TEST')]}
        with original_record_reads():
            expected = capture()
        with patch.object(record_revisions, 'record_revision', wraps=record_revisions.record_revision) as called:
            actual = capture()
        self.assertEqual(actual, expected)
        self.assertEqual(called.call_count, 3)
        self.assertTrue(all(len(value) == 32 for value in actual.values()))
        cm.ModuleAuthoringModule.objects.filter(module_catalogue_id='MOD-TEST').update(title='Child changed')
        changed = capture()
        self.assertNotEqual(changed['module'], actual['module'])
        for kind in ('programme', 'cohort', 'group'):
            self.assertEqual(changed[kind], actual[kind])
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.cohorts SET updated_at=now() WHERE cohort_id='C'")
        self.assertEqual(capture(), changed)
        lm.PlacementCohort.objects.filter(cohort_id='C').update(cohort_name='Edited cohort')
        self.assertNotEqual(capture()['cohort'], changed['cohort'])
        with original_record_reads():
            expected_after = capture()
        self.assertEqual(capture(), expected_after)
        self.assertEqual(views.cohort_record_revision('MISSING'), '')

    def test_template_header_component_and_missing_revision_postgresql(self):
        from curriculum_api.test_record_revision_boundary_no_db import original_record_reads
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.week_templates(id,title) VALUES ('T','Synthetic template'),('OTHER','Other')")
            cursor.execute("INSERT INTO curriculum.week_template_components(id,week_template_id,type,title,settings_json) VALUES ('TC','T','reading','Synthetic text','{}'),('OTHER-C','OTHER','reading','Other','{}')")
        with original_record_reads():
            expected = views.week_template_revision(' T ')
        self.assertEqual(views.week_template_revision(' T '), expected)
        self.assertEqual(len(expected), 32)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.week_template_components SET title='Unrelated edit' WHERE id='OTHER-C'")
            cursor.execute("UPDATE curriculum.week_templates SET updated_at=now() WHERE id='T'")
        self.assertEqual(views.week_template_revision('T'), expected)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.week_template_components SET settings_json='{\"body\":\"changed\"}' WHERE id='TC'")
        actual = views.week_template_revision('T')
        self.assertNotEqual(actual, expected)
        with original_record_reads():
            self.assertEqual(views.week_template_revision('T'), actual)
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM curriculum.week_templates WHERE id='T'")
        self.assertEqual(views.week_template_revision('T'), '')

    def test_record_revision_http_query_contract_postgresql(self):
        from curriculum_api.test_record_revision_boundary_no_db import original_record_reads
        url = '/curriculum/revisions/?cohort=C&cohort=C&cohort=&cohort=MISSING&programme=P&group=G&module=MOD-TEST&unknown=ignored'
        with original_record_reads():
            # URL resolver captures the current handler, so call the immutable
            # old endpoint directly with a real Django request for this oracle.
            from django.test import RequestFactory
            old = views.curriculum_record_revisions(RequestFactory().get(url))
        actual = self.client.get(url)
        self.assertEqual((actual.status_code, actual.content), (old.status_code, old.content))
        revisions = actual.json()['revisions']
        self.assertEqual(list(revisions), ['programme', 'cohort', 'group', 'module'])
        self.assertEqual(list(revisions['cohort']), ['C', 'MISSING'])
        self.assertEqual(revisions['cohort']['MISSING'], '')
        self.assertEqual(self.client.post('/curriculum/revisions/').status_code, 405)

    def test_record_snapshot_and_conflict_payload_postgresql(self):
        from curriculum_api.test_record_revision_boundary_no_db import original_record_reads
        from curriculum_api.catalogue.application import conflict_records
        for kind, ident, symbol in [('programme', 'P', 'programme_conflict_record'),
                                     ('cohort', 'C', 'cohort_conflict_record'),
                                     ('group', 'G', 'group_conflict_record')]:
            url = '/curriculum/record-snapshot/?kind='+kind+'&id='+ident
            with original_record_reads(), patch.dict(record_snapshots.SNAPSHOT_READERS, {kind: getattr(views, symbol)}):
                expected = self.client.get(url)
            with patch.object(conflict_records, symbol, wraps=getattr(conflict_records, symbol)) as called:
                actual = self.client.get(url)
            self.assertEqual(actual.status_code, 200, actual.content)
            self.assertEqual(actual.content, expected.content)
            called.assert_called_once()
            data = actual.json()
            self.assertTrue(data['revision'])
            self.assertIsNotNone(data['record'])
            refusal = views.record_conflict_response('stale', data['revision'], **{kind: data['record']})
            self.assertEqual(refusal.status_code, 409)
            self.assertEqual(json.loads(refusal.content)[kind], data['record'])

    def test_structure_revision_fresh_shared_and_external_changes_postgresql(self):
        from curriculum_api.test_revision_boundary_no_db import original_revisions
        from curriculum_api.catalogue.application import structure_revisions
        from curriculum_api.catalogue.domain import structure_revision
        cm.ModuleAuthoringWeek.objects.create(id='REV-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='REV-C', module_catalogue_id='MOD-TEST', week_id='REV-W',
            type='reading', title='Synthetic', settings_json={'readingContent': 'Synthetic text'})
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,'K1','Synthetic')")
        cm.ModuleAuthoringKsbMapping.objects.create(id='REV-K', component_id='REV-C', standard_ksb_id=1, status='active')
        def capture():
            rows = views.module_structure_source_rows('MOD-TEST')
            return (views.module_structure_revision('MOD-TEST'),
                    views.module_structure_revision('MOD-TEST', source_rows=rows))
        with original_revisions():
            expected = capture()
        with patch.object(structure_revisions, 'module_structure_revision', wraps=structure_revisions.module_structure_revision) as app, \
             patch.object(structure_revisions, 'revision_digest', wraps=structure_revision.revision_digest) as policy:
            actual = capture()
        self.assertEqual(actual, expected)
        self.assertEqual(actual[0], actual[1])
        self.assertEqual(len(actual[0]), 32)
        self.assertEqual(app.call_count, 2)
        self.assertEqual(policy.call_count, 2)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.components SET updated_at=now() WHERE id='REV-C'")
        self.assertEqual(capture(), actual)
        cm.ModuleAuthoringComponent.objects.filter(id='REV-C').update(settings_json={'readingContent': 'External edit'})
        changed = capture()
        self.assertNotEqual(changed[0], actual[0])
        self.assertEqual(changed[0], changed[1])
        with original_revisions():
            self.assertEqual(changed, capture())

    def test_structure_payload_revision_and_item_fingerprints_postgresql_parity(self):
        from curriculum_api.test_revision_boundary_no_db import original_revisions
        from curriculum_api.catalogue.infrastructure import structure_sources
        cm.ModuleAuthoringWeek.objects.create(id='REV-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='REV-C', module_catalogue_id='MOD-TEST', week_id='REV-W',
            type='reading', title='Synthetic content', expected_otjh=.125,
            settings_json={'readingContent': 'Synthetic text'})
        with ExitStack() as stack:
            # Opaque unchanged calendar/provider ports: no Teams tests or calls.
            for name in ('apply_module_session_plan_to_weeks', 'apply_shared_teams_settings_to_weeks'):
                stack.enter_context(composition_fixture(views, name))
            for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session'):
                stack.enter_context(composition_fixture(views, name, return_value={}))
            with original_revisions():
                expected = views.read_module_structure_with_revision('MOD-TEST')
            with patch.object(structure_sources, 'module_structure_source_rows', wraps=structure_sources.module_structure_source_rows) as source:
                actual = views.read_module_structure_with_revision('MOD-TEST')
            source.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(actual['structureRevision'], views.module_structure_revision('MOD-TEST'))
        self.assertEqual(set(actual['itemFingerprints']['weeks']), {'REV-W'})
        self.assertEqual(set(actual['itemFingerprints']['components']), {'REV-C'})

    def test_compact_transport_native_values_and_verified_changes_postgresql(self):
        from curriculum_api import authoring_read_transport as transport
        from curriculum_api.test_transport_boundary_no_db import original_transport
        from curriculum_api.catalogue.infrastructure import authoring_transport as core, authoring_row_snapshots as snapshots
        self.addCleanup(snapshots._SNAPSHOTS.clear)
        snapshots._SNAPSHOTS.clear()
        cm.ModuleAuthoringWeek.objects.create(id='WIRE-W', module_catalogue_id='MOD-TEST', week_number=1)
        for index, text, settings in (
            (1, 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â±ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ repeated', {'body': ['same']}),
            (2, 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â±ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¹ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¨ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â  ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ repeated', {'body': ['same']}),
            (3, None, None), (4, '  ', json.dumps({'body': 'string JSON'})),
        ):
            cm.ModuleAuthoringComponent.objects.create(id=f'WIRE-{index}', module_catalogue_id='MOD-TEST', week_id='WIRE-W',
                type='reading', title=f'Wire {index}', display_order=index, description=text,
                settings_json=settings, expected_otjh=.125)
        args = ('components', 'module_catalogue_id = %s', ['MOD-TEST'], 'display_order, id')
        columns = ['id', 'description', 'settings_json', 'expected_otjh', 'created_at', 'display_order']
        def plain():
            return views.fetch_all('select '+', '.join(views.quote_ident(c) for c in columns)+
                ' from curriculum.components where module_catalogue_id = %s order by display_order, id', ['MOD-TEST'])
        with original_transport() as old:
            before = old.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True)
            self.assertEqual(old.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True), before)
        with patch.object(core, '_compact_rows', wraps=core._compact_rows) as content:
            cold = transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True)
            self.assertEqual(cold, before)
            self.assertEqual(cold, plain())
            content.reset_mock()
            cold[0]['description'] = 'unsaved caller mutation'
            self.assertEqual(transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True), before)
            content.assert_not_called()
            cm.ModuleAuthoringComponent.objects.filter(id='WIRE-2').update(description='External synthetic edit', display_order=0)
            cm.ModuleAuthoringComponent.objects.filter(id='WIRE-3').delete()
            changed = transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True)
            self.assertEqual(changed, plain())
            self.assertEqual([r['id'] for r in changed], ['WIRE-2', 'WIRE-1', 'WIRE-4'])
            self.assertEqual(content.call_count, 1)
            self.assertEqual(content.call_args.args[2], ['MOD-TEST', 'WIRE-2'])
            cm.ModuleAuthoringComponent.objects.filter(module_catalogue_id='MOD-TEST').delete()
            content.reset_mock()
            self.assertEqual(transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True), [])
            content.assert_not_called()

    def test_normalized_ksb_transport_cold_warm_and_joined_changes_postgresql(self):
        from curriculum_api import authoring_read_transport as transport
        from curriculum_api.test_transport_boundary_no_db import original_transport
        from curriculum_api.catalogue.infrastructure import authoring_transport as core, authoring_row_snapshots as snapshots
        from django.db import ProgrammingError
        snapshots._SNAPSHOTS.clear()
        self.addCleanup(snapshots._SNAPSHOTS.clear)
        cm.ModuleAuthoringWeek.objects.create(id='KSB-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='KSB-C', module_catalogue_id='MOD-TEST', week_id='KSB-W', type='reading')
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,'K1','Synthetic standard')")
        cm.ModuleAuthoringKsbMapping.objects.create(id='KSB-M', component_id='KSB-C', standard_ksb_id=1, status='active')
        args = ('ksb_mappings', 'module_catalogue_id = %s', ['MOD-TEST'], 'id')
        columns = ['id', 'component_id', 'module_catalogue_id', 'week_id', 'ksb_code', 'ksb_description', 'status']
        with original_transport() as old, self.assertRaises(ProgrammingError) as failure:
            old.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True)
        self.assertEqual(failure.exception.__cause__.sqlstate, '42703')
        print('Original compact KSB read: confirmed 42703 on disposable normalized schema', flush=True)
        def plain():
            return views.fetch_all('select '+', '.join(views.quote_ident(c) for c in columns)+
                ' from '+views.ksb_mapping_placement.read_source('ksb_mappings')+
                ' where module_catalogue_id = %s order by id', ['MOD-TEST'])
        with patch.object(core, '_compact_rows', wraps=core._compact_rows) as content:
            actual = transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True)
            self.assertEqual(actual, plain())
            self.assertEqual(actual[0]['ksb_description'], 'Synthetic standard')
            content.reset_mock()
            self.assertEqual(transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True), actual)
            content.assert_not_called()
            with connection.cursor() as cursor:
                cursor.execute("UPDATE curriculum.standard_ksbs SET ksb_description='Changed standard text' WHERE id=1")
            actual = transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True)
            self.assertEqual(actual, plain())
            self.assertEqual(actual[0]['ksb_description'], 'Changed standard text')
            self.assertEqual(content.call_count, 1)
            # Membership comes from the component join, not stale mapping copies.
            cm.ModuleAuthoringComponent.objects.filter(id='KSB-C').update(module_catalogue_id='MOD-SIBLING')
            self.assertEqual(transport.compact_authoring_rows(*args, columns=columns, reuse_unchanged=True), [])
        cm.ModuleAuthoringComponent.objects.filter(id='KSB-C').update(module_catalogue_id='MOD-TEST')
        with original_transport():
            self.assertEqual(views.module_structure_revision('MOD-TEST'), '')
        self.assertTrue(views.module_structure_revision('MOD-TEST'))

    def test_summary_read_adapters_grouped_and_string_json_postgresql_parity(self):
        from curriculum_api.test_read_adapters_boundary_no_db import original_read_adapters
        from curriculum_api.catalogue.infrastructure import component_summary_reads
        cm.ModuleAuthoringWeek.objects.create(id='SUM-W', module_catalogue_id='MOD-TEST', week_number=2)
        for cid, settings, status in (
            ('SUM-A', {'componentBuilderStatus': 'published'}, 'active'),
            ('SUM-B', {'componentBuilderStatus': 'published'}, 'active'),
            ('SUM-C', json.dumps({'componentBuilderStatus': 'published'}), 'active'),
            ('SUM-D', {'componentBuilderStatus': 'published'}, 'inactive'),
        ):
            cm.ModuleAuthoringComponent.objects.create(id=cid, module_catalogue_id='MOD-TEST', week_id='SUM-W',
                type='reading', title=cid, display_order=1, expected_otjh=.125, settings_json=settings, status=status)
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,' k1 ','Synthetic KSB')")
        for cid in ('SUM-A', 'SUM-B', 'SUM-D'):
            cm.ModuleAuthoringKsbMapping.objects.create(id='MAP-'+cid, component_id=cid, standard_ksb_id=1,
                source_type='standard', source_id='synthetic-standard', status='active')
        def capture():
            return (views.component_summary_source_rows(['MOD-TEST']),
                    views.component_summary_ksb_codes(['MOD-TEST']),
                    views.component_summary_rows(['MOD-TEST']))
        with original_read_adapters():
            expected = capture()
        with patch.object(component_summary_reads, 'component_summary_source_rows', wraps=component_summary_reads.component_summary_source_rows) as called:
            actual = capture()
        self.assertEqual(actual, expected)
        self.assertEqual(called.call_count, 2)
        self.assertEqual(sum(row['_count'] for row in actual[0]), 3)
        self.assertEqual(actual[1], {('MOD-TEST', 'SUM-W'): {'K1'}})
        # The current raw-cursor JSON decoder parses once: a JSON string remains
        # a string and is treated as draft. Preserve that existing full-read rule.
        self.assertEqual((actual[2][0]['count'], actual[2][0]['publishedCount'], actual[2][0]['otjhMinutes']), (3, 2, 24))
        full = views.component_builder_rows(['MOD-TEST'])
        self.assertEqual(len(full), 3)
        self.assertEqual(sum(row['status'] == 'published' for row in full), 2)

    def test_authoring_direct_and_prefetched_postgresql_completion_parity(self):
        from curriculum_api.test_read_adapters_boundary_no_db import original_read_adapters
        from curriculum_api.catalogue.infrastructure import authoring_reads
        cm.ModuleAuthoringWeek.objects.create(id='READ-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='READ-C', module_catalogue_id='MOD-TEST', week_id='READ-W', type='reading')
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,'K1','Synthetic standard text')")
        cm.ModuleAuthoringKsbMapping.objects.create(id='READ-K', component_id='READ-C', standard_ksb_id=1, status='active')
        calls = [
            (('modules', 'module_catalogue_id = %s', ['MOD-TEST'], 'module_catalogue_id'),
             {'ensure_tables': False, 'columns': ['module_catalogue_id', 'programme_name', 'cohort_name', 'group_name']}),
            (('ksb_mappings', 'module_catalogue_id = %s', ['MOD-TEST'], 'id'),
             {'ensure_tables': False, 'columns': ['id', 'module_catalogue_id', 'ksb_code', 'ksb_description']}),
            (('weeks', 'module_catalogue_id = %s', ['MOD-TEST'], 'id'),
             {'ensure_tables': False, 'columns': ['id', 'module_catalogue_id']}),
            (('groups', '', [], views.GROUP_ROWS_ORDER),
             {'ensure_tables': False, 'columns': ['group_id', 'programme_id', 'cohort_id', 'group_name', 'programme_name', 'cohort_name']}),
            (('cohorts', '', [], views.COHORT_ROWS_ORDER),
             {'ensure_tables': False, 'columns': ['cohort_id', 'programme_id', 'cohort_name', 'programme_name', 'start_date']}),
        ]
        def capture(prefetch):
            with views.curriculum_read_scope():
                if prefetch:
                    views.prefetch_authoring_reads(calls)
                return [views.authoring_fetch_all(*args, **kwargs) for args, kwargs in calls]
        with composition_fixture(views, 'CURRICULUM_BATCHED_READS', True):
            with original_read_adapters():
                expected = capture(False)
                self.assertEqual(capture(True), expected)
            self.assertEqual(capture(False), expected)
            with patch.object(authoring_reads, 'prefetch_authoring_reads', wraps=authoring_reads.prefetch_authoring_reads) as batch, \
                 patch.object(authoring_reads, 'authoring_fetch_all', wraps=authoring_reads.authoring_fetch_all) as direct:
                actual = capture(True)
            batch.assert_called_once()
            direct.assert_not_called()  # all five calls hit the batch's exact memo keys
        self.assertEqual(actual, expected)
        self.assertEqual(actual[0][0]['programme_name'], 'Synthetic programme')
        self.assertEqual(actual[1][0]['ksb_description'], 'Synthetic standard text')

    def test_delivery_count_reader_postgresql_parity(self):
        from curriculum_api.test_delivery_read_boundary_no_db import original_delivery_reads
        from curriculum_api.catalogue.infrastructure import delivery_counts
        with original_delivery_reads():
            expected = views.active_learner_delivery_counts()
        with patch.object(delivery_counts, 'active_learner_delivery_counts',
                          wraps=delivery_counts.active_learner_delivery_counts) as called:
            actual = views.active_learner_delivery_counts()
        called.assert_called_once()
        self.assertEqual(actual, expected)
        # Three active profiles have placement IDs; inactive profile 6 is excluded.
        self.assertEqual(actual, ({'C': 3}, {'G': 3}))

    def test_authoring_summary_and_grouped_sql_postgresql_parity(self):
        from curriculum_api.test_authoring_read_boundary_no_db import original_authoring_reads
        from curriculum_api.catalogue.infrastructure import grouped_content
        self.test_normalized_ksb_counts_and_legacy_source_alias()
        for content, compact in ((True, False), (True, True), (False, False)):
            with original_authoring_reads():
                expected = views.authoring_catalogue_summaries(include_content=content, list_only=compact)
            for summary in expected.values():
                summary['weekBoundaryMode'] = None
            from curriculum_api import catalogue_summary_reads
            with patch.object(catalogue_summary_reads, 'grouped_catalogue_content_rows',
                              wraps=grouped_content.grouped_catalogue_content_rows) as called:
                actual = views.authoring_catalogue_summaries(include_content=content, list_only=compact)
            self.assertEqual(actual, expected)
            self.assertEqual(actual['MOD-TEST']['ksbCount'], 1)
            self.assertEqual(called.call_count, 1 if compact and content else 0)

    def test_structure_payload_and_component_sql_postgresql_parity(self):
        from curriculum_api.test_structure_read_boundary_no_db import original_structure_reads
        from curriculum_api.catalogue.application import structure_payloads
        from curriculum_api.catalogue.infrastructure import component_reads
        cm.ModuleAuthoringWeek.objects.create(id='STRUCT-W', module_catalogue_id='MOD-TEST', week_number=1)
        cm.ModuleAuthoringComponent.objects.create(id='STRUCT-C', module_catalogue_id='MOD-TEST', week_id='STRUCT-W',
            type='reading', title='Synthetic body', expected_otjh=.125,
            settings_json={'readingContent': 'Synthetic long text', 'videoUrl': 'synthetic'})
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO curriculum.module_details (module_catalogue_id, background) VALUES (%s, %s)", ['MOD-TEST', 'Synthetic background'])
        # Calendar and delivery implementations are outside this batch. All
        # catalogue readers and PostgreSQL component projections execute for real.
        with ExitStack() as stack:
            for name in ('apply_module_session_plan_to_weeks', 'apply_shared_teams_settings_to_weeks'):
                stack.enter_context(composition_fixture(views, name))
            for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session'):
                stack.enter_context(composition_fixture(views, name, return_value={}))
            def capture():
                return (views.get_authoring_structure_payload('MOD-TEST'),
                        views.get_authoring_structure_payloads(['MOD-TEST'], include_extra=False),
                        views.live_component_rows_paged(['MOD-TEST']),
                        views.live_component_rows_without_content(['MOD-TEST']),
                        views.live_component_rows_without_content(['MOD-TEST'], keep_keys=('videoUrl',), exclude_columns=('description',)))
            with original_structure_reads():
                expected = capture()
            expected[0]['weekBoundaryMode'] = None
            for payload in expected[1].values():
                payload['weekBoundaryMode'] = None
            with patch.object(structure_payloads, 'get_authoring_structure_payload', wraps=structure_payloads.get_authoring_structure_payload) as single, \
                 patch.object(structure_payloads, 'get_authoring_structure_payloads', wraps=structure_payloads.get_authoring_structure_payloads) as batch, \
                 patch.object(component_reads, 'live_component_rows_without_content', wraps=component_reads.live_component_rows_without_content) as projection:
                actual = capture()
            self.assertEqual(actual, expected)
            single.assert_called_once()
            batch.assert_called_once()
            self.assertEqual(projection.call_count, 2)
            self.assertEqual(actual[0]['lessonCount'], 1)
            self.assertEqual(actual[0]['background'], 'Synthetic background')
            self.assertEqual(actual[1]['MOD-TEST']['lessonCount'], 1)
            self.assertIn('readingContent', views.parse_json_value(actual[2][0]['settings_json'], {}))
            self.assertNotIn('readingContent', views.parse_json_value(actual[3][0]['settings_json'], {}))
            self.assertEqual(views.parse_json_value(actual[4][0]['settings_json'], {}), {'videoUrl': 'synthetic'})

    def test_component_catalogue_real_postgresql_parity_and_missing_week_label(self):
        from curriculum_api.test_component_catalogue_boundary_no_db import original_component_catalogue
        from curriculum_api.catalogue.application import component_catalogue
        cm.ModuleAuthoringWeek.objects.create(id='CAT-W', module_catalogue_id='MOD-TEST', week_number=4, title='Fourth')
        cm.ModuleAuthoringComponent.objects.create(id='CAT-C', module_catalogue_id='MOD-TEST', week_id='CAT-W',
            type='reading', title='Synthetic', expected_otjh=.125, settings_json={'readingContent': 'Synthetic body', 'componentBuilderStatus': 'published'})
        def capture():
            return (views.component_builder_rows(['MOD-TEST']),
                    views.component_builder_rows(['MOD-TEST'], omit_content=True),
                    views.component_builder_rows(['MOD-TEST'], programme_view=True),
                    views.component_summary_rows(['MOD-TEST']))
        with original_component_catalogue():
            expected = capture()
        with patch.object(component_catalogue, 'component_builder_rows', wraps=component_catalogue.component_builder_rows) as called:
            actual = capture()
        self.assertEqual(actual, expected)
        self.assertEqual(called.call_count, 3)
        self.assertEqual(actual[0][0]['week'], 'Week 4')
        cm.ModuleAuthoringWeek.objects.filter(id='CAT-W').update(status='inactive')
        with original_component_catalogue():
            self.assertEqual(views.component_builder_rows(['MOD-TEST'])[0]['week'], 'Week 1')
        self.assertEqual(views.component_builder_rows(['MOD-TEST'])[0]['week'], '')
        self.assertEqual(views.component_summary_rows(['MOD-TEST'])[0]['week'], '')

    def test_library_programme_paging_and_normalized_ksb_postgresql_regressions(self):
        from curriculum_api.test_component_catalogue_boundary_no_db import original_component_catalogue
        from curriculum_api.catalogue.infrastructure import library_reads
        lm.PlacementProgramme.objects.create(programme_id='Q', name='Other synthetic programme')
        cm.ModuleAuthoringModule.objects.create(module_catalogue_id='MOD-Q', title='Other module', programme_id='Q')
        for mid, wid in (('MOD-TEST', 'LIB-WP'), ('MOD-Q', 'LIB-WQ')):
            cm.ModuleAuthoringWeek.objects.create(id=wid, module_catalogue_id=mid, week_number=2)
        for cid,mid,wid,order in (('LIB-A','MOD-TEST','LIB-WP',1),('LIB-B','MOD-Q','LIB-WQ',2),('LIB-C','MOD-Q','LIB-WQ',3)):
            cm.ModuleAuthoringComponent.objects.create(id=cid,module_catalogue_id=mid,week_id=wid,type='reading',title=cid,display_order=order)
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.components SET updated_at='2030-01-01'")
            cursor.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,' K1 ','Synthetic KSB')")
        cm.ModuleAuthoringKsbMapping.objects.create(id='LIB-MAP', component_id='LIB-B', standard_ksb_id=1, weight=1, status='active')
        with original_component_catalogue():
            self.assertEqual(views.library_component_rows(programme_ids=['Q'], page_size=1), [])
            old_detail = views.library_component_rows(ids=['LIB-B'], detail=True)[0]
            self.assertEqual(old_detail['ksbRefs'], [])
        with patch.object(library_reads, 'read_library_component_page', wraps=library_reads.read_library_component_page) as called:
            first = views.library_component_rows(programme_ids=[' Q ', 'Q'], page_size=1)
            second = views.library_component_rows(programme_ids=['Q'], page_size=1, page=2)
        self.assertEqual(called.call_count, 2)
        self.assertEqual([r['id'] for r in first], ['LIB-B'])
        self.assertEqual([r['id'] for r in second], ['LIB-C'])
        detail = views.library_component_rows(ids=['LIB-B'], detail=True)[0]
        self.assertEqual(detail['ksbRefs'], ['K1'])
        self.assertEqual(detail['ksbMappings'][0]['description'], 'Synthetic KSB')
        old_detail.update(ksbRefs=detail['ksbRefs'], ksbMappings=detail['ksbMappings'])
        self.assertEqual(detail, old_detail)
        # The stored programme normalization is the existing Python strip rule.
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.modules SET programme_id=%s WHERE module_catalogue_id=%s', ['\u00a0\tQ\u3000', 'MOD-Q'])
        self.assertEqual([r['id'] for r in views.library_component_rows(programme_ids=['Q'], page_size=1)], ['LIB-B'])

    def test_catalogue_counts_and_resolution_parity(self):
        self.test_normalized_ksb_counts_and_legacy_source_alias()
        def capture():
            return (views.authoring_module_content_counts(),
                    [views.resolve_stored_module_catalogue_id(i) for i in
                     ('MOD-TEST', 'catalogue-module-MOD-TEST', 'legacy-synthetic', 'training-module-legacy-synthetic', 'missing', '')])
        actual = capture()
        with legacy_catalogue():
            before = capture()
        self.assertEqual(actual, before)
        self.assertEqual(actual[0][1]['MOD-TEST'], 1)
        self.assertEqual(actual[1][:3], ['MOD-TEST'] * 3)

    def test_catalogue_projection_sources_real_sql_parity(self):
        for include_weeks in (False, True):
            actual = views.home_relationship_rows(include_weeks=include_weeks)
            with legacy_catalogue():
                before = views.home_relationship_rows(include_weeks=include_weeks)
            self.assertEqual(actual, before)
            self.assertEqual(len(actual['modules']), 3)
        actual = views.programme_list_sources()
        with legacy_catalogue():
            before = views.programme_list_sources()
        self.assertEqual(actual, before)

    def test_home_and_programme_payload_parity(self):
        for visibility in ('operational', 'all'):
            for owner, name in ((views, 'build_home_summary'), (views, 'build_programme_list')):
                with self.subTest(visibility=visibility, consumer=name):
                    actual = getattr(owner, name)(visibility, force=True)
                    with legacy_catalogue():
                        before = getattr(owner, name)(visibility, force=True)
                    self.assertEqual(actual, before)
                    self.assertTrue(actual)

    def test_catalogue_new_boundaries_invoked(self):
        from curriculum_api.catalogue.application import resolution, projections
        from curriculum_api.catalogue.infrastructure import content_counts, projection_sources
        with patch.object(resolution, 'resolve_stored_module_catalogue_id', wraps=resolution.resolve_stored_module_catalogue_id) as resolver, patch.object(content_counts, 'authoring_module_content_counts', wraps=content_counts.authoring_module_content_counts) as counts_spy, patch.object(projection_sources, 'home_relationship_rows', wraps=projection_sources.home_relationship_rows) as source, patch.object(projections, 'build_home_summary', wraps=projections.build_home_summary) as app:
            self.assertEqual(views.resolve_stored_module_catalogue_id('MOD-TEST'), 'MOD-TEST')
            views.authoring_module_content_counts()
            self.assertTrue(views.build_home_summary('operational'))
            resolver.assert_called_once()
            self.assertGreaterEqual(counts_spy.call_count, 1)
            source.assert_called_once()
            app.assert_called_once()

    def test_extracted_boundaries_execute_real_queries(self):
        from learner_api.learning_plans.application import module_membership
        from learner_api.learning_plans.infrastructure import membership_facts
        with patch.object(module_membership, 'module_member_enrolment_ids', wraps=module_membership.module_member_enrolment_ids) as application, patch.object(membership_facts, 'learner_facts', wraps=membership_facts.learner_facts) as facts:
            self.assertEqual(new_reader('MOD-TEST'), {'101','102','104','106'})
            application.assert_called_once()
            facts.assert_called_once()
            self.assertIs(facts.call_args.kwargs['connection'], views.connection)

    def test_fact_query_parity_and_profile_narrowing(self):
        for modules in (set(), {'MOD-TEST', 'MOD-SIBLING'}):
            for profiles in (None, [], [1, '2', 2]):
                with self.subTest(modules=modules, profiles=profiles):
                    old = old_env['learner_facts'](modules, profiles)
                    actual = counts.learner_facts(modules, profiles)
                    self.assertEqual(actual, old)
                    if profiles is not None:
                        self.assertEqual({row['id'] for row in actual}, {int(i) for i in profiles})

    def test_membership_modes_and_registration_identity(self):
        self.assertEqual(old_reader('MOD-TEST'), {'101','102','104','106'})
        self.assertEqual(new_reader('MOD-TEST'), old_reader('MOD-TEST'))
        with connection.cursor() as c:
            c.execute("UPDATE curriculum.modules SET learner_roster_mode='manual' WHERE module_catalogue_id='MOD-TEST'")
        self.assertEqual(new_reader('MOD-TEST'), {'102','104'})
        self.assertEqual(new_reader('MOD-TEST'), old_reader('MOD-TEST'))
        self.assertEqual(new_reader('MOD-EMPTY'), set())

    def test_get_full_compact_ordering_and_parity(self):
        for suffix in ('','?assignedOnly=1'):
            responses=[]
            for reader in (old_reader,new_reader):
                with patch.object(counts,'module_member_enrolment_ids',reader):
                    response=self.client.get(self.url()+suffix)
                    self.assertEqual(response.status_code,200,response.content)
                    responses.append(response.json())
            self.assertEqual(*responses)
            rows=responses[0]['learners']
            self.assertEqual([r['name'] for r in rows],sorted(r['name'] for r in rows))
            self.assertEqual({r['id'] for r in rows if r['assigned']},{'101','102','104','106'})

    def test_unauthenticated(self):
        self.assertEqual(Client().get(self.url()).status_code,401)

    def test_manual_and_empty_http(self):
        with connection.cursor() as c:
            c.execute("UPDATE curriculum.modules SET learner_roster_mode='manual' WHERE module_catalogue_id='MOD-TEST'")
        for mid,expected in (('MOD-TEST',{'102','104'}),('MOD-EMPTY',set())):
            results=[]
            for reader in (old_reader,new_reader):
                with patch.object(counts,'module_member_enrolment_ids',reader):
                    response=self.client.get(self.url(mid)+'?assignedOnly=1')
                self.assertEqual(response.status_code,200,response.content)
                self.assertEqual({row['id'] for row in response.json()['learners']},expected)
                results.append(response.json())
            self.assertEqual(*results)

    def test_inherited_delete_mirror_parity(self):
        outcomes=[]
        for reader in (old_reader,new_reader):
            self.setUp()
            # Still inherited for membership (no normalized rows). The legacy
            # writer needs a retained selection to materialize after removal.
            lm.EnrolmentUser.all_learners.filter(pk=101).update(training_plan=[
                {'moduleId':'MOD-TEST','moduleTitle':'MOD-TEST'},
                {'moduleId':'MOD-SIBLING','moduleTitle':'MOD-SIBLING'}])
            with patch.object(counts,'module_member_enrolment_ids',reader):
                response=self.client.delete(self.url(),data=json.dumps({'learnerIds':[101]}),content_type='application/json')
            self.assertEqual(response.status_code,200,response.content)
            self.assertEqual(response.json()['changedCount'],1)
            rows=list(lm.LearnerTrainingPlanModule.objects.filter(learner_id=1).order_by('curriculum_module_id').values_list('curriculum_module_id',flat=True))
            self.assertTrue(rows)
            self.assertNotIn('MOD-TEST',rows)
            user=lm.EnrolmentUser.all_learners.get(pk=101)
            outcomes.append((response.json(),rows,user.training_plan,user.learning_plan,user.modules))
        self.assertEqual(*outcomes)

    def test_inherited_delete_without_recordable_remainder_is_rejected(self):
        # _unassign_module explicitly raises when its mirror remains empty.
        # Preserve this separate historical refusal, not a successful deletion.
        outcomes=[]
        for reader in (old_reader,new_reader):
            self.setUp()
            before=lm.EnrolmentUser.all_learners.get(pk=101)
            with patch.object(counts,'module_member_enrolment_ids',reader):
                response=self.client.delete(self.url(),data=json.dumps({'learnerIds':[101]}),content_type='application/json')
            self.assertEqual(response.status_code,503)
            self.assertFalse(lm.LearnerTrainingPlanModule.objects.filter(learner_id=1).exists())
            after=lm.EnrolmentUser.all_learners.get(pk=101)
            self.assertEqual((before.training_plan,before.learning_plan),(after.training_plan,after.learning_plan))
            self.assertIn('101',reader('MOD-TEST'))
            outcomes.append(response.json())
        self.assertEqual(*outcomes)

    def test_learner_forbidden_and_real_session_storage(self):
        account=auth.LoginAccount.objects.create(subject_type='learner',subject_id=101,email='synthetic1@example.invalid',role='learner')
        token,session,_=sessions.issue_session(account)
        client=Client(); client.cookies[sessions.COOKIE_NAME]=token
        self.assertEqual(client.get(self.url()).status_code,403)
        self.assertTrue(auth.LoginSession.objects.filter(pk=session.pk,account=account).exists())

    def test_missing_target_and_missing_zero_bridges(self):
        self.assertIsNone(new_reader('MOD-MISSING'))
        self.assertIsNone(old_reader('MOD-MISSING'))
        self.assertEqual(self.client.get(self.url('MOD-MISSING')).status_code,404)
        for i,bridge in ((8,None),(9,0)):
            lm.LearnerProfile.objects.create(id=i,full_name='Synthetic missing bridge',email=f'bridge{i}@example.invalid',
                enrolment_id=bridge,programme_id='P',cohort_id='C',group_id='G',lifecycle_status='active')
        self.assertEqual(new_reader('MOD-TEST'), {'101','102','104','106'})
        self.assertEqual(new_reader('MOD-TEST'),old_reader('MOD-TEST'))

    def test_normalized_ksb_counts_and_legacy_source_alias(self):
        cm.ModuleAuthoringWeek.objects.create(id='W',module_catalogue_id='MOD-TEST',title='Week')
        cm.ModuleAuthoringComponent.objects.create(id='COMP',week_id='W',module_catalogue_id='MOD-TEST',type='reading',title='Reading')
        with connection.cursor() as c:
            c.execute("INSERT INTO curriculum.standard_ksbs(id,ksb_code,ksb_description) VALUES (1,' K1 ','Synthetic'),(2,'K2','Synthetic')")
            c.execute("UPDATE curriculum.modules SET source_type='training_plan',source_id='legacy-synthetic' WHERE module_catalogue_id='MOD-TEST'")
        for key,status,standard in (('MAP1','active',1),('MAP2','active',1),('MAP3','inactive',2),('MAP4','archived',2)):
            cm.ModuleAuthoringKsbMapping.objects.create(id=key,component_id='COMP',standard_ksb_id=standard,status=status)
        self.assertNotIn('module_catalogue_id',views.column_names('ksb_mappings'))
        lessons,ksbs=views.authoring_module_content_counts()
        self.assertEqual(lessons.get('MOD-TEST'),1)
        self.assertEqual(ksbs.get('MOD-TEST'),1)
        self.assertEqual(views.resolve_stored_module_catalogue_id('legacy-synthetic'),'MOD-TEST')

    def test_first_assignment_mirror_persisted_parity(self):
        outcomes=[]
        for reader in (old_reader,new_reader):
            self.setUp()
            with patch.object(counts,'module_member_enrolment_ids',reader):
                result=self.client.post(self.url(),data=json.dumps({'learnerIds':[105]}),content_type='application/json')
            self.assertEqual(result.status_code,200,result.content)
            self.assertEqual(result.json()['changedCount'],1)
            rows=list(lm.LearnerTrainingPlanModule.objects.filter(learner_id=5).order_by('curriculum_module_id').values_list('curriculum_module_id',flat=True))
            self.assertIn('MOD-TEST',rows)
            user=lm.EnrolmentUser.all_learners.get(pk=105)
            outcomes.append((result.json(),rows,user.training_plan,user.learning_plan,user.modules))
        self.assertEqual(*outcomes)

    def test_legacy_catalogue_alias(self):
        self.assertEqual(views.resolve_stored_module_catalogue_id('catalogue-module-MOD-TEST'),'MOD-TEST')
        self.assertEqual(new_reader('catalogue-module-MOD-TEST'),old_reader('catalogue-module-MOD-TEST'))

    def test_post_delete_persisted_parity(self):
        outcomes=[]
        for reader in (old_reader,new_reader):
            self.setUp()
            cache.clear(); views.cache_state._CURRICULUM_CACHE.clear()
            with patch.object(counts,'module_member_enrolment_ids',reader):
                post=self.client.post(self.url(),data=json.dumps({'learnerIds':[103,102]}),content_type='application/json')
                self.assertEqual(post.status_code,200,post.content)
                self.assertEqual(post.json()['changedCount'],1)
                after_post=list(lm.LearnerTrainingPlanModule.objects.order_by('learner_id','curriculum_module_id').values_list('learner_id','curriculum_module_id'))
                self.assertIn((3,'MOD-TEST'),after_post)
                delete=self.client.delete(self.url(),data=json.dumps({'learnerIds':[103,105]}),content_type='application/json')
                self.assertEqual(delete.status_code,200,delete.content)
                self.assertEqual(delete.json()['changedCount'],1)
                after_delete=list(lm.LearnerTrainingPlanModule.objects.order_by('learner_id','curriculum_module_id').values_list('learner_id','curriculum_module_id'))
                self.assertNotIn((3,'MOD-TEST'),after_delete)
                self.assertIn((3,'MOD-SIBLING'),after_delete)
                outcomes.append((post.json(),delete.json(),after_post,after_delete))
        self.assertEqual(*outcomes)

    def test_writer_failure_rolls_back(self):
        from curriculum_api import module_plan_rows
        original=module_plan_rows.add_module_row
        def fail_after_write(*args,**kwargs):
            original(*args,**kwargs)
            raise RuntimeError('synthetic rollback injection')
        for reader in (old_reader,new_reader):
            self.setUp()
            before=list(lm.LearnerTrainingPlanModule.objects.values_list('id','learner_id','curriculum_module_id'))
            user=lm.EnrolmentUser.all_learners.get(pk=103)
            with patch.object(counts,'module_member_enrolment_ids',reader), patch.object(module_plan_rows,'add_module_row',side_effect=fail_after_write):
                response=self.client.post(self.url(),data=json.dumps({'learnerIds':[103]}),content_type='application/json')
                self.assertTrue(module_plan_rows.add_module_row.called)
            self.assertEqual(response.status_code,503)
            self.assertEqual(list(lm.LearnerTrainingPlanModule.objects.values_list('id','learner_id','curriculum_module_id')),before)
            after=lm.EnrolmentUser.all_learners.get(pk=103)
            self.assertEqual((user.training_plan,user.learning_plan,user.modules),(after.training_plan,after.learning_plan,after.modules))

if __name__=='__main__':
    learning_plans_only = '--learning-plans-only' in sys.argv
    if learning_plans_only:
        sys.argv.remove('--learning-plans-only')
    # Writer parity invokes on_commit cache warming. A delayed worker can outlive
    # its test and consume another test's patched readers. These suites verify
    # synchronous reads/writes, not cache workers; keep background work disabled
    # only in this disposable test process, without changing production settings.
    warm_guard = composition_fixture(views, 'CURRICULUM_WARM_ENABLED', False)
    warm_guard.start()
    try:
        assert not __import__('curriculum_api.catalogue.infrastructure.cache_warming', fromlist=[''])._CURRICULUM_WARM_RUNNING
        print('Background cache warming disabled in isolated test process', flush=True)
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(MembershipIntegration)
        if learning_plans_only:
            learning_plan_cases = (
                'test_directory_scope_actual_orm_membership_manual_and_missing_bridge',
                'test_fact_query_parity_and_profile_narrowing',
                'test_first_assignment_mirror_persisted_parity',
                'test_get_full_compact_ordering_and_parity',
                'test_inherited_delete_mirror_parity',
                'test_inherited_delete_without_recordable_remainder_is_rejected',
                'test_learner_forbidden_and_real_session_storage',
                'test_learning_plan_authorization_and_cross_learner_isolation',
                'test_learning_plan_get_patch_put_contract_and_explicit_empty',
                'test_manual_and_empty_http',
                'test_membership_modes_and_registration_identity',
                'test_missing_target_and_missing_zero_bridges',
                'test_post_delete_persisted_parity',
                'test_unauthenticated',
                'test_writer_failure_rolls_back',
            )
            suite = unittest.TestSuite(
                MembershipIntegration(name) for name in learning_plan_cases
            )
            # The canonical writer suite normally uses the repository's guarded
            # security-branch setting.  This process is more constrained: every
            # database alias targets the disposable loopback-only PostgreSQL
            # container whose identity was asserted above.
            settings.USE_SECURITY_TEST_BRANCH = True
            from learner_api.tests_training_plan_writes_postgres import (
                CanonicalTrainingPlanConcurrencyPostgresTests,
                CanonicalTrainingPlanHistoryProtectionPostgresTests,
                CanonicalTrainingPlanWriterPostgresTests,
            )
            def prepare_training_plan_writer_fixture():
                # MembershipIntegration deliberately resets the shared
                # synthetic catalogue before every test.  Add the minimum
                # hierarchy required by the writer suite after that class has
                # finished, without changing application data or migrations.
                cm.ModuleAuthoringModule.objects.using('enrolment').filter(
                    pk='MOD-SIBLING'
                ).update(programme_id='P2')
                for week_id, order in (('WRITER-W1', 1), ('WRITER-W2', 2)):
                    cm.ModuleAuthoringWeek.objects.using('enrolment').update_or_create(
                        pk=week_id,
                        defaults={
                            'module_catalogue_id': 'MOD-TEST',
                            'week_number': order,
                            'display_order': order,
                        },
                    )
                for component_id, week_id, order in (
                    ('WRITER-C1', 'WRITER-W1', 1),
                    ('WRITER-C2', 'WRITER-W1', 2),
                    ('WRITER-C3', 'WRITER-W2', 1),
                ):
                    cm.ModuleAuthoringComponent.objects.using('enrolment').update_or_create(
                        pk=component_id,
                        defaults={
                            'module_catalogue_id': 'MOD-TEST',
                            'week_id': week_id,
                            'type': 'reading',
                            'display_order': order,
                        },
                    )
                with connections['enrolment'].cursor() as cursor:
                    for table in ('"Learner".learners', 'enrolment."Created_users"'):
                        cursor.execute(
                            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                            f"COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM {table}"
                        )
            suite.addTest(unittest.FunctionTestCase(prepare_training_plan_writer_fixture))
            suite.addTests(
                unittest.defaultTestLoader.loadTestsFromTestCase(
                    CanonicalTrainingPlanWriterPostgresTests
                )
            )
            def prepare_training_plan_history_fixture():
                from learner_api.training_plan_writes import (
                    TrainingPlanAuthorization,
                    reconcile_training_plan,
                )

                dependency_learner = lm.LearnerProfile._base_manager.using(
                    'enrolment'
                ).create(
                    full_name='Synthetic dependency learner',
                    email='history-dependency@example.invalid',
                    phone_number='',
                    lifecycle_status='active',
                    learner_type='commercial',
                    programme_status='',
                )
                dependency_plan = reconcile_training_plan(
                    dependency_learner.id,
                    [{
                        'moduleId': 'MOD-TEST',
                        'weeks': [{
                            'weekId': 'WRITER-W1',
                            'components': [{'componentId': 'WRITER-C1'}],
                        }],
                    }],
                    authorization=TrainingPlanAuthorization.for_staff(),
                )
                dependency_component_id = dependency_plan.plan[0]['weeks'][0][
                    'components'
                ][0]['id']
                lm.LearnerProgressEntry._base_manager.using('enrolment').create(
                    learner_id=dependency_learner.id,
                    plan_component_id=dependency_component_id,
                    entry_order=1,
                    kind='component',
                    component_ref='WRITER-C1',
                    component_title='Synthetic',
                    component_type='reading',
                )

                historical_learner = lm.LearnerProfile._base_manager.using(
                    'enrolment'
                ).create(
                    full_name='Synthetic historical learner',
                    email='history-reparenting@example.invalid',
                    phone_number='',
                    lifecycle_status='active',
                    learner_type='commercial',
                    programme_status='',
                )
                reconcile_training_plan(
                    historical_learner.id,
                    [{
                        'moduleId': 'MOD-TEST',
                        'weeks': [{
                            'weekId': 'WRITER-W2',
                            'components': [{'componentId': 'WRITER-C3'}],
                        }],
                    }],
                    authorization=TrainingPlanAuthorization.for_staff(),
                )
                cm.ModuleAuthoringComponent.objects.using('enrolment').filter(
                    pk='WRITER-C3'
                ).update(week_id='WRITER-W1')

            suite.addTest(unittest.FunctionTestCase(prepare_training_plan_history_fixture))
            suite.addTests(
                unittest.defaultTestLoader.loadTestsFromTestCase(
                    CanonicalTrainingPlanHistoryProtectionPostgresTests
                )
            )
            concurrency_cleanup_guard = {}

            def start_concurrency_cleanup_guard():
                queryset_class = type(
                    lm.LearnerProfile._base_manager.using('enrolment').all()
                )

                def delete_disposable_profiles(queryset):
                    learner_ids = list(queryset.values_list('pk', flat=True))
                    if not learner_ids:
                        return 0, {}
                    with connections[queryset.db].cursor() as cursor:
                        cursor.execute(
                            '''DELETE FROM "Learner".learner_progress_entries
                               WHERE learner_id = ANY(%s)''',
                            [learner_ids],
                        )
                        cursor.execute(
                            '''DELETE FROM "Learner".learner_training_plan_components
                               WHERE plan_week_id IN (
                                   SELECT plan_week.id
                                   FROM "Learner".learner_training_plan_weeks plan_week
                                   JOIN "Learner".learner_training_plan_modules plan_module
                                     ON plan_module.id = plan_week.plan_module_id
                                   WHERE plan_module.learner_id = ANY(%s)
                               )''',
                            [learner_ids],
                        )
                        cursor.execute(
                            '''DELETE FROM "Learner".learner_training_plan_weeks
                               WHERE plan_module_id IN (
                                   SELECT id FROM "Learner".learner_training_plan_modules
                                   WHERE learner_id = ANY(%s)
                               )''',
                            [learner_ids],
                        )
                        cursor.execute(
                            '''DELETE FROM "Learner".learner_training_plan_modules
                               WHERE learner_id = ANY(%s)''',
                            [learner_ids],
                        )
                        cursor.execute(
                            'DELETE FROM "Learner".learners WHERE id = ANY(%s)',
                            [learner_ids],
                        )
                    count = len(learner_ids)
                    return count, {lm.LearnerProfile._meta.label: count}

                guard = patch.object(queryset_class, 'delete', delete_disposable_profiles)
                guard.start()
                concurrency_cleanup_guard['patcher'] = guard

            def stop_concurrency_cleanup_guard():
                concurrency_cleanup_guard.pop('patcher').stop()

            suite.addTest(unittest.FunctionTestCase(start_concurrency_cleanup_guard))
            suite.addTests(
                unittest.defaultTestLoader.loadTestsFromTestCase(
                    CanonicalTrainingPlanConcurrencyPostgresTests
                )
            )
            suite.addTest(unittest.FunctionTestCase(stop_concurrency_cleanup_guard))
            result = unittest.TextTestRunner(verbosity=2).run(suite)
            assert not __import__(
                'curriculum_api.catalogue.infrastructure.cache_warming',
                fromlist=[''],
            )._CURRICULUM_WARM_RUNNING
            if not result.wasSuccessful():
                raise SystemExit(1)
            raise SystemExit(0)
        import runpy
        quality_checks = runpy.run_path(str(Path(__file__).with_name('quality_assets_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(quality_checks['QualityAssetsPostgreSQL']))
        revision_checks = runpy.run_path(str(Path(__file__).with_name('revision_history_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(revision_checks['RevisionHistoryPostgreSQL']))
        schema_checks = runpy.run_path(str(Path(__file__).with_name('schema_reads_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(schema_checks['SchemaReadsPostgreSQL']))
        cache_checks = runpy.run_path(str(Path(__file__).with_name('cache_ownership_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(cache_checks['CacheOwnershipPostgreSQL']))
        hierarchy_checks = runpy.run_path(str(Path(__file__).with_name('hierarchy_commands_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(hierarchy_checks['HierarchyCommandsPostgreSQL']))
        module_checks = runpy.run_path(str(Path(__file__).with_name('module_commands_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(module_checks['ModuleCommandsPostgreSQL']))
        lifecycle_checks = runpy.run_path(str(Path(__file__).with_name('lifecycle_commands_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(lifecycle_checks['LifecycleCommandsPostgreSQL']))
        storage_checks = runpy.run_path(str(Path(__file__).with_name('authoring_storage_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(storage_checks['AuthoringStoragePostgreSQL']))
        content_checks = runpy.run_path(str(Path(__file__).with_name('content_commands_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(content_checks['ContentCommandsPostgreSQL']))
        persistence_checks = runpy.run_path(str(Path(__file__).with_name('row_persistence_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(persistence_checks['RowPersistencePostgreSQL']))
        holiday_checks = runpy.run_path(str(Path(__file__).with_name('holiday_boundary_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(holiday_checks['HolidayBoundaryPostgreSQL']))
        session_editing_checks = runpy.run_path(str(Path(__file__).with_name('session_editing_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(session_editing_checks['SessionEditingPostgreSQL']))
        assignment_checks = runpy.run_path(str(Path(__file__).with_name('assignment_reads_postgresql.py')))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(assignment_checks['AssignmentReadsPostgreSQL']))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        fixture_suite = unittest.TestSuite()
        for module in ('curriculum_api.test_read_consumer_imports_no_db', 'learner_api.test_assignment_read_boundary_no_db', 'learner_api.test_group_preset_relations_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_cache_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_overview_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_read_entry_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_calendar_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_registry_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_runtime_ownership_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(
            'curriculum_api.test_entry_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(
            'curriculum_api.test_placement_names_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(
            'curriculum_api.test_curriculum_names_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(
            'curriculum_api.test_catalogue_content_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(
            'curriculum_api.test_authoring_workspace_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_database_read_composition_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_schema_read_boundary_no_db'))
        for module in ('curriculum_api.test_session_editing_boundary_no_db', 'curriculum_api.test_numbered_session_headers_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_holiday_boundary_no_db',
                       'curriculum_api.test_calendar_holidays_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_row_persistence_boundary_no_db',
                       'curriculum_api.test_content_cache_no_db.MovePreReadTests'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_content_commands_boundary_no_db', 'curriculum_api.test_ksb_mapping_writes_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_authoring_storage_boundary_no_db',
                       'curriculum_api.test_free_course_catalogue_store_no_db',
                       'curriculum_api.test_schema_gate_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_lifecycle_commands_boundary_no_db'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.tests_module_delete_flags.ModuleQuizArchiveTests'))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_module_commands_boundary_no_db'))
        for module in ('curriculum_api.test_hierarchy_commands_boundary_no_db', 'curriculum_api.test_entity_rename_no_db', 'curriculum_api.test_group_coaches_no_db', 'curriculum_api.test_group_list_reads_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_projection_consumer_boundary_no_db'))
        for module in ('curriculum_api.test_revision_history_boundary_no_db', 'curriculum_api.tests_versioning.SnapshotShapeTests'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_quality_assets_boundary_no_db', 'curriculum_api.tests_programme_audit_ui_materials', 'curriculum_api.tests_lean_log.WindowTests'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_home_summary_no_db', 'curriculum_api.test_home_source_no_db',
                       'curriculum_api.test_programme_list_no_db', 'curriculum_api.test_catalogue_reads_no_db',
                       'curriculum_api.test_programme_ksb_source_no_db.StoredSourceReaderTests',
                       'curriculum_api.test_programme_ksb_source_no_db.AppliedProfileTests',
                       'curriculum_api.test_programme_ksb_source_no_db.ProgrammeCardLabelTests',
                       'curriculum_api.test_programme_read_boundary_no_db',
                       'curriculum_api.tests_programme_detail_sections',
                       'curriculum_api.test_programme_modules_workspace_no_db',
                       'curriculum_api.test_programme_workspace_latency_no_db',
                       'curriculum_api.test_programme_workspace_text_no_db',
                       'curriculum_api.test_module_read_boundary_no_db',
                       'curriculum_api.test_curriculum_projection_performance_no_db.CurriculumProjectionPerformanceTests.test_programme_detail_enrichment_omits_heavy_component_content',
                       'curriculum_api.test_curriculum_projection_performance_no_db.CurriculumProjectionPerformanceTests.test_programme_authoring_modules_omits_heavy_component_content',
                       'curriculum_api.test_module_builder_latency_no_db.GroupedCatalogueTests',
                       'curriculum_api.test_module_builder_latency_no_db.ModuleListVisibilityTests',
                       'curriculum_api.test_http_cache_no_db.WeekOutlineTests',
                       'curriculum_api.test_delivery_read_boundary_no_db',
                       'curriculum_api.test_shared_reads_no_db.SharedParentReadTests',
                       'curriculum_api.test_shared_reads_no_db.SharedWeekIndexTests',
                       'curriculum_api.test_authoring_read_boundary_no_db',
                       'curriculum_api.test_structure_read_boundary_no_db',
                       'curriculum_api.test_structure_transport_no_db',
                       'curriculum_api.test_http_cache_no_db.PagedComponentReadTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammeViewSqlTests.test_content_mode_is_unchanged',
                       'curriculum_api.test_component_catalogue_boundary_no_db',
                       'curriculum_api.test_read_adapters_boundary_no_db',
                       'curriculum_api.test_authoring_row_cache_no_db',
                       'curriculum_api.test_transport_boundary_no_db',
                       'curriculum_api.test_revision_boundary_no_db',
                       'curriculum_api.test_record_revision_boundary_no_db',
                       'curriculum_api.test_week_template_read_boundary_no_db',
                       'curriculum_api.test_placement_record_boundary_no_db',
                       'curriculum_api.test_cohort_calendar_boundary_no_db',
                       'curriculum_api.test_inherited_calendar_boundary_no_db',
                       'curriculum_api.tests_holiday_reading_weeks',
                       'curriculum_api.test_session_plan_boundary_no_db',
                       'curriculum_api.test_delivery_schedule_boundary_no_db',
                       'curriculum_api.test_tutor_availability_roster_no_db',
                       'curriculum_api.test_tutor_availability_boundary_no_db',
                       'curriculum_api.test_staff_profiles_boundary_no_db',
                       'curriculum_api.test_staff_assignment_reads_no_db',
                       'curriculum_api.test_statistics_boundary_no_db',
                       'curriculum_api.test_programme_ksb_source_no_db.CoverageSourceTests',
                       'curriculum_api.test_programme_ksb_source_no_db.AchievementSourceTests',
                       'curriculum_api.test_ksb_mapping_placement_no_db.StatsReadTests',
                       'curriculum_api.test_report_delivery_boundary_no_db',
                       'curriculum_api.test_ksb_coverage_parts_no_db',
                       'curriculum_api.test_coverage_summary_no_db',
                       'curriculum_api.test_coverage_mapped_components_no_db',
                       'curriculum_api.test_ksb_stats_latency_no_db',
                       'curriculum_api.test_programme_ksb_design_cache_no_db',
                       'curriculum_api.test_reporting_boundary_no_db',
                       'curriculum_api.tests_ksb_achievement',
                       'curriculum_api.tests_scope_achievement',
                       'curriculum_api.test_achievement_performance_no_db',
                       'curriculum_api.test_session_enrichment_boundary_no_db',
                       'curriculum_api.test_module_workspace_boundary_no_db',
                       'curriculum_api.test_programme_sources_no_db',
                       'curriculum_api.test_ksb_identity_boundary_no_db',
                       'curriculum_api.test_module_get_boundary_no_db',
                       'curriculum_api.test_assignment_settings_schema_no_db',
                       'curriculum_api.test_calendar_convergence_no_db',
                       'curriculum_api.test_delivery_dashboard_no_db',
                       'curriculum_api.tests_delivery_calendar_projection',
                       'curriculum_api.tests_authored_live_sessions.AuthoredSourceOnlyTests',
                       'curriculum_api.test_overview_boundary_no_db',
                       'curriculum_api.test_bulk_attendance_overview_no_db',
                       'curriculum_api.test_curriculum_read_model_no_db',
                       'curriculum_api.test_session_plan_first_delivery_week_no_db',
                       'curriculum_api.test_custom_weekly_schedule_no_db.CustomWeeklyScheduleTests.test_custom_week_begins_with_its_first_live_session_across_sunday',
                       'curriculum_api.test_custom_weekly_schedule_no_db.CustomWeeklyScheduleTests.test_custom_components_stop_at_the_explicit_end_date',
                       'curriculum_api.test_custom_weekly_schedule_no_db.CustomWeeklyScheduleTests.test_custom_tutor_dates_stay_within_the_authored_weeks',
                       'curriculum_api.test_custom_weekly_schedule_no_db.CustomWeeklyScheduleTests.test_existing_custom_modules_without_the_new_marker_keep_their_calendar_weeks',
                       'curriculum_api.test_shared_reads_no_db.HolidayReadScopeTests',
                       'curriculum_api.test_authoring_placement_names_no_db.DerivedPlacementNamesSqlTests',
                       'curriculum_api.test_authoring_placement_names_no_db.DerivedPlacementNamesExecutionTests',
                       'curriculum_api.test_programme_modules_read_path_no_db.PrefetchTests',
                       'curriculum_api.test_programme_modules_read_path_no_db.PrefetchMatchesTheReadsTests',
                       'curriculum_api.test_ksb_description_deferred_no_db.DeferredRelationTests.test_curriculum_select_defers_it_and_keeps_the_key_it_is_looked_up_by',
                       'curriculum_api.test_unified_reader_no_db',
                       'curriculum_api.test_component_programme_view_no_db.ComponentSummaryKsbCodesTests',
                       'curriculum_api.test_component_summary_no_db.ComponentSummaryTests',
                       'curriculum_api.test_component_summary_no_db.ComponentSummaryViewTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammeViewEndpointTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammeViewExcludedColumnsSqlTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_keeps_only_the_page_settings_including_empty_ones_and_marks_the_row',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_a_row_that_loses_nothing_is_returned_as_it_is',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_what_the_database_stripped_marks_the_row_even_if_nothing_is_left_to_trim',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_never_edits_the_cached_row',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_a_marked_row_is_refused_on_save_before_any_database_read',
                       ):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_cache_ownership_boundary_no_db', 'curriculum_api.test_cache_scope_no_db.ProgrammeGenerationTests', 'curriculum_api.test_cache_scope_no_db.MiddlewareScopeTests', 'curriculum_api.test_cache_scope_no_db.BumpTests', 'curriculum_api.test_cache_scope_no_db.BumpFailureTests', 'curriculum_api.test_cache_scope_no_db.WriteOutsideRequestTests', 'curriculum_api.test_read_runtime_boundary_no_db', 'curriculum_api.test_cache_latency_no_db', 'curriculum_api.test_cache_scope_no_db.ScopedCacheTests', 'curriculum_api.test_cache_scope_no_db.TwoWorkerTests', 'curriculum_api.test_cache_scope_no_db.LearnerFreshnessTests', 'curriculum_api.test_http_cache_no_db.CachedValueSingleFlightTests', 'curriculum_api.test_programme_modules_read_path_no_db.ForcedReadSharingTests', 'curriculum_api.test_shared_reads_no_db.LearnerSchemaCacheTests', 'curriculum_api.test_component_summary_no_db.ArchivedCohortsTests', 'curriculum_api.test_component_summary_no_db.ArchivedModuleComponentCountTests', 'curriculum_api.test_archive_index_no_db'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_directory_workspace_boundary_no_db', 'curriculum_api.tests_learner_directory', 'curriculum_api.test_learner_directory_details_no_db.DirectoryDetailsEndpointTests', 'curriculum_api.test_learner_directory_details_no_db.DirectoryActivitySummaryTests.test_future_completion_does_not_mask_overdue_work_and_each_denominator_is_independent', 'curriculum_api.test_learner_directory_details_no_db.DirectoryActivitySummaryTests.test_explicit_end_of_week_deadlines_and_real_delivery_week_dates', 'curriculum_api.test_learner_directory_details_no_db.DirectoryActivitySummaryTests.test_missing_or_ambiguous_dates_are_not_reported_as_a_complete_or_zero_target', 'curriculum_api.test_learner_directory_details_no_db.DirectoryActivitySummaryTests.test_empty_future_and_explicitly_unscheduled_content_have_no_false_percentage', 'curriculum_api.test_learner_directory_details_no_db.DirectoryActivitySummaryTests.test_exact_module_links_include_imports_and_exclude_other_groups'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        for module in ('curriculum_api.test_hierarchy_preparation_boundary_no_db', 'curriculum_api.test_attachment_preparation_boundary_no_db', 'curriculum_api.test_content_validation_boundary_no_db', 'curriculum_api.test_http_cache_no_db.PartialReadSaveGuardTests', 'curriculum_api.test_progress_membership_boundary_no_db', 'curriculum_api.test_learner_status_counts_no_db', 'curriculum_api.test_learner_status_count_performance_no_db', 'curriculum_api.test_learner_placement_joins_no_db', 'learner_api.test_manual_roster_mode_no_db', 'curriculum_api.tests_learner_assignments.AssignmentTests', 'curriculum_api.tests_learner_assignments.AssignmentEndpointTests', 'curriculum_api.tests_learner_assignments.ModuleRosterTests'):
            fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
        fixture_suite.addTests(unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_required_read_failures_no_db'))
        # Existing DB-free fixtures mock generic authoring reads. Individual
        # PostgreSQL-specific cases still select their own vendor explicitly.
        # SimpleTestCase continues to forbid every database operation.
        with patch.object(connection, 'vendor', 'sqlite'):
            fixture_result = unittest.TextTestRunner(verbosity=2).run(fixture_suite)
        if not fixture_result.wasSuccessful():
            # Diagnose against frozen pre-extraction implementations without
            # weakening any existing assertion or hiding a failing result.
            original_suite = unittest.TestSuite()
            for module in ('curriculum_api.test_home_summary_no_db', 'curriculum_api.test_home_source_no_db',
                           'curriculum_api.test_programme_list_no_db', 'curriculum_api.test_catalogue_reads_no_db',
                       'curriculum_api.test_programme_ksb_source_no_db.StoredSourceReaderTests',
                       'curriculum_api.test_programme_ksb_source_no_db.AppliedProfileTests',
                       'curriculum_api.test_programme_ksb_source_no_db.ProgrammeCardLabelTests',
                       'curriculum_api.test_programme_read_boundary_no_db',
                       'curriculum_api.tests_programme_detail_sections',
                       'curriculum_api.test_programme_modules_workspace_no_db',
                       'curriculum_api.test_programme_workspace_latency_no_db',
                       'curriculum_api.test_programme_workspace_text_no_db',
                       'curriculum_api.test_module_read_boundary_no_db',
                       'curriculum_api.test_curriculum_projection_performance_no_db.CurriculumProjectionPerformanceTests.test_programme_detail_enrichment_omits_heavy_component_content',
                       'curriculum_api.test_curriculum_projection_performance_no_db.CurriculumProjectionPerformanceTests.test_programme_authoring_modules_omits_heavy_component_content',
                       'curriculum_api.test_module_builder_latency_no_db.GroupedCatalogueTests',
                       'curriculum_api.test_module_builder_latency_no_db.ModuleListVisibilityTests',
                       'curriculum_api.test_http_cache_no_db.WeekOutlineTests',
                       'curriculum_api.test_delivery_read_boundary_no_db',
                       'curriculum_api.test_shared_reads_no_db.SharedParentReadTests',
                       'curriculum_api.test_shared_reads_no_db.SharedWeekIndexTests',
                       'curriculum_api.test_authoring_read_boundary_no_db',
                       'curriculum_api.test_structure_read_boundary_no_db',
                       'curriculum_api.test_structure_transport_no_db',
                       'curriculum_api.test_http_cache_no_db.PagedComponentReadTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammeViewSqlTests.test_content_mode_is_unchanged',
                       'curriculum_api.test_component_catalogue_boundary_no_db',
                       'curriculum_api.test_read_adapters_boundary_no_db',
                       'curriculum_api.test_authoring_row_cache_no_db',
                       'curriculum_api.test_transport_boundary_no_db',
                       'curriculum_api.test_authoring_placement_names_no_db.DerivedPlacementNamesSqlTests',
                       'curriculum_api.test_authoring_placement_names_no_db.DerivedPlacementNamesExecutionTests',
                       'curriculum_api.test_programme_modules_read_path_no_db.PrefetchTests',
                       'curriculum_api.test_programme_modules_read_path_no_db.PrefetchMatchesTheReadsTests',
                       'curriculum_api.test_ksb_description_deferred_no_db.DeferredRelationTests.test_curriculum_select_defers_it_and_keeps_the_key_it_is_looked_up_by',
                       'curriculum_api.test_unified_reader_no_db',
                       'curriculum_api.test_component_programme_view_no_db.ComponentSummaryKsbCodesTests',
                       'curriculum_api.test_component_summary_no_db.ComponentSummaryTests',
                       'curriculum_api.test_component_summary_no_db.ComponentSummaryViewTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammeViewEndpointTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammeViewExcludedColumnsSqlTests',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_keeps_only_the_page_settings_including_empty_ones_and_marks_the_row',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_a_row_that_loses_nothing_is_returned_as_it_is',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_what_the_database_stripped_marks_the_row_even_if_nothing_is_left_to_trim',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_never_edits_the_cached_row',
                       'curriculum_api.test_component_programme_view_no_db.ProgrammePageProjectionTests.test_a_marked_row_is_refused_on_save_before_any_database_read',
                       ):
                original_suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
            print('PRE-BATCH03 ORACLE: existing fixture suite', flush=True)
            with legacy_catalogue(), patch.object(connection, 'vendor', 'sqlite'):
                original_result = unittest.TextTestRunner(verbosity=2).run(original_suite)
            def failures(result):
                return sorted((test.id(), trace.splitlines()[-1])
                              for test, trace in result.failures + result.errors)
            print('PRE/POST failure signatures equal:', failures(original_result) == failures(fixture_result), flush=True)
            # Current batch oracle: restore exactly the 13 pre-module-read bodies.
            from curriculum_api.test_module_read_boundary_no_db import original_module_reads
            failed_names = [test.id() for test, _trace in fixture_result.failures + fixture_result.errors
                            if '.test_module_read_boundary_no_db.' not in test.id()]
            pre_module_suite = unittest.TestSuite(
                unittest.defaultTestLoader.loadTestsFromName(name) for name in failed_names)
            print('PRE-MODULE-READ BATCH ORACLE: failing cases only', flush=True)
            with original_module_reads(), patch.object(connection, 'vendor', 'sqlite'):
                pre_module_result = unittest.TextTestRunner(verbosity=2).run(pre_module_suite)
            print('PRE-MODULE/POST failure signatures equal:',
                  failures(pre_module_result) == failures(fixture_result), flush=True)
        assert not __import__('curriculum_api.catalogue.infrastructure.cache_warming', fromlist=[''])._CURRICULUM_WARM_RUNNING
        if not (result.wasSuccessful() and fixture_result.wasSuccessful()):
            raise SystemExit(1)
    finally:
        warm_guard.stop()
        connections.close_all()
