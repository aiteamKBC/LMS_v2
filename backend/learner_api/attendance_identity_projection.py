"""Identity-only raw Graph facts for read-only progress projections."""
from django.db.models import Func


class AttendanceIdentityProjection(Func):
    # The reviewed-identity policies read these raw keys. Durations, intervals,
    # role and source IDs retain their separate, unchanged model columns.
    keys = ('identity', 'displayName', 'participantDisplayName', 'name', 'lmsAccountResolution')

    def as_postgresql(self, compiler, connection, **extra_context):
        expression, params = compiler.compile(self.source_expressions[0])
        fields = ','.join(f"'{key}',{expression}->'{key}'" for key in self.keys)
        return (f"CASE WHEN jsonb_typeof({expression})='object' THEN jsonb_build_object({fields}) "
                f"ELSE {expression} END", params * (len(self.keys)+2))

    def as_sqlite(self, compiler, connection, **extra_context):
        return compiler.compile(self.source_expressions[0])
