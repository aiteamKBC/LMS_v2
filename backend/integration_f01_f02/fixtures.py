"""Lazy synthetic ORM factories; no fixture is inserted on import.

Receipts are exact model/PK identities. Callers keep committed race fixtures
on the disposable database if cleanup cannot be proven; never flush it.
"""
from dataclasses import dataclass
from uuid import uuid4
from .bootstrap import require_active

PASSWORD = 'Synthetic-Harbour-92!'
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
REGISTRY = []


def plan(namespace, title='Synthetic module'):
    return [{'moduleId': namespace + '-M', 'moduleTitle': title, 'weeks': [
        {'weekId': namespace + '-W', 'weekTitle': 'Synthetic week', 'components': [
            {'componentId': namespace + '-C', 'componentTitle': 'Synthetic reading'}]}]}]


@dataclass
class Learner:
    source: object
    profile: object
    account: object


class Fixtures:
    def __init__(self, run_id):
        require_active()
        self.namespace = run_id + '_' + uuid4().hex
        self.receipts = []
        self.evidence_receipts = []
        self.group_receipts = []
        self.journal = []
        self._catalogue = None
        REGISTRY.append(self)

    def create(self, model, **values):
        require_active()
        manager = getattr(model, 'all_learners', model.objects)
        obj = manager.using('enrolment').create(**values)
        self.receipts.append((model, obj.pk))
        self.journal.append({'table': model._meta.db_table, 'pk': str(obj.pk), 'action': 'created'})
        return obj

    def account(self, subject_type, subject):
        from login.identity import ensure_account
        from login.security import hash_password
        from django.utils import timezone
        account, created = ensure_account(subject_type, subject.pk, subject=subject)
        if not created:
            raise AssertionError('Synthetic fixture unexpectedly reused an account')
        account.password_hash = hash_password(PASSWORD)
        account.password_set_at = timezone.now()
        account.save(using='enrolment')
        self.receipts.append((type(account), account.pk))
        self.journal.append({'table': account._meta.db_table, 'pk': str(account.pk), 'action': 'created'})
        return account

    def learner(self, kind='commercial', selection='empty', employer=None):
        from learner_api.models import EnrolmentUser, LearnerProfile
        if kind not in {'commercial', 'apprenticeship'} or selection not in {'manual', 'inherited', 'empty'}:
            raise ValueError('Unknown synthetic learner variant')
        uid = uuid4()
        email = f'{self.namespace}-{uid.hex}@example.invalid'
        source = self.create(EnrolmentUser, uuid=uid, learner_type=kind,
            username=self.namespace, email=email, phone_number='07700900123',
            programme_status='Fresh user', status='Active',
            learning_plan=plan(self.namespace) if selection == 'manual' else ([] if selection == 'empty' else None),
            employer_id=employer.pk if employer else None)
        profile = self.create(LearnerProfile, uuid=uid, enrolment_id=source.pk,
            full_name=self.namespace, email=email, learner_type=kind, lifecycle_status='active')
        if profile.pk == source.pk:
            # Do not silently accept a fixture that fails to expose ID confusion.
            raise AssertionError('Preprovision distinct source/profile sequence ranges')
        result = Learner(source, profile, self.account('learner', source))
        if selection == 'inherited':
            self.inherited_group(result)
        return result

    def staff(self, primary='enrolment', additional=''):
        from learner_api.models import StaffUser
        subject = self.create(StaffUser, username=self.namespace,
            email=f'{uuid4().hex}@example.invalid', access=primary,
            access_extra=additional, position='Synthetic officer', type='Admin', status='FullUser')
        return subject, self.account('staff', subject)

    def employer(self):
        from learner_api.models import Employer
        subject = self.create(Employer, first_name=self.namespace, surname='Synthetic',
                              email=f'{uuid4().hex}@example.invalid')
        return subject, self.account('employer', subject)

    def session(self, account, state='active'):
        from datetime import timedelta
        from django.utils import timezone
        from login.models import LoginSession
        from login.security import hash_token
        if state not in {'active', 'expired', 'revoked'}:
            raise ValueError(state)
        token = uuid4().hex + uuid4().hex
        now = timezone.now()
        row = self.create(LoginSession, account=account, token_hash=hash_token(token),
            expires_at=now + timedelta(hours=-1 if state == 'expired' else 1),
            revoked_at=now if state == 'revoked' else None)
        return row, token

    def graph(self, learner):
        from learner_api.models import LearnerTrainingPlanModule, LearnerTrainingPlanWeek, LearnerTrainingPlanComponent
        module = self.create(LearnerTrainingPlanModule, learner=learner.profile,
            position=0, module_ref=self.namespace+'-M', module_title='Synthetic module')
        week = self.create(LearnerTrainingPlanWeek, plan_module=module, position=0,
                           week_ref=self.namespace+'-W', week_title='Synthetic week')
        component = self.create(LearnerTrainingPlanComponent, plan_week=week, position=0,
            component_ref=self.namespace+'-C', component_title='Synthetic reading')
        return module, week, component

    def catalogue(self):
        from curriculum_api.models import ModuleAuthoringModule
        if self._catalogue is not None:
            return self._catalogue
        self._catalogue = self.create(ModuleAuthoringModule, module_catalogue_id=self.namespace+'-M',
            title='Synthetic module', programme_id=self.namespace+'-P', programme_name=self.namespace,
            cohort_id=self.namespace+'-CO', cohort_name=self.namespace,
            group_id=self.namespace+'-G', group_name=self.namespace, total_otjh=1)
        return self._catalogue

    def inherited_group(self, learner):
        import json
        from django.db import connections
        module = self.catalogue()
        group_id = self.namespace+'-G'
        with connections['enrolment'].cursor() as cur:
            cur.execute('INSERT INTO curriculum.groups '
                '(group_id,group_name,programme_id,programme_name,cohort_id,cohort_name,module_ids) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb)',
                [group_id, self.namespace, self.namespace+'-P', self.namespace,
                 self.namespace+'-CO', self.namespace, json.dumps([module.pk])])
        self.group_receipts.append(group_id)
        self.journal.append({'table': 'curriculum.groups', 'pk': group_id, 'action': 'created'})
        learner.source.programme = learner.source.cohort = learner.source.group = self.namespace
        learner.source.save(using='enrolment', update_fields=['programme', 'cohort', 'group'])
        return group_id, module

    def history(self, learner, component):
        # The physical FK is absent from the legacy ORM. Explicit SQL preserves it.
        from django.db import connections
        with connections['enrolment'].cursor() as cur:
            cur.execute('INSERT INTO "Learner".learner_progress_entries '
                '(learner_id,entry_order,kind,plan_component_id,module_ref,week_ref,component_ref) '
                'VALUES (%s,1,%s,%s,%s,%s,%s) RETURNING id',
                [learner.profile.pk, 'component', component.pk, self.namespace+'-M',
                 self.namespace+'-W', self.namespace+'-C'])
            pk = cur.fetchone()[0]
        from learner_api.models import LearnerProgressEntry
        self.receipts.append((LearnerProgressEntry, pk))
        self.journal.append({'table': LearnerProgressEntry._meta.db_table, 'pk': str(pk), 'action': 'created'})
        from learner_api.models import LearnerProgressKsb
        self.create(LearnerProgressKsb, progress_id=pk, position=0, ksb_code='K1',
                    ksb_description=self.namespace, source_type='synthetic', source_id=self.namespace)
        return pk

    def ksb(self, learner):
        from learner_api.models import KsbProfileVersion, KsbDefinition, LearnerKsbAssignment
        version = self.create(KsbProfileVersion, source_profile_id=self.namespace,
            version_hash=uuid4().hex + uuid4().hex, programme=self.namespace, definition_count=1)
        definition = self.create(KsbDefinition, profile_version=version, position=0,
            code='K1', number='1', ksb_type='knowledge', description=self.namespace)
        assignment = self.create(LearnerKsbAssignment, learner=learner.profile, profile_version=version)
        return version, definition, assignment

    def document(self, learner, signed=()):
        from django.utils import timezone
        from learner_api.models import TrainingPlanDocument
        values = dict(learner_kind=learner.source.learner_type, learner_id=learner.source.pk,
            programme={'apprenticeName': self.namespace}, employment={}, learning_plan=[],
            otjh={}, epa={}, contacts={}, fully_signed=len(signed) == 3)
        for party in signed:
            if party not in {'apprentice', 'provider', 'employer'}:
                raise ValueError(party)
            values.update({party+'_signature': PNG, party+'_signed_name': self.namespace,
                           party+'_position': 'Synthetic', party+'_signed_at': timezone.now()})
        return self.create(TrainingPlanDocument, **values)

    def evidence(self, learner, progress_id):
        # Explicit synthetic metadata only. No file/storage client is invoked.
        from django.db import connections
        from django.utils import timezone
        evidence_id = uuid4()
        with connections['enrolment'].cursor() as cur:
            cur.execute('INSERT INTO "Learner".evidence_files '
                '(id,learner_kind,learner_id,section_ref,container,blob_name,original_filename,'
                'content_type,size_bytes,status,uploaded_by,uploaded_at,progress_entry_id,component_ref) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                [evidence_id, learner.source.learner_type, str(learner.source.pk), self.namespace+'-C',
                 'synthetic-only', self.namespace+'/synthetic.txt', 'synthetic.txt', 'text/plain', 0,
                 'approved', str(learner.source.pk), timezone.now(), progress_id, self.namespace+'-C'])
        # Physical columns must match the reviewed disposable schema. Fail on
        # drift; never create columns or substitute a fake successful insert.
        self.evidence_receipts.append(evidence_id)
        self.journal.append({'table': 'Learner.evidence_files', 'pk': str(evidence_id), 'action': 'created'})
        return evidence_id

    def cleanup(self):
        # Only caller-created ORM receipts, reverse dependency order. No cascade
        # collector, no broad cleanup, no source/history repair. Unknown dependent
        # rows fail the FK check and preserve this disposable run for inspection.
        require_active()
        from django.db import connections, transaction
        from login.models import LoginAccount, LoginSession, Invitation, PasswordReset, LoginAudit
        from learner_api.models import (LearnerProfile, LearnerTrainingPlanModule,
            LearnerTrainingPlanWeek, LearnerTrainingPlanComponent, LearnerFreeCourse)
        accounts = [pk for model, pk in self.receipts if model is LoginAccount]
        profiles = [pk for model, pk in self.receipts if model is LearnerProfile]
        # Capture generated children by exact fixture owner IDs, never by title
        # or email similarity. Raw deletes below do not invoke ORM cascades.
        owned = [(model, {'account_id__in': accounts}) for model in (LoginSession, Invitation, PasswordReset, LoginAudit)]
        owned += [(LearnerTrainingPlanModule, {'learner_id__in': profiles}),
                  (LearnerTrainingPlanWeek, {'plan_module__learner_id__in': profiles}),
                  (LearnerTrainingPlanComponent, {'plan_week__plan_module__learner_id__in': profiles}),
                  (LearnerFreeCourse, {'learner_id__in': profiles})]
        for model, filters in owned:
            for pk in model.objects.using('enrolment').filter(**filters).values_list('pk', flat=True):
                self.receipts.append((model, pk))
                self.journal.append({'table': model._meta.db_table, 'pk': str(pk), 'action': 'owned_child_captured'})
        with transaction.atomic(using='enrolment'):
            with connections['enrolment'].cursor() as cur:
                for pk in self.evidence_receipts:
                    cur.execute('DELETE FROM "Learner".evidence_files WHERE id=%s AND blob_name=%s',
                                [pk, self.namespace+'/synthetic.txt'])
                rank = {'LearnerProgressKsb': 0, 'LearnerProgressEntry': 1,
                        'LearnerTrainingPlanComponent': 3, 'LearnerTrainingPlanWeek': 4,
                        'LearnerTrainingPlanModule': 5, 'KsbDefinition': 6, 'KsbProfileVersion': 7,
                        'LearnerProfile': 8, 'LoginAccount': 8, 'EnrolmentUser': 9,
                        'StaffUser': 9, 'Employer': 10, 'ModuleAuthoringModule': 11}
                for model, pk in sorted(reversed(self.receipts), key=lambda row: rank.get(row[0].__name__, 2)):
                    table = connections['enrolment'].ops.quote_name(model._meta.db_table)
                    if isinstance(pk, tuple):
                        fields = model._meta.pk.fields
                        predicate = ' AND '.join(connections['enrolment'].ops.quote_name(field.column)+'=%s' for field in fields)
                        cur.execute(f'DELETE FROM {table} WHERE {predicate}', list(pk))
                    else:
                        column = connections['enrolment'].ops.quote_name(model._meta.pk.column)
                        cur.execute(f'DELETE FROM {table} WHERE {column}=%s', [pk])
                for pk in self.group_receipts:
                    cur.execute('DELETE FROM curriculum.groups WHERE group_id=%s AND group_name=%s', [pk, self.namespace])
        self.receipts.clear()
        self.evidence_receipts.clear()
        self.group_receipts.clear()
        self.journal.append({'action': 'receipt_cleanup_committed'})
