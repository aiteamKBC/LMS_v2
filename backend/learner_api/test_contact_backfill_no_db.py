"""Pure manifest guards, cache scopes and existing first-login regression suite.

Minimal Django with dummy databases; project app startup is never invoked.
Existing first-login source and tests run with explicit identity/ORM seams.
"""
import sys
from pathlib import Path
sys.path[0] = str(Path(__file__).resolve().parent.parent)

import ast
import functools
import json
import logging
import re
from datetime import date
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4

from learner_api.services import contact_sync, contact_backfill
from learner_api.services.identity_reconciliation import IdentityReconciliationError


class ManifestTests(unittest.TestCase):
    def test_contact_writer_pins_alias_and_only_requested_fields(self):
        from contextlib import nullcontext
        uid = uuid4()
        cursor = Mock()
        cursor.fetchone.return_value = (uid,)
        connection = Mock()
        connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
        connection.cursor.return_value.__exit__ = Mock(return_value=False)
        user = NS(pk=71, uuid=uid, _state=NS(db='enrolment'), save=Mock())
        with patch('django.db.connections', {'enrolment': connection}), \
                patch('django.db.transaction.atomic', return_value=nullcontext()), \
                patch.object(contact_sync, 'sync_contacts_in_transaction') as reconcile:
            contact_sync.save_verified_contact_fields(user, ['username'])
        user.save.assert_called_once_with(using='enrolment', update_fields=['username'])
        reconcile.assert_called_once_with(71, using='enrolment')

    def test_contact_writer_rejects_wrong_alias_and_mixed_fields(self):
        from django.db import DatabaseError
        user = NS(pk=71, uuid=uuid4(), _state=NS(db='other'), save=Mock())
        for fields in (['username'], ['username', 'email'], []):
            with self.assertRaises(DatabaseError):
                contact_sync.save_verified_contact_fields(user, fields)
        user.save.assert_not_called()

    def test_contact_only_dispatch_and_date_path_stays_unchanged(self):
        from contextlib import nullcontext
        from unittest.mock import Mock
        namespace = dict(DATE_FIELDS=('learner_start_date', 'learner_end_date'),
                         transaction=NS(atomic=lambda **kwargs: nullcontext()),
                         save_verified_contact_fields=Mock(), learner_profile_for_source=Mock(return_value=None))
        path = Path(__file__).parent / 'learner_dates.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
        source = NS(save=Mock(), learner_start_date='2030-01-01', learner_end_date=None)
        namespace['save_enrolment_fields'](source, {'phone_number': '123'})
        namespace['save_verified_contact_fields'].assert_called_once_with(source, {'phone_number': '123'})
        source.save.assert_not_called()
        namespace['save_enrolment_fields'](source, {'learner_start_date': '2030-01-01'})
        source.save.assert_called_once_with(update_fields=['learner_start_date'])
        namespace['learner_profile_for_source'].assert_called_once_with(source)

    def test_duplicate_allowlist_rejected_before_query(self):
        cursor = Mock()
        for key in ('source_id', 'profile_id', 'uuid'):
            first = dict(source_id=1, profile_id=2, uuid=str(uuid4()))
            second = dict(source_id=3, profile_id=4, uuid=str(uuid4()))
            second[key] = first[key]
            with self.assertRaises(IdentityReconciliationError):
                contact_backfill.run_manifest(cursor, dict(version=1, rows=[first, second]))
        cursor.execute.assert_not_called()

    def test_cache_scopes_are_identity_scoped_and_include_monitor(self):
        cursor = Mock()
        cursor.fetchall.return_value = [('apprenticeship', ' Coach@example.test ')]
        self.assertEqual(contact_sync.contact_refresh_scopes(cursor, 71), [
            ('learner.home', 'learner', 'apprenticeship:71'),
            ('record.monitor', 'record-monitor', 'global'),
            ('coach.dashboard', 'coach', 'coach@example.test')])

    def test_unverified_cache_resolution_refused(self):
        cursor = Mock()
        cursor.fetchone.return_value = (False, True)
        with self.assertRaises(IdentityReconciliationError):
            contact_sync.publish_contact_refresh(cursor, 71)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_blank_source_kind_preserves_first_login_apprenticeship_default(self):
        cursor = Mock()
        cursor.fetchall.return_value = [(None, None)]
        self.assertEqual(contact_sync.contact_refresh_scopes(cursor, 71)[0],
                         ('learner.home', 'learner', 'apprenticeship:71'))


def load_first_login_tests():
    from django.conf import settings
    settings.configure(SECRET_KEY='synthetic', INSTALLED_APPS=[], DATABASES={}, USE_TZ=True,
                       ALLOWED_HOSTS=['testserver'], DEFAULT_CHARSET='utf-8')
    import django
    django.setup()
    from django.db import DatabaseError, connections, transaction
    from django.http import JsonResponse
    from django.middleware.csrf import get_token
    from django.utils import timezone
    from django.views.decorators.csrf import csrf_protect
    from django.views.decorators.http import require_http_methods

    root = Path(__file__).resolve().parent.parent
    permissions = ModuleType('login.permissions')
    permissions.__dict__.update(functools=functools, JsonResponse=JsonResponse,
        authenticate_request=Mock(), _auth_gate_enabled=lambda: True,
        _read_only_learner_view=lambda: JsonResponse({'error': 'Forbidden'}, status=403),
        _unauthenticated=lambda request: JsonResponse({'error': 'Authentication required'}, status=401))
    tree = ast.parse((root / 'login/permissions.py').read_text(encoding='utf-8'))
    names = {'learner_self_only', '_learner_progress_gate', '_target_learner_id', '_error_bad_target'}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'login/permissions.py', 'exec'), permissions.__dict__)
    sys.modules['login.permissions'] = permissions
    import login
    login.permissions = permissions

    module = ModuleType('learner_api.first_login_details')
    module.__dict__.update(json=json, logging=logging, re=re, date=date, DatabaseError=DatabaseError,
        connections=connections, transaction=transaction, JsonResponse=JsonResponse, get_token=get_token,
        timezone=timezone, csrf_protect=csrf_protect, require_http_methods=require_http_methods,
        learner_self_only=permissions.learner_self_only, EnrolmentUser=Mock(),
        _s=lambda value: '' if value is None else str(value).strip(),
        DEFAULT_PROGRAMME_STATUS='Fresh user', programme_status=lambda row: row.programme_status,
        sync_contacts_in_transaction=contact_sync.sync_contacts_in_transaction)
    tree = ast.parse((root / 'learner_api/first_login_details.py').read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if not isinstance(n, (ast.Import, ast.ImportFrom))]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'first_login_details.py', 'exec'), module.__dict__)
    sys.modules[module.__name__] = module
    import learner_api
    learner_api.first_login_details = module
    from learner_api import tests_first_login_details
    return unittest.defaultTestLoader.loadTestsFromModule(tests_first_login_details)


if __name__ == '__main__':
    def guard(event, args):
        if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system'}:
            raise RuntimeError('External IO forbidden')
        if event == 'open' and Path(str(args[0])).name.startswith('.env'):
            raise RuntimeError('Environment files forbidden')
    sys.addaudithook(guard)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ManifestTests)
    suite.addTests(load_first_login_tests())
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
