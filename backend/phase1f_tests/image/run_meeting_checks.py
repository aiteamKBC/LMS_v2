"""Opt-in local Teams checks in a credential-free, network-none Docker image."""
import ast
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_import_smoke as bundler

STANDALONE = (
    'meetings.tests.test_calendar_checks_no_db', 'meetings.tests.test_teams_attachment_no_db',
    'meetings.tests.test_teams_notification_rules_no_db',
    'meetings.tests.test_teams_update_preservation', 'meetings.tests.test_teams_external_calendar_no_db',
    'meetings.tests.test_teams_create_guard_no_db', 'meetings.tests.test_teams_endpoint_guard_no_db',
    'meetings.tests.test_teams_imported_meeting_edit_no_db', 'meetings.tests.test_teams_imported_calendar_update_no_db',
    'meetings.tests.test_teams_presenter_roles_no_db', 'meetings.tests.test_teams_meeting_options_no_db',
    'meetings.tests.test_session_results_no_db', 'meetings.tests.test_schedule_email_no_db',
    'meetings.tests.test_lifecycle_contracts_standalone',
    'meetings.tests.test_lifecycle_behavior_parity',
    'meetings.tests.test_policy_composition_standalone',
    'meetings.tests.test_attendee_compare_no_db', 'meetings.tests.test_occurrence_pairing_no_db',
    'meetings.tests.test_occurrence_deletion_no_db', 'meetings.tests.test_no_auto_cancel_no_db',
    'meetings.tests.test_session_sync_runtime_no_db',
    'meetings.tests.test_session_content_provider_no_db', 'meetings.tests.test_session_media_no_db',
    'meetings.tests.test_behavior_parity', 'meetings.tests.test_contracts_standalone',
    'meetings.tests.test_delivery_contracts_standalone',
    'meetings.tests.test_delivery_behavior_parity',
    'meetings.tests.test_calendar_contracts_standalone',
    'meetings.tests.test_calendar_behavior_parity', 'meetings.tests.test_live_session_meeting_scope_no_db',
)
DJANGO = (
    'curriculum_api.catalogue.tests.test_study_weeks_no_db',
    'curriculum_api.meetings.tests.test_study_calendar_limits_no_db',
    'curriculum_api.meetings.tests.test_study_week_teams_no_db',
    'curriculum_api.catalogue.tests.test_module_week_start_no_db',
    'curriculum_api.catalogue.tests.test_module_week_count_patch_no_db',
    'curriculum_api.catalogue.tests.test_custom_weekly_schedule_no_db',
    'curriculum_api.meetings.tests.test_session_downloads_no_db',
    'curriculum_api.meetings.tests.test_teams_options_retry_no_db',
    'curriculum_api.tests.TeamsMultiDayRecurrenceTests',
    'curriculum_api.tests.TeamsAttendanceRosterTests',
    'curriculum_api.meetings.tests.test_teams_original_calendar',
    'curriculum_api.meetings.tests.test_teams_imported_meeting_edit_http',
    'curriculum_api.meetings.tests.test_teams_people_refresh_no_db',
)

def meeting_bundle():
    bundler.TARGETS += ['curriculum_api.' + n for n in STANDALONE] + [n.rsplit('.',1)[0] if n.endswith('Tests') else n for n in DJANGO]
    bundler.TARGETS += ['curriculum_api.meetings.tests.test_schedule_email_no_db']
    bundler.TARGETS += ['curriculum_api.catalogue.tests.tests_study_weeks', 'curriculum_api.catalogue.tests.tests_module_weekly_schedule']
    bundler.TARGETS += ['curriculum_api.meetings.tests.invitees_postgresql']
    bundler.TARGETS += ['curriculum_api.meetings.tests.test_calendar_state_no_db',
                        'curriculum_api.meetings.tests.test_calendar_actions_no_db']
    bundler.TARGETS += ['curriculum_api.meetings.tests.test_teams_delivery_sync',
        'curriculum_api.management.commands.sync_teams_meeting_artifacts',
        'learner_api.personal_learning_reads']
    # Include statically reachable lazy imports as source, without executing them.
    bundler.TARGETS += ['curriculum_api.urls','curriculum_api.session_archive','curriculum_api.teams_endpoint_guard','curriculum_api.catalogue.tests.parity.read_dependencies_oracle']
    pending = list(bundler.TARGETS)
    seen = set()
    while pending:
        module = pending.pop()
        path = bundler.source(module)
        if module in seen or not path.is_file():
            continue
        seen.add(module)
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8-sig'))):
            if isinstance(node, ast.Import):
                pending.extend(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                base = node.module or ''
                if node.level:
                    parts = module.split('.') if path.name == '__init__.py' else module.split('.')[:-1]
                    base = '.'.join(parts[:len(parts)-node.level+1] + ([base] if base else []))
                pending.extend([base] + [base + '.' + a.name for a in node.names])
    bundler.TARGETS += sorted(seen)
    payload = bundler.bundle()
    output = io.BytesIO()
    with tarfile.open(fileobj=output,mode='w') as archive, tarfile.open(fileobj=io.BytesIO(payload)) as old:
        for item in old:
            archive.addfile(item,old.extractfile(item) if item.isfile() else None)
        browser_source = 'frontend/src/pages/curriculum/module-builder/moduleAuthoringData.ts'
        archive.add(bundler.BACKEND.parent / browser_source,arcname='phase1f/' + browser_source)
        for script in ('meeting_checks.py','meeting_postgresql.py'):
            archive.add(Path(__file__).with_name(script),arcname='phase1f/' + script)
        for name in ('teams_schedule_email.html', 'kbc-logo.png'):
            relative = 'curriculum_api/templates/' + name
            archive.add(bundler.BACKEND / relative, arcname='phase1f/backend/' + relative)
        for name in ('database_reads_snapshot.json', 'read_dependencies_snapshot.json', 'session_editing_snapshot.json'):
            relative = 'curriculum_api/catalogue/tests/fixtures/legacy_snapshots/' + name
            archive.add(bundler.BACKEND / relative, arcname='phase1f/backend/' + relative)
        for name in ('session_results_archive.sql','teams_calendar_create_claims.sql','teams_calendar_create_drafts.sql','teams_schedule_emails.sql','2026-10-08_teams_calendar_integrity_events.sql','module_session_overrides.sql'):
            archive.add(bundler.BACKEND / 'sql' / name, arcname='phase1f/backend/sql/' + name)
    return output.getvalue()

def main():
    cases = [('standalone', 'curriculum_api.' + n) for n in STANDALONE] + [('django', n) for n in DJANGO]
    # Optional explicit target selection is for diagnosis, not a reduced acceptance suite.
    if len(sys.argv) > 1:
        cases = [c for c in cases if any(x in c[1] for x in sys.argv[1:])]
        assert cases, 'No matching reviewed tests'
    payload = meeting_bundle()
    name='lms-phase1f-meetings-'+uuid.uuid4().hex[:10]
    failed=[]
    try:
        subprocess.run(['docker','run','-d','--name',name,'--network','none','--read-only','--tmpfs','/tmp',
            '--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','sleep','lms-phase1f-python:3.14.3','infinity'],check=True)
        subprocess.run(['docker','inspect',name,'--format','{{.HostConfig.NetworkMode}} mounts={{json .Mounts}} ports={{json .HostConfig.PortBindings}}'],check=True)
        subprocess.run(['docker','exec','-i',name,'tar','-xf','-','-C','/tmp'],input=payload,check=True)
        for mode,target in cases:
            print('MEETING_SUITE',mode,target,flush=True)
            result=subprocess.run(['docker','exec',name,'python','-I','-B','/tmp/phase1f/meeting_checks.py',mode,target])
            if result.returncode:failed.append(target)
    finally:
        subprocess.run(['docker','rm','-f',name],check=False)
    print('FAILED_SUITES',failed,flush=True)
    return bool(failed)
if __name__=='__main__':
    sys.exit(main())
