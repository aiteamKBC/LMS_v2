"""Pure validation shared by the opt-in runner and offline safety tests."""
import ast
from dataclasses import dataclass
from datetime import datetime, timezone
import ipaddress
from pathlib import Path
import re


class Refused(RuntimeError):
    pass


@dataclass(frozen=True)
class Target:
    project: str
    branch: str
    parent: str
    host: str
    address: str
    port: int
    database: str
    user: str
    run_id: str
    expires: str
    approval: str

    @classmethod
    def parse(cls, value):
        if set(value) != set(cls.__dataclass_fields__):
            raise Refused('Incomplete or unexpected approval fields')
        target = cls(**value)
        if any(not isinstance(getattr(target, key), str) or not getattr(target, key).strip()
               for key in cls.__dataclass_fields__ if key != 'port'):
            raise Refused('Approval fields must be nonempty strings')
        if target.branch == target.parent or not target.branch.startswith('br-'):
            raise Refused('A distinct disposable child is required')
        if not re.fullmatch(r'[a-z0-9.-]+', target.host) or '-pooler.' in target.host:
            raise Refused('An exact direct host is required')
        ipaddress.ip_address(target.address)
        if type(target.port) is not int or not 1 <= target.port <= 65535:
            raise Refused('Invalid port')
        if not re.fullmatch(r'f01f02_[a-f0-9]{32}', target.run_id):
            raise Refused('A unique synthetic run ID is required')
        expiry = datetime.fromisoformat(target.expires)
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            raise Refused('Approval expired or lacks timezone')
        return target

    def verify(self, row):
        # Provider project/parent/host mapping is recorded independently in the
        # preprovisioned sentinel. Server branch, database and role are live facts.
        expected = (self.database, self.user, self.branch, 'on', self.project,
                    self.parent, self.host, self.run_id, self.approval)
        if tuple(row) != expected:
            raise Refused('Server identity or independent approval does not match')

    def connection(self, kwargs):
        expected = {'host': self.host, 'hostaddr': self.address, 'port': self.port,
                    'dbname': self.database, 'user': self.user}
        if any(str(kwargs.get(k)) != str(v) for k, v in expected.items()):
            raise Refused('Connection escaped approved target')


def application_lists(path):
    """Only literal app/middleware lists; never execute production settings."""
    tree = ast.parse(Path(path).read_text(encoding='utf-8-sig'))
    result = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {'INSTALLED_APPS', 'MIDDLEWARE'}:
                    result[target.id] = ast.literal_eval(node.value)
    if set(result) != {'INSTALLED_APPS', 'MIDDLEWARE'}:
        raise Refused('Application configuration changed; review required')
    if any(not isinstance(value, list) or not all(isinstance(x, str) for x in value)
           for value in result.values()):
        raise Refused('Expected literal application lists')
    return result


def check_sql(sql, writable=False):
    if not isinstance(sql, str):
        raise Refused('SQL must be rendered before validation')
    # Deliberately conservative: keywords inside literals can also fail closed.
    if re.search(r'\b(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|'
                 r'REINDEX|DISCARD|SET\s+ROLE|SET\s+SESSION\s+AUTHORIZATION|'
                 r'DBLINK|PG_TERMINATE_BACKEND|LO_IMPORT|LO_EXPORT)\b', sql, re.I):
        raise Refused('DDL, privilege changes and administrative SQL forbidden')
    if ';' in sql.rstrip().rstrip(';') or '--' in sql or '/*' in sql or '$$' in sql:
        raise Refused('Multiple statements or opaque SQL forbidden')
    first = sql.lstrip().split(None, 1)[0].upper() if sql.strip() else ''
    allowed = {'SELECT', 'SHOW', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'}
    if writable:
        allowed |= {'INSERT', 'UPDATE', 'DELETE', 'WITH'}
    if first not in allowed:
        raise Refused('SQL outside reviewed test operations')
    if not writable and re.search(r'\b(INSERT|UPDATE|DELETE|MERGE)\b', sql, re.I):
        raise Refused('Write before bootstrap verification')


def audit_event(event, args):
    if event == 'open' and Path(str(args[0])).name.lower().startswith('.env'):
        raise Refused('Environment files forbidden')
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system'}:
        # libpq connections are separately pinned and verified; all Python
        # sockets, including loopback HTTP, Redis and DNS, are forbidden.
        raise Refused('External transports/processes forbidden')
    if event == 'import' and args[0] in {'config.settings', 'config.settings_sqlite_test', 'psycopg2'}:
        raise Refused('Unsafe settings/alternate database driver forbidden')


def no_command(*args, **kwargs):
    raise Refused('Management commands/provisioning are forbidden in this harness')
