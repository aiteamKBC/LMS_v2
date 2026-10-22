"""Explicit future entry: python -B -m integration_f01_f02.run --approval ... --execute.

No Django runner/discovery, setup_databases, migrations or automatic retries.
"""
import argparse
import json
from pathlib import Path
import sys
import unittest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--approval', required=True, type=Path)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--suite', choices=['http', 'postgres'], default='http')
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args()
    if not args.execute:
        parser.error('No execution without --execute and separately approved disposable target')
    if any(path.name.lower().startswith('.env') for path in (args.approval, args.receipt)):
        parser.error('Environment files forbidden')
    from .bootstrap import boot
    # Reserve a new receipt before startup, never overwrite another run.
    receipt = args.receipt.open('x', encoding='utf-8')
    target = boot(json.loads(args.approval.read_text(encoding='utf-8')), json.loads(sys.stdin.readline()))
    from . import cases_http
    cases_http.RUN_ID = target.run_id
    cls = cases_http.HttpCases
    if args.suite == 'postgres':
        from .cases_postgres import PostgresCases
        cls = PostgresCases
    class SafeResult(unittest.TextTestResult):
        def _exc_info_to_string(self, err, test):
            return f'{err[0].__name__}: case failed; raw database/row diagnostics suppressed'
    try:
        result = unittest.TextTestRunner(verbosity=2, resultclass=SafeResult).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(cls))
    finally:
        from .fixtures import REGISTRY
        json.dump({'run_id': target.run_id, 'fixtures': [
            {'namespace': f.namespace, 'journal': f.journal,
             'remaining_receipts': [(m._meta.db_table, str(pk)) for m, pk in f.receipts]}
            for f in REGISTRY]}, receipt, indent=2)
        receipt.close()
    from django.db import connections
    connections.close_all()
    # Fixture/ORM side effects may leave audit/outbox rows; never broadly delete
    # them. A fresh approved run requires empty-data preflight again.
    print('Synthetic target retained. Review exact receipts/side effects before disposal or reuse.')
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Never print exception values/DSNs/rows from a failed connection.
        print(f'INTEGRATION REFUSED/FAILED: {type(exc).__name__}', file=sys.stderr)
        raise SystemExit(2) from None
