"""One bounded outbox pass. Intentionally restricted to verified local sandboxes.

No import/startup hook, polling, sleep, automatic retry, schema repair or mail.
Enabling this on application databases is a separate, unimplemented release.
"""
from collections import Counter
from contextlib import ExitStack, contextmanager
from pathlib import Path
import time

from django.conf import settings
from django.db import DatabaseError, connections, transaction

from coach_api.review_sources import enrolment_for_review_profile
from coach_api.migrated_reviews import review_family
from learner_api.models import LearnerProfile

from .review_feedback import is_gateway_review, sync_review_feedback


SANDBOX_DATABASE = 'review_feedback_consumer_test'
SANDBOX_MARKER = '.feedback-consumer-test-sandbox'
SANDBOX_ROOT = Path(__file__).resolve().parents[2] / '.local-runtime/review-feedback-consumer-tests'


class ConsumerSafetyError(ValueError):
    pass


class QueryLimitReached(Exception):
    pass


class TimeLimitReached(Exception):
    pass


class BlockedReview(Exception):
    pass


def _sandbox_config(expected_data_directory):
    """Reject application targets without opening a connection."""
    directory = Path(expected_data_directory).resolve()
    if (not directory.is_relative_to(SANDBOX_ROOT.resolve()) or directory.name != 'data'
            or not (directory.parent / SANDBOX_MARKER).is_file()):
        raise ConsumerSafetyError('A marked local consumer-test directory is required.')
    configs = []
    for alias in ('default', 'enrolment'):
        config = settings.DATABASES.get(alias, {})
        if (config.get('ENGINE') != 'django.db.backends.postgresql'
                or config.get('HOST') != '127.0.0.1'
                or config.get('NAME') != SANDBOX_DATABASE or not config.get('PORT')
                or config.get('OPTIONS', {}).get('pool')):
            raise ConsumerSafetyError('Only the isolated loopback consumer-test database is permitted.')
        configs.append((config['HOST'], str(config['PORT']), config['NAME']))
        wrapper = connections[alias]
        if any(str(wrapper.settings_dict.get(key)) != str(config.get(key)) for key in ('HOST', 'PORT', 'NAME', 'ENGINE')):
            raise ConsumerSafetyError('A cached connection has a different target.')
        if wrapper.connection is not None:
            info = wrapper.connection.info
            if info.host != '127.0.0.1' or info.dbname != SANDBOX_DATABASE or str(info.port) != str(config['PORT']):
                raise ConsumerSafetyError('An existing connection has a different target.')
    if configs[0] != configs[1]:
        raise ConsumerSafetyError('Feedback and enrolment must use the same isolated database.')
    return directory


class QueryMeter:
    def __init__(self, maximum, deadline):
        self.maximum = maximum
        self.deadline = deadline
        self.queries = 0
        self.cleanup_queries = 0
        self.pending_reads = 0
        self.transaction_commands = 0
        self.reserved_cleanup = 0

    def charge(self):
        if self.queries + self.cleanup_queries + self.reserved_cleanup >= self.maximum:
            raise QueryLimitReached
        if time.monotonic() >= self.deadline:
            raise TimeLimitReached
        self.queries += 1

    def cleanup(self):
        if self.reserved_cleanup:
            self.reserved_cleanup -= 1
        self.cleanup_queries += 1

    @contextmanager
    def transaction_meter(self, wrapper):
        # BEGIN/COMMIT through the driver do not pass execute_wrapper. Count
        # transaction starts and the driver's actual settlement calls too.
        original_auto, original_commit, original_rollback = wrapper.set_autocommit, wrapper.commit, wrapper.rollback

        def autocommit(value, *args, **kwargs):
            if not value and wrapper.connection is not None and wrapper.autocommit:
                self.charge()
                self.transaction_commands += 1
            return original_auto(value, *args, **kwargs)

        def settle(original):
            if wrapper.connection is not None and wrapper.connection.info.transaction_status:
                self.cleanup()
                self.transaction_commands += 1
            return original()

        wrapper.set_autocommit = autocommit
        wrapper.commit = lambda: settle(original_commit)
        wrapper.rollback = lambda: settle(original_rollback)
        try:
            yield
        finally:
            wrapper.set_autocommit, wrapper.commit, wrapper.rollback = original_auto, original_commit, original_rollback

    def __call__(self, execute, sql, params, many, context):
        normalized = ' '.join(str(sql).upper().split())
        # Rollback/release must still work after a budget is exhausted. Report
        # their cost separately; never mask a half-finished transaction.
        if normalized.startswith(('ROLLBACK', 'RELEASE SAVEPOINT')):
            self.cleanup()
            return execute(sql, params, many, context)
        self.charge()
        if ('REVIEW_FEEDBACK_OUTBOX' in normalized and 'ORDER BY REQUESTED_AT' in normalized):
            self.pending_reads += 1
        return execute(sql, params, many, context)


def _verify_connections(directory):
    for alias in ('default', 'enrolment'):
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT current_database(), host(inet_server_addr()), current_setting('data_directory')")
            name, host, data = cursor.fetchone()
        if name != SANDBOX_DATABASE or host != '127.0.0.1' or Path(data).resolve() != directory:
            raise ConsumerSafetyError('Server identity does not match the isolated test directory.')


def _process(source_id, *, apply, deadline):
    """One transaction per review; source writers never wait on our queue locks."""
    with transaction.atomic(using='default'):
        with connections['default'].cursor() as cursor:
            if not apply:
                cursor.execute('SET TRANSACTION READ ONLY')
            remaining_ms = max(1, int((deadline - time.monotonic()) * 1000))
            cursor.execute("SELECT set_config('statement_timeout', %s, true), "
                           "set_config('lock_timeout', '500ms', true)", [str(remaining_ms)])
            if apply:
                # Transaction locks work with transaction pooling. Unlike a row
                # lock on the outbox, this does not block the source trigger.
                cursor.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('feedback-review:' || %s::text, 0))",
                               [source_id])
                if not cursor.fetchone()[0]:
                    return {'busy': 1}
            cursor.execute('''SELECT q.requested_version, q.processed_version, r.learner_id,
                    r.id, r.review_type, r.review_name
                FROM "Feedback".review_feedback_outbox q
                LEFT JOIN "Learner".reviews r ON r.id=q.source_review_id
                WHERE q.source_review_id=%s''', [source_id])
            row = cursor.fetchone()
        if row is None or row[1] >= row[0]:
            return {'alreadyProcessed': 1}
        version, _, profile_id, source_id_found, review_type, review_name = row
        result = {}
        gateway = is_gateway_review({'review_name': review_name})
        family = review_family(review_type)
        if source_id_found is None:
            result['missingSource'] = 1
        elif not gateway and family not in {'MCM', 'PR', 'PR_SKILLS_RADAR'}:
            result['unsupportedSource'] = 1
        else:
            profile = LearnerProfile.objects.filter(pk=profile_id).first()
            learner = enrolment_for_review_profile(profile)
            if learner is None:
                raise BlockedReview('identity')
            result = sync_review_feedback(learner.pk, source_review_id=source_id,
                                          dry_run=not apply, require_aptem_completed=True,
                                          include_employer=not gateway and family in {'PR', 'PR_SKILLS_RADAR'})
            if any(result.get(key, 0) for key in ('unlinked', 'identityConflicts', 'undated', 'future',
                                                 'employerUnlinked', 'employerIdentityConflicts',
                                                 'employerUndated', 'employerFuture')):
                raise BlockedReview('eligibility')
        if apply:
            with connections['default'].cursor() as cursor:
                cursor.execute('''UPDATE "Feedback".review_feedback_outbox
                    SET processed_version=GREATEST(processed_version,%s), processed_at=clock_timestamp()
                    WHERE source_review_id=%s AND requested_version>=%s''', [version, source_id, version])
            result['acknowledged'] = 1
        else:
            result['previewed'] = 1
        return result


def process_once(*, expected_data_directory, apply=False, limit=20, max_queries=500,
                 max_seconds=20, max_errors=3):
    """At most one attempt per selected source in this explicit invocation."""
    if not 1 <= limit <= 20 or not 5 <= max_queries <= 1000 or not 0 < max_seconds <= 30 or not 1 <= max_errors <= 20:
        raise ConsumerSafetyError('Limits: 1..20 reviews, 5..1000 queries, up to 30 seconds, 1..20 errors.')
    directory = _sandbox_config(expected_data_directory)
    started = time.monotonic()
    meter = QueryMeter(max_queries, started + max_seconds)
    report = Counter(attempted=0, acknowledged=0, previewed=0, failed=0, blocked=0,
                     created=0, employerCreated=0, wouldCreate=0, employerWouldCreate=0)
    stopped = 'batch_complete'
    with ExitStack() as stack:
        for alias in ('default', 'enrolment'):
            stack.enter_context(meter.transaction_meter(connections[alias]))
            stack.enter_context(connections[alias].execute_wrapper(meter))
        try:
            _verify_connections(directory)
            with connections['default'].cursor() as cursor:
                cursor.execute('''SELECT source_review_id FROM "Feedback".review_feedback_outbox
                    WHERE processed_version<requested_version
                    ORDER BY requested_at,source_review_id LIMIT %s''', [limit])
                source_ids = [row[0] for row in cursor.fetchall()]
            report['selected'] = len(source_ids)
            for source_id in source_ids:
                report['attempted'] += 1
                # Reserve settlement space for the two get_or_create savepoints
                # and outer transaction, including a uniqueness-race rollback.
                # Work stops before consuming this space; cleanup is never denied.
                meter.reserved_cleanup = 6
                try:
                    result = _process(source_id, apply=apply, deadline=meter.deadline)
                except BlockedReview:
                    report['blocked'] += 1
                except DatabaseError:
                    report['failed'] += 1
                else:
                    # Only include committed results. Failed learner/employer
                    # work rolls back together; an unresolved employer account
                    # is instead persisted normally as a pending recipient.
                    report.update(result)
                finally:
                    meter.reserved_cleanup = 0
                if report['failed'] >= max_errors:
                    stopped = 'error_limit'
                    break
        except QueryLimitReached:
            stopped = 'query_limit'
        except TimeLimitReached:
            stopped = 'time_limit'
    return {**dict(report), 'apply': bool(apply), 'stopped': stopped,
            'queries': meter.queries, 'cleanupQueries': meter.cleanup_queries,
            'totalQueries': meter.queries + meter.cleanup_queries,
            'transactionCommands': meter.transaction_commands,
            'maxQueries': max_queries,
            'pendingReads': meter.pending_reads, 'elapsedSeconds': round(time.monotonic() - started, 4)}
