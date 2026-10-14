"""Management operations which must not start application cache writers."""
import sys
from contextlib import contextmanager, ExitStack


def reconciliation_command():
    return len(sys.argv) > 1 and sys.argv[1] == "reconcile_review_booking"


@contextmanager
def read_only_databases():
    """Protect inspection reads, including identity reads routed to other aliases."""
    from django.db import connections, transaction

    with ExitStack() as stack:
        for alias in connections:
            db = connections[alias]
            if db.vendor == "postgresql":
                # SET TRANSACTION cannot make an already-used caller transaction
                # read-only. Fail explicitly instead of claiming protection.
                if db.in_atomic_block:
                    raise ValueError("Inspection requires its own read-only database transactions.")
                stack.enter_context(transaction.atomic(using=alias))
                with db.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
        yield
