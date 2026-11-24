"""Replay fixtures through pinned references and actual current owners.

Unchanged functions retain their pre-extraction reference. The seven approved
study-week functions use actual upstream 99f81 bodies, not current-code copies.
"""
import copy
from contextlib import ExitStack
import datetime as clock_module
from datetime import datetime
import itertools
import sys
import unittest
import uuid
from unittest.mock import patch
from curriculum_api.meetings.tests import source_loader
from curriculum_api import test_calendar_checks_no_db as calendars
from curriculum_api import test_teams_attachment_no_db as attachments


class FixedClock(datetime):
    @classmethod
    def utcnow(cls):
        return cls(2026,11,22,12,0)
    @classmethod
    def now(cls, tz=None):
        value=cls(2026,11,22,12,0)
        return value.replace(tzinfo=tz) if tz else value


class ActualMeetingParity(unittest.TestCase):
    pass


def parity(case_class, method):
    def test(self):
        def run(original):
            case=case_class(method)
            values=itertools.count(1)
            real_datetime = datetime
            try:
                with ExitStack() as stack:
                    stack.enter_context(patch.object(source_loader, 'USE_ORIGINAL', original))
                    stack.enter_context(patch.object(uuid, 'uuid4', side_effect=lambda:uuid.UUID(int=next(values))))
                    # Imported helper clocks and fixture-local namespaces must
                    # see the same instant, not just the endpoint's own port.
                    stack.enter_context(patch.object(clock_module, 'datetime', FixedClock))
                    case.setUp()
                    for module in list(sys.modules.values()):
                        if getattr(module, '__name__', '').startswith(('curriculum_api', 'calendar_checks')):
                            for name, value in list(vars(module).items()):
                                if value is real_datetime:
                                    stack.enter_context(patch.object(module, name, FixedClock))
                    namespace=case.n if hasattr(case,'n') else vars(case.v)
                    namespace['datetime']=FixedClock
                    getattr(case,method)()
                    return copy.deepcopy({name:getattr(case,name) for name in
                        ('calls','headers','events','instances','series','tracked','writes','forwards') if hasattr(case,name)})
            finally:
                case.doCleanups()
        self.assertEqual(run(False),run(True))
    return test


for case_class in (calendars.CalendarChecksTests,attachments.AttachmentTests):
    for method in unittest.defaultTestLoader.getTestCaseNames(case_class):
        setattr(ActualMeetingParity,'test_'+case_class.__name__+'_'+method[5:],parity(case_class,method))
del case_class,method
