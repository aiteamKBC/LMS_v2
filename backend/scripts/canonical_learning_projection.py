"""Load pure learning projections for offline catalogue reconciliation.

These scripts supply retained source rows directly without Django startup.
"""
import ast
import hashlib
import json
import math
import re
from datetime import datetime
from html import escape
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1] / 'learner_api'


class ServiceError(Exception):
    def __init__(self, message, code=None, status=None):
        super().__init__(message)
        self.code, self.status = code, status


def functions(filename, scope, names=None):
    nodes = [node for node in ast.parse((ROOT / filename).read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and (names is None or node.name in names)]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)


def adapter(query):
    scope = dict(query=query, json=json, math=math, hashlib=hashlib, re=re,
                 datetime=datetime, escape=escape, UK=ZoneInfo('Europe/London'), ServiceError=ServiceError,
                 # KSB exclusion registry: absent here, as on a database the
                 # standards migration has not touched (no filter applied).
                 not_excluded_sql=lambda alias='k', using='default': '1 = 1',
                 repository=SimpleNamespace(_query_alias=SimpleNamespace(get=lambda: None), DB='enrolment'),
                 current_records=lambda owner, records: records,
                 current_records_bulk=lambda owners, records: {
                     owner['enrolment_id']: records.get(owner['id'], []) for owner in owners
                 })
    functions('monthly_log_sources.py', scope, {'decoded', 'number', 'stable_id', 'row'})
    functions('current_learning.py', scope, {'source_payload_metadata', 'is_unsynchronised_direct_save'})
    functions('canonical_learning.py', scope)
    return scope
