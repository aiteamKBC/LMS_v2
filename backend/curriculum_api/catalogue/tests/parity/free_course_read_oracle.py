"""Execute the pinned pre-extraction readers without importing the application.

Only their actual constants, exception classes and function definitions are
compiled. Every framework/SQL capability must be supplied by the caller.
"""
import ast
from contextlib import contextmanager, nullcontext
from datetime import date, datetime, time
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID


FIXTURE = Path(__file__).resolve().parents[1] / 'fixtures/free_course_read_boundary.json'
SNAPSHOT_SHA = '0663fc1b307c54ca962638679a9e010fbc38921d454cbc5ec55d1494f5eea7dd'


def sources():
    data = FIXTURE.read_bytes()
    # Filled with the immutable task-start source digest, not a generated result.
    assert hashlib.sha256(data).hexdigest() == SNAPSHOT_SHA
    return json.loads(data)['sources']


def legacy_module(filename, **dependencies):
    source = sources()[filename]
    tree = ast.parse(source)
    body = []
    for node in tree.body:
        if filename == 'free_course_authoring.py' and node.lineno >= 726:
            break  # No HTTP/writer bindings or tracked_save initialization.
        if isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef)):
            body.append(node)
    namespace = dict(
        __name__='pinned_free_course_reader',
        contextmanager=contextmanager, nullcontext=nullcontext,
        date=date, datetime=datetime, time=time, Decimal=Decimal, UUID=UUID,
        hashlib=hashlib, json=json, math=math, os=os,
    )
    namespace.update(dependencies)
    exec(compile(ast.Module(body=body, type_ignores=[]), filename, 'exec'), namespace)
    return SimpleNamespace(**namespace)


def synthetic_rows():
    """Small deterministic rows; no copied application or learner data."""
    courses = [dict(id='FC-A', course_name='A', display_order=0, price=Decimal('10.00')),
               dict(id='FC-B', course_name='B', display_order=1),
               dict(id='FC-EMPTY', course_name='Empty', display_order=2)]
    weeks = [dict(id='FW-A', course_id='FC-A', title='One', display_order=0,
                  week_number=1, status='inactive', legacy_copied_from_week_id=' OLD '),
             dict(id='FW-B', course_id='FC-B', title='Two', display_order=0,
                  week_number=1, status='active')]
    components = [dict(id='CP-A', free_module_id='FW-A', programme_id='FREE-COURSES',
                       type='quiz', title='Quiz', display_order=0,
                       settings_json={'linkedQuizId': 'Q-A'}, expected_otjh=Decimal('1.50')),
                  dict(id='CP-B', free_module_id='FW-B', programme_id='FREE-COURSES',
                       type='quiz', title='Other', display_order=0,
                       settings_json={'linkedQuizId': 'Q-A'})]
    quizzes = [dict(id='Q-A', free_course_week_id='FW-A', week_id=None, status='published')]
    links = [dict(id=1, quiz_id='Q-A', free_course_id='FC-A', free_course_week_id='FW-A',
                  module_catalogue_id=None, week_id=None)]
    return courses, weeks, components, quizzes, links
