"""Read-only database latency diagnostic for the curriculum services.

Measures, from the machine it runs on, against the database the Django settings
point at (and the matching direct/pooled Neon endpoint):

  1. DNS and TCP connect time;
  2. full connection establishment (TCP + TLS + auth + Django's setup);
  3. SELECT 1 round trips on a warm connection;
  4. repeated representative curriculum reads, with server execution time
     (EXPLAIN ANALYZE) and bytes, so network and server time can be separated;
  5. Django's own pooled connection: cold first checkout, warm checkouts (with
     the CONN_HEALTH_CHECKS probe), and whether the same connection is reused;
  6. psycopg_pool under a burst of 4 concurrent cold requests (one gthread
     worker's threads) with min_size 1 and min_size 4.

Safety: every statement is a fixed SELECT (plus EXPLAIN ANALYZE of a SELECT).
Nothing is written, no session setting is changed, and no credential is
printed. It opens its own short-lived connections (about 30 over the run,
never more than 5 at once per test pool) and closes them; the running
services and their pools are not touched.

usage (from the backend directory, as the service user):
    venv/bin/python scripts/diagnose_db_latency.py [--samples N]
Prints one JSON object per measurement.
"""
import json
import os
import socket
import statistics
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django  # noqa: E402

django.setup()

import psycopg  # noqa: E402
from django.conf import settings  # noqa: E402
from django.db import connections  # noqa: E402

SAMPLES = int(sys.argv[sys.argv.index('--samples') + 1]) if '--samples' in sys.argv else 20


def emit(**fields):
    print(json.dumps(fields, default=str), flush=True)


def ms(start):
    return round((time.perf_counter() - start) * 1000, 1)


def summary(values):
    values = sorted(values)
    if not values:
        return {}
    return {
        'n': len(values), 'min': values[0], 'median': round(statistics.median(values), 1),
        'p90': values[min(len(values) - 1, int(len(values) * 0.9))], 'max': values[-1],
    }


default = connections['default']
db = settings.DATABASES['default']
host = (db.get('HOST') or '').lower()
pooled_host = host if '-pooler.' in host else host.replace('.', '-pooler.', 1)
direct_host = host.replace('-pooler.', '.')
port = int(db.get('PORT') or 5432)
pool_options = (db.get('OPTIONS') or {}).get('pool')

emit(step='config', engine=db.get('ENGINE'), configured_host=host, endpoint='pooled' if host == pooled_host else 'direct',
     pool=pool_options, conn_health_checks=db.get('CONN_HEALTH_CHECKS'), conn_max_age=db.get('CONN_MAX_AGE'),
     django=django.get_version(), psycopg=psycopg.__version__, cpus=os.cpu_count())
if not host or 'postgresql' not in (db.get('ENGINE') or ''):
    emit(step='abort', reason='default database is not PostgreSQL')
    sys.exit(1)

# Django's own connection parameters (the pool option removed), so a raw
# connection here is set up exactly as a pooled one would be.
params = default.get_connection_params()
params.pop('pool', None)


def params_for(target_host):
    copy = dict(params)
    copy['host'] = target_host
    return copy


# 1. DNS and TCP.
for label, target in (('pooled', pooled_host), ('direct', direct_host)):
    dns, tcp = [], []
    for _ in range(5):
        start = time.perf_counter()
        infos = socket.getaddrinfo(target, port, type=socket.SOCK_STREAM)
        dns.append(ms(start))
        start = time.perf_counter()
        with socket.create_connection(infos[0][4][:2], timeout=10):
            tcp.append(ms(start))
    emit(step='dns_tcp', endpoint=label, dns_ms=summary(dns), tcp_connect_ms=summary(tcp))

# 2-4. Raw connections, per endpoint.
for label, target in (('pooled', pooled_host), ('direct', direct_host)):
    connects = []
    for _ in range(5):
        start = time.perf_counter()
        conn = psycopg.connect(**params_for(target))
        connects.append(ms(start))
        conn.close()
    emit(step='connect', endpoint=label, connect_ms=summary(connects))

    with psycopg.connect(**params_for(target)) as conn:
        conn.autocommit = True
        rtts = []
        for _ in range(SAMPLES):
            start = time.perf_counter()
            conn.execute('select 1').fetchall()
            rtts.append(ms(start))
        emit(step='select_1', endpoint=label, rtt_ms=summary(rtts))

        for query_label, sql in (
            ('cache epoch row', 'select epoch from curriculum.cache_epoch where id = 1'),
            ('modules index', 'select module_catalogue_id, programme_id, cohort_id, group_id, title, start_date, end_date from curriculum.modules'),
            ('groups', 'select * from curriculum.groups order by programme_name, cohort_name, group_name'),
            ('weeks outline', 'select id, module_catalogue_id, display_order, week_number, title from curriculum.weeks'),
        ):
            walls = []
            rows = []
            for _ in range(max(5, SAMPLES // 4)):
                start = time.perf_counter()
                rows = conn.execute(sql).fetchall()
                walls.append(ms(start))
            plan = conn.execute('explain (analyze, format json) ' + sql).fetchone()[0]
            plan = plan[0] if isinstance(plan, list) else json.loads(plan)[0]
            size = conn.execute(f'select coalesce(sum(pg_column_size(t.*)), 0) from ({sql}) t').fetchone()[0]
            emit(step='query', endpoint=label, query=query_label, rows=len(rows), kb=round(size / 1024),
                 wall_ms=summary(walls), server_exec_ms=round(plan['Execution Time'], 2),
                 server_plan_ms=round(plan['Planning Time'], 2))

# 5. Django's pooled connection, as a request sees it.
if pool_options:
    start = time.perf_counter()
    default.ensure_connection()
    cold = ms(start)
    first_pid = default.connection.info.backend_pid
    default.close()
    checkouts, pids = [], []
    for _ in range(SAMPLES):
        start = time.perf_counter()
        default.ensure_connection()  # pool checkout, with the health check
        checkouts.append(ms(start))
        pids.append(default.connection.info.backend_pid)
        default.close()  # back to the pool, as at the end of a request
    stats = default.pool.get_stats()
    emit(step='django_pool', cold_first_checkout_ms=cold, warm_checkout_ms=summary(checkouts),
         distinct_client_connections=len(set(pids + [first_pid])),
         pool_stats={key: stats.get(key) for key in ('pool_min', 'pool_max', 'pool_size', 'pool_available',
                                                     'connections_num', 'connections_ms', 'requests_num',
                                                     'requests_waiting', 'requests_wait_ms')})
    default.pool.close()
else:
    emit(step='django_pool', skipped='DB_POOL is off')

# 6. A burst of 4 concurrent cold requests against a fresh pool.
try:
    from psycopg_pool import ConnectionPool
except ImportError:
    ConnectionPool = None
if ConnectionPool is not None:
    for min_size in (1, 4):
        pool = ConnectionPool(
            kwargs={**params_for(host), 'autocommit': True}, min_size=min_size, max_size=10,
            check=ConnectionPool.check_connection, open=False, name=f'diag-min{min_size}',
        )
        start_all = time.perf_counter()
        pool.open(wait=False)  # what Django does on the first request
        waits = []
        lock = threading.Lock()

        def request():
            start = time.perf_counter()
            with pool.connection() as conn:
                waited = ms(start)
                conn.execute('select 1').fetchall()
                time.sleep(0.2)  # a short request holding its connection
            with lock:
                waits.append(waited)

        threads = [threading.Thread(target=request) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        burst = ms(start_all)
        stats = pool.get_stats()
        pool.close()
        emit(step='burst', min_size=min_size, burst_wall_ms=burst, connection_wait_ms=sorted(waits),
             connections_opened=stats.get('connections_num'), connect_ms_total=stats.get('connections_ms'))

# Server-side view of connections (read-only).
with psycopg.connect(**params_for(host)) as conn:
    rows = conn.execute(
        "select coalesce(state, '?'), count(*) from pg_stat_activity "
        "where datname = current_database() group by 1 order by 2 desc"
    ).fetchall()
    emit(step='server_sessions', by_state=dict(rows))
emit(step='done')
